// ============================================================
// Bot-side outbound send (Flows, Automations, AI auto-reply).
//
// One implementation of: account-scoped contact lookup → provider
// resolution → phone-variant retry → contact auto-fix → persist the
// `messages` row (sender_type='bot') → bump the conversation preview.
//
// Uses the service-role client (engines run without cookies), so every
// lookup is filtered by `account_id` — otherwise a user could fire their
// own automation against another tenant's contact UUID.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import {
  resolveProvider,
  sendWithPhoneVariants,
  type OutboundMessage,
} from '@/lib/whatsapp/providers';

export interface BotSendArgs {
  /** Tenancy key — drives the contact + provider lookups. */
  accountId: string;
  conversationId: string;
  contactId: string;
  message: OutboundMessage;
  /** Badge the persisted row as an AI reply. */
  aiGenerated?: boolean;
}

export async function sendBotMessage(
  args: BotSendArgs
): Promise<{ whatsapp_message_id: string }> {
  const { accountId, conversationId, contactId, message } = args;
  const db = supabaseAdmin();

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account');
  }

  const sanitized = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`);
  }

  const provider = await resolveProvider(db, accountId);
  const sent = await sendWithPhoneVariants(provider, sanitized, message);

  if (sent.phone !== sanitized) {
    await db.from('contacts').update({ phone: sent.phone }).eq('id', contact.id);
  }

  const row = toMessageRow(message, sent.renderedText);
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    ...row.columns,
    message_id: sent.messageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  });
  if (msgErr) {
    // The customer already has the message; surface the DB failure
    // without pretending the send failed silently.
    throw new Error(`sent via ${provider.id} but DB insert failed: ${msgErr.message}`);
  }

  await db
    .from('conversations')
    .update({
      last_message_text: row.preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { whatsapp_message_id: sent.messageId };
}

/** `messages` columns + conversation-list preview for an outbound message. */
function toMessageRow(
  message: OutboundMessage,
  renderedText?: string
): { columns: Record<string, unknown>; preview: string } {
  switch (message.type) {
    case 'text':
      return {
        columns: { content_type: 'text', content_text: message.text },
        preview: message.text,
      };
    case 'media':
      return {
        columns: {
          content_type: message.kind,
          content_text: message.caption ?? null,
          media_url: message.url,
        },
        preview: message.caption?.trim() || `[${message.kind}]`,
      };
    case 'template':
      return {
        columns: {
          content_type: 'template',
          content_text: renderedText ?? null,
          template_name: message.name,
        },
        preview: renderedText || `[template:${message.name}]`,
      };
    case 'interactive':
      return {
        columns: {
          content_type: 'interactive',
          content_text: message.payload.body,
          interactive_payload: message.payload,
        },
        preview: message.payload.body,
      };
  }
}
