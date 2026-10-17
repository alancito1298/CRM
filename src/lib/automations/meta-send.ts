import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { sendBotMessage } from '@/lib/whatsapp/bot-send'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side sender. Thin adapter over `sendBotMessage`, which
// owns provider resolution (WA Web / Meta / Twilio), phone-variant
// retry and persistence for every bot send.
// ------------------------------------------------------------

interface EngineArgs {
  /** Account-level tenancy key. Drives contact + provider lookups so
   *  an automation authored by user A still sends through the WhatsApp
   *  number user B connected on the same account. */
  accountId: string
  /** Original author of the automation — kept for logs/audit; not
   *  consulted for tenancy. */
  userId: string
  conversationId: string
  contactId: string
}

interface SendTextArgs extends EngineArgs {
  text: string
}

interface SendTemplateArgs extends EngineArgs {
  templateName: string
  language?: string
  params?: string[]
}

interface SendInteractiveArgs extends EngineArgs {
  payload: InteractiveMessagePayload
}

export async function engineSendText(
  args: SendTextArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendBotMessage({ ...args, message: { type: 'text', text: args.text } })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  // The local row lets Meta build header/button components and lets
  // text-only providers render the body.
  let query = supabaseAdmin()
    .from('message_templates')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('name', args.templateName)
  if (args.language) query = query.eq('language', args.language)
  const { data } = await query.limit(1).maybeSingle()

  return sendBotMessage({
    ...args,
    message: {
      type: 'template',
      name: args.templateName,
      language: args.language || 'en_US',
      template: data && isMessageTemplate(data) ? data : null,
      params: args.params,
    },
  })
}

export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendBotMessage({ ...args, message: { type: 'interactive', payload: args.payload } })
}
