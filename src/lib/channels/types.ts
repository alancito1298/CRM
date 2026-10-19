// ============================================================
// Messaging-channel contract.
//
// The inbox, the bots (Flows, Automations, AI auto-reply) and the
// public API work with conversations, never with a specific network.
// Each network (WhatsApp, Instagram, …) plugs in as a `ChannelAdapter`
// registered in `./registry`; the conversation's `channel_id` decides
// which adapter delivers a reply, so a message always leaves through
// the channel it came in on.
//
// Provider-level choices inside a channel (Meta Cloud API vs Twilio vs
// WA Web for WhatsApp) stay inside that channel's integration.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { OutboundMessage, SendOptions } from '@/lib/whatsapp/providers/types';

export type ChannelType = 'whatsapp' | 'instagram';

export type ChannelStatus = 'connected' | 'pending' | 'disconnected' | 'error';

/** What a channel supports. UI and senders branch on this, never on the type. */
export interface ChannelCapabilities {
  /** Pre-approved templates (needed to message outside the reply window). */
  templates: boolean;
  /** Bulk sends to many contacts. */
  broadcasts: boolean;
  /** Buttons / list messages. */
  interactive: boolean;
  media: readonly MediaKind[];
  reactions: boolean;
  /** Quoting a previous message when replying. */
  replyContext: boolean;
  /** Hours after the customer's last message during which free-form
   *  replies are accepted; null when the channel has no such window. */
  replyWindowHours: number | null;
}

/** A row of `channels`. */
export interface ChannelRow {
  id: string;
  account_id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  external_id: string | null;
  whatsapp_config_id: string | null;
  metadata: Record<string, unknown>;
}

/** A row of `contact_identities`. */
export interface ContactIdentityRow {
  id: string;
  account_id: string;
  contact_id: string;
  channel_type: ChannelType;
  external_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/** Channel-neutral outbound message. */
export type ChannelMessage = OutboundMessage;
export type ChannelSendOptions = SendOptions;

/** Who a send goes to, already resolved from the conversation. */
export interface ChannelRecipient {
  contactId: string;
  /** Address on the channel: phone (WhatsApp), IGSID (Instagram). */
  externalId: string;
}

export interface ChannelSendContext {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  /** NULL only for legacy conversations not yet linked to a channel. */
  channel: ChannelRow | null;
  recipient: ChannelRecipient;
}

export interface ChannelSendResult {
  /** Network-side message id (wamid, Twilio SID, Instagram mid, …). */
  messageId: string;
  /** Set when the message was flattened to plain text on the way out. */
  renderedText?: string;
  /** Provider/transport label for logs and error messages. */
  via: string;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;
  send(
    ctx: ChannelSendContext,
    message: ChannelMessage,
    options?: ChannelSendOptions
  ): Promise<ChannelSendResult>;
}

/** The channel has no working connection for the account. */
export class ChannelNotConfiguredError extends Error {
  readonly channelType: ChannelType;
  constructor(channelType: ChannelType, message: string) {
    super(message);
    this.name = 'ChannelNotConfiguredError';
    this.channelType = channelType;
  }
}

/** The recipient address can't be used on this channel. */
export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}

/** The channel can't carry this kind of message (e.g. templates on Instagram). */
export class UnsupportedMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMessageError';
  }
}
