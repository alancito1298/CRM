import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

export async function POST(request: Request) {
  try {
    // Requires the 'agent' role — `canSendMessages` in lib/auth/roles is
    // explicit that running broadcasts is a write operation and that
    // viewers are read-only.
    //
    // This endpoint writes NOTHING to the database: it reads the config
    // and template, then calls Meta directly. So unlike the rest of the
    // app there was no RLS policy backstopping a missing role check —
    // resolving `account_id` straight off the profile (which only needs
    // 'viewer') was the ONLY gate, and it let a viewer blast a template
    // to arbitrary phone numbers from the account's WhatsApp number.
    // Nothing about that is recoverable after the fact, so the check has
    // to happen here.
    const { supabase, accountId, userId } = await requireRole('agent')

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    // ── 1. Check if WhatsApp Web is connected for this account ──
    const waServiceUrl = process.env.WA_SERVICE_URL || 'http://localhost:3001'
    let isWaWebReady = false
    try {
      const waStatusRes = await fetch(`${waServiceUrl}/sessions/${accountId}/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(2000),
      })
      if (waStatusRes.ok) {
        const { status } = await waStatusRes.json()
        if (status === 'ready') isWaWebReady = true
      }
      if (!isWaWebReady) {
        const globalStatusRes = await fetch(`${waServiceUrl}/status`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(1500),
        })
        if (globalStatusRes.ok) {
          const { status } = await globalStatusRes.json()
          if (status === 'ready') isWaWebReady = true
        }
      }
    } catch {
      isWaWebReady = false
    }

    // ── 2. WhatsApp Config (Meta API) if not using WhatsApp Web ──
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!isWaWebReady && (!config || !config.phone_number_id || !config.access_token)) {
      return NextResponse.json(
        {
          error:
            'WhatsApp no está conectado ni configurado. Por favor, conecta tu WhatsApp escaneando el código QR en Ajustes o configura tus credenciales de Meta Cloud API.',
        },
        { status: 400 }
      )
    }

    const accessToken = config?.access_token ? decrypt(config.access_token) : null

    // Load template row if available
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .maybeSingle()

    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow) && !isWaWebReady) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    const templateRow = rawTemplateRow ?? null

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    // Helper to render template text for WhatsApp Web
    const renderMessageForWaWeb = (
      params: string[] = [],
      mediaUrl?: string
    ): { text: string; mediaUrl?: string } => {
      let body = templateRow?.body_text || `[${template_name}]`
      params.forEach((val, idx) => {
        const placeholder = new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g')
        body = body.replace(placeholder, val || '')
      })

      const parts: string[] = []
      if (templateRow?.header_type === 'text' && templateRow?.header_content) {
        parts.push(`*${templateRow.header_content}*`)
      }
      if (body) {
        parts.push(body)
      }
      if (templateRow?.footer_text) {
        parts.push(`_${templateRow.footer_text}_`)
      }
      if (templateRow?.buttons && templateRow.buttons.length > 0) {
        const btnTexts = templateRow.buttons
          .map((b: any) => {
            if (b.type === 'URL' && b.url) return `👉 ${b.text}: ${b.url}`
            if (b.type === 'PHONE_NUMBER' && b.phone_number) return `📞 ${b.text}: ${b.phone_number}`
            return `• ${b.text}`
          })
          .join('\n')
        parts.push(btnTexts)
      }

      const finalMedia =
        mediaUrl ||
        (templateRow?.header_type !== 'text' ? templateRow?.header_media_url : undefined)

      return {
        text: parts.join('\n\n'),
        mediaUrl: finalMedia || undefined,
      }
    }

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i]
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      let sentMessageId: string | null = null
      let lastError: string | null = null

      if (isWaWebReady) {
        // ── Enviar mediante WhatsApp Web Service ──
        try {
          const { text, mediaUrl } = renderMessageForWaWeb(
            recipient.params,
            recipient.messageParams?.headerMediaUrl
          )

          // 1. Intentar endpoint multi-tenant por cuenta
          const sendRes = await fetch(`${waServiceUrl}/sessions/${accountId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: sanitized,
              message: text,
              mediaUrl: mediaUrl || undefined,
              fromCrm: true,
            }),
            signal: AbortSignal.timeout(15000),
          })

          if (sendRes.ok) {
            const data = await sendRes.json()
            sentMessageId = data.messageId || `wa-web-${Date.now()}`
          } else {
            // 2. Fallback endpoint global
            const globalSendRes = await fetch(`${waServiceUrl}/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: sanitized,
                message: text,
                mediaUrl: mediaUrl || undefined,
                fromCrm: true,
              }),
              signal: AbortSignal.timeout(15000),
            })
            if (globalSendRes.ok) {
              const data = await globalSendRes.json()
              sentMessageId = data.messageId || `wa-web-${Date.now()}`
            } else {
              const errData = await sendRes.json().catch(() => ({}))
              lastError = errData.error || 'Error al enviar por WhatsApp Web'
            }
          }
        } catch (err: any) {
          lastError = err.message || 'Error de conexión con WhatsApp Web'
        }

        // Pacing anti-bloqueo para envíos por WhatsApp Web (1.5s - 2.5s)
        if (i < recipients.length - 1) {
          const delay = Math.floor(1500 + Math.random() * 1000)
          await new Promise((r) => setTimeout(r, delay))
        }
      } else {
        // ── Enviar mediante Meta Cloud API ──
        const variants = phoneVariants(sanitized)
        for (const variant of variants) {
          try {
            const result = await sendTemplateMessage({
              phoneNumberId: config!.phone_number_id,
              accessToken: accessToken!,
              to: variant,
              templateName: template_name,
              language: template_language || 'en_US',
              template: templateRow ?? undefined,
              messageParams: recipient.messageParams,
              params: recipient.params ?? [],
            })
            sentMessageId = result.messageId
            lastError = null
            break
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error'
            if (!isRecipientNotAllowedError(errorMessage)) {
              lastError = errorMessage
              break
            }
            lastError = errorMessage
          }
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp broadcast POST:', error)
    return toErrorResponse(error)
  }
}
