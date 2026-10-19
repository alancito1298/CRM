// ============================================================
// Where does a reply in this conversation go?
//
// Resolves conversation → channel + recipient address + adapter. Every
// outbound path (inbox, public API, bots) goes through here, so "reply
// through the channel the conversation came in on" is decided once.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { getChannelAdapter } from './registry';
import {
  InvalidRecipientError,
  type ChannelAdapter,
  type ChannelRow,
  type ChannelType,
  type ContactIdentityRow,
} from './types';

export interface ConversationRoute {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversation: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: Record<string, any>;
  channelType: ChannelType;
  channel: ChannelRow | null;
  identity: ContactIdentityRow | null;
  adapter: ChannelAdapter;
  recipient: { contactId: string; externalId: string };
}

/**
 * Load the route for `conversationId` within `accountId`, or null when
 * the conversation doesn't exist in that account. Throws
 * {@link InvalidRecipientError} when the contact has no address on the
 * conversation's channel.
 */
export async function loadConversationRoute(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<ConversationRoute | null> {
  const { data: conversation, error } = await db
    .from('conversations')
    .select('*, contact:contacts(*), channel:channels(*), identity:contact_identities(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (error || !conversation) return null;
  return routeFromConversation(conversation);
}

/** Build the route from an already-loaded conversation row (with joins). */
export function routeFromConversation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversation: Record<string, any>
): ConversationRoute {
  const contact = conversation.contact ?? {};
  const channel = (conversation.channel ?? null) as ChannelRow | null;
  const identity = (conversation.identity ?? null) as ContactIdentityRow | null;

  // Conversations predating channels (no channel_id yet) are WhatsApp.
  const channelType: ChannelType = channel?.type ?? identity?.channel_type ?? 'whatsapp';

  const externalId =
    identity?.external_id ?? (channelType === 'whatsapp' ? contact.phone : null);
  if (!externalId) {
    throw new InvalidRecipientError(
      channelType === 'whatsapp'
        ? 'Contact phone number not found'
        : `Contact has no ${channelType} address`
    );
  }

  return {
    conversation,
    contact,
    channelType,
    channel,
    identity,
    adapter: getChannelAdapter(channelType),
    recipient: { contactId: contact.id ?? conversation.contact_id, externalId },
  };
}
