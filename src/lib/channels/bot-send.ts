// ============================================================
// Bot-side outbound send (Flows, Automations, AI auto-reply).
//
// One implementation of: account-scoped conversation lookup → channel
// routing → send → persist the `messages` row (sender_type='bot') →
// bump the conversation preview.
//
// Uses the service-role client (engines run without cookies), so every
// lookup is filtered by `account_id` — otherwise a user could fire their
// own automation against another tenant's conversation UUID.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { loadConversationRoute } from './conversation-route';
import { assertChannelSupports } from './registry';
import type { ChannelMessage } from './types';

export interface BotSendArgs {
  /** Tenancy key — drives the conversation + channel lookups. */
  accountId: string;
  conversationId: string;
  /** Kept for callers' logs; the recipient comes from the conversation. */
  contactId: string;
  message: ChannelMessage;
  /** Badge the persisted row as an AI reply. */
  aiGenerated?: boolean;
}

export async function sendBotMessage(
  args: BotSendArgs
): Promise<{ whatsapp_message_id: string }> {
  const { accountId, conversationId, message } = args;
  const db = supabaseAdmin();

  const route = await loadConversationRoute(db, accountId, conversationId);
  if (!route || route.recipient.contactId !== args.contactId) {
    throw new Error('conversation not found for this account');
  }

  assertChannelSupports(route.channelType, route.adapter.capabilities, message);

  const sent = await route.adapter.send(
    { db, accountId, conversationId, channel: route.channel, recipient: route.recipient },
    message
  );

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
    throw new Error(`sent via ${sent.via} but DB insert failed: ${msgErr.message}`);
  }

  await db
    .from('conversations')
    .update({
      last_message_text: row.preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Field name kept for the engines' existing contract.
  return { whatsapp_message_id: sent.messageId };
}

/** `messages` columns + conversation-list preview for an outbound message. */
function toMessageRow(
  message: ChannelMessage,
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
