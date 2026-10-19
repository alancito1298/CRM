// ============================================================
// Inbound pipeline — the single entry point for customer messages.
//
// Each channel's webhook only verifies and parses its own payload, then
// hands a normalized event to `ingestInbound`, which owns everything
// that is the same for every network:
//
//   sender → contact + identity → conversation → message row →
//   conversation preview → broadcast-reply flag → Flows → Automations →
//   AI auto-reply → public webhooks.
//
// Never throws for expected failures (logs and returns null) so the
// caller can always ack the provider.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  findOrCreateConversation,
  resolveSenderContact,
  type InboundSender,
} from './sender-resolution';
import type { ChannelType } from './types';

/** Values allowed by the `messages.content_type` CHECK constraint. */
export type InboundContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  | 'interactive';

export interface InboundMessageEvent {
  kind: 'message';
  /** Network-side message id (wamid, Twilio SID, Instagram mid). */
  externalMessageId: string;
  sentAt: Date;
  contentType: InboundContentType;
  text: string | null;
  mediaUrl: string | null;
  /** Id of the tapped button / list row / quick reply, if any. */
  interactiveReplyId: string | null;
  /** Network id of the message being replied to (swipe-reply). */
  replyToExternalId?: string | null;
  /** Shown in the conversation list when there's no text, e.g. "[image]". */
  previewFallback: string;
}

export interface InboundReactionEvent {
  kind: 'reaction';
  externalMessageId: string;
  /** Network id of the message reacted to. */
  targetExternalId: string;
  /** Empty / null = reaction removed. */
  emoji: string | null;
}

export type InboundEvent = InboundMessageEvent | InboundReactionEvent;

export interface IngestInput {
  /** Tenancy — every row created downstream is stamped with it. */
  accountId: string;
  /** NOT NULL audit user for created rows (the channel owner). */
  auditUserId: string;
  channelType: ChannelType;
  channelId: string | null;
  sender: InboundSender;
  event: InboundEvent;
}

export interface IngestResult {
  contactId: string;
  conversationId: string;
}

export async function ingestInbound(
  db: SupabaseClient,
  input: IngestInput
): Promise<IngestResult | null> {
  const { accountId, auditUserId, channelType, channelId, sender, event } = input;

  const resolved = await resolveSenderContact(db, { accountId, auditUserId, channelType, sender });
  if (!resolved) return null;
  const contactId: string = resolved.contact.id;

  const convResult = await findOrCreateConversation(db, {
    accountId,
    auditUserId,
    contactId,
    channelId,
    identityId: resolved.identityId,
  });
  if (!convResult) return null;
  const conversation = convResult.conversation;
  const result = { contactId, conversationId: conversation.id as string };

  // Emitted as soon as the thread opens — BEFORE the reaction
  // short-circuit — so a conversation first opened by a reaction still
  // fires it, and subscribers see it before the first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactId,
    });
  }

  // Reactions aren't messages: no `messages` row, no unread bump.
  if (event.kind === 'reaction') {
    await handleReaction(db, event, conversation.id, contactId);
    return result;
  }

  // Providers retry when an acknowledgement is delayed. A retry must not
  // increment unread or run automations twice for the same network message.
  const { data: priorDelivery } = await db.from('messages').select('id')
    .eq('conversation_id', conversation.id).eq('message_id', event.externalMessageId)
    .maybeSingle();
  if (priorDelivery) return result;

  let replyToInternalId: string | null = null;
  if (event.replyToExternalId) {
    replyToInternalId = await lookupInternalId(db, event.replyToExternalId, conversation.id);
    if (!replyToInternalId) {
      console.warn('[channels] reply context parent not found:', event.replyToExternalId);
    }
  }

  // Counted BEFORE the insert. Also catches contacts that already
  // existed (manual add / CSV import) but never wrote to us, which
  // new_contact_created alone wouldn't.
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: event.contentType,
    content_text: event.text,
    media_url: event.mediaUrl,
    message_id: event.externalMessageId,
    status: 'delivered',
    created_at: event.sentAt.toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: event.interactiveReplyId,
  });
  if (msgError) {
    console.error('[channels] error inserting inbound message:', msgError);
    return null;
  }

  const { error: convError } = await db
    .from('conversations')
    .update({
      last_message_text: event.text || event.previewFallback,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);
  if (convError) {
    console.error('[channels] error updating conversation:', convError);
  }

  await flagBroadcastReplyIfAny(db, accountId, contactId);

  // ---- Flows ---------------------------------------------------
  // Awaited: whether a flow consumed the message decides the rest. A
  // customer navigating a bot menu isn't sending a fresh trigger word,
  // so content-level automations and the AI stand down; relationship
  // triggers (new contact / first message) still fire.
  const inboundText = event.text ?? '';
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: auditUserId,
    contactId,
    conversationId: conversation.id,
    message: event.interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: event.interactiveReplyId,
          reply_title: inboundText,
          meta_message_id: event.externalMessageId,
        }
      : { kind: 'text', text: inboundText, meta_message_id: event.externalMessageId },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  // ---- Automations ---------------------------------------------
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    if (event.interactiveReplyId) automationTriggers.push('interactive_reply');
  }
  if (resolved.wasCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message');

  // Awaited, not fire-and-forget: callers run this inside `after()`,
  // which only keeps the function alive for promises it can see —
  // a detached dispatch can be frozen mid-run (issues #301, #409).
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: event.interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }

  // ---- AI auto-reply -------------------------------------------
  // Only plain text the flow runner didn't consume (flows win over the
  // LLM). Owns its eligibility gates and never throws.
  if (!flowConsumed && !event.interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId,
      configOwnerUserId: auditUserId,
    });
  }

  // ---- Public webhooks -----------------------------------------
  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactId,
    channel: channelType,
    // Field name kept for the public API contract (it predates channels).
    whatsapp_message_id: event.externalMessageId,
    content_type: event.contentType,
    text: event.text,
  });

  return result;
}

/**
 * Network message id → our `messages.id`, scoped to one conversation.
 * Null when we never received the parent (older than this install).
 * Not unique across numbers (migration 009), hence the scoping.
 */
async function lookupInternalId(
  db: SupabaseClient,
  externalId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('message_id', externalId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    console.error('[channels] lookupInternalId failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Reactions are per-(target, actor) state on `message_reactions`.
 * A missing parent is logged and skipped so the caller still acks.
 */
async function handleReaction(
  db: SupabaseClient,
  event: InboundReactionEvent,
  conversationId: string,
  contactId: string
) {
  const targetInternalId = await lookupInternalId(db, event.targetExternalId, conversationId);
  if (!targetInternalId) {
    console.warn('[channels] reaction target message not found; skipping', event.targetExternalId);
    return;
  }

  if (!event.emoji) {
    const { error } = await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (error) console.error('[channels] reaction delete failed:', error.message);
    return;
  }

  const { error } = await db.from('message_reactions').upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_id: contactId,
      emoji: event.emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  );
  if (error) console.error('[channels] reaction upsert failed:', error.message);
}

/**
 * If the sender is on a still-unreplied broadcast recipient row, flip
 * it to `replied` so the parent broadcast's reply count advances.
 * Best-effort — must never break the inbound flow.
 */
async function flagBroadcastReplyIfAny(db: SupabaseClient, accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !recs || recs.length === 0) return;

    const { error: updErr } = await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id);
    if (updErr) console.error('[channels] marking broadcast recipient replied failed:', updErr);
  } catch (err) {
    console.error('[channels] flagBroadcastReplyIfAny failed:', err);
  }
}
