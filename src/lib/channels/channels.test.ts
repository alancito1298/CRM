import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { resolveProvider, sendWithPhoneVariants } = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  sendWithPhoneVariants: vi.fn(),
}));
vi.mock('@/lib/whatsapp/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/providers')>()),
  resolveProvider,
  sendWithPhoneVariants,
}));

import { WhatsAppNotConfiguredError } from '@/lib/whatsapp/providers';
import { whatsappChannel } from '@/lib/whatsapp/channel-adapter';
import { routeFromConversation } from './conversation-route';
import { assertChannelSupports } from './registry';
import {
  ChannelNotConfiguredError,
  InvalidRecipientError,
  UnsupportedMessageError,
  type ChannelCapabilities,
} from './types';

describe('routeFromConversation', () => {
  const contact = { id: 'ct-1', phone: '+54 9 11 1111-2222' };

  it('treats a conversation without channel as WhatsApp and sends to the contact phone', () => {
    const route = routeFromConversation({ id: 'cv-1', contact_id: 'ct-1', contact });
    expect(route.channelType).toBe('whatsapp');
    expect(route.adapter).toBe(whatsappChannel);
    expect(route.recipient).toEqual({ contactId: 'ct-1', externalId: contact.phone });
  });

  it("prefers the identity's address over the contact phone", () => {
    const route = routeFromConversation({
      id: 'cv-1',
      contact,
      channel: { id: 'ch-1', type: 'whatsapp' },
      identity: { id: 'id-1', channel_type: 'whatsapp', external_id: '5491111112222' },
    });
    expect(route.recipient.externalId).toBe('5491111112222');
  });

  it('refuses a WhatsApp conversation whose contact has no phone', () => {
    expect(() => routeFromConversation({ id: 'cv-1', contact: { id: 'ct-1', phone: null } })).toThrow(
      InvalidRecipientError
    );
  });

  it('never falls back to the phone on a non-WhatsApp channel', () => {
    expect(() =>
      routeFromConversation({ id: 'cv-1', contact, channel: { id: 'ch-2', type: 'instagram' } })
    ).toThrow(/no instagram address/);
  });

  it('routes an Instagram identity through Instagram', () => {
    const route = routeFromConversation({
      id: 'cv-1',
      contact: { id: 'ct-1', phone: null },
      channel: { id: 'ch-2', type: 'instagram' },
      identity: { id: 'id-2', channel_type: 'instagram', external_id: 'IGSID-1' },
    });
    expect(route.adapter.type).toBe('instagram');
    expect(route.recipient.externalId).toBe('IGSID-1');
  });
});

describe('assertChannelSupports', () => {
  const textOnly: ChannelCapabilities = {
    templates: false,
    broadcasts: false,
    interactive: false,
    media: ['image'],
    reactions: false,
    replyContext: false,
    replyWindowHours: 24,
  };

  it('accepts what the channel declares', () => {
    expect(() => assertChannelSupports('instagram', textOnly, { type: 'text', text: 'hola' })).not.toThrow();
    expect(() =>
      assertChannelSupports('instagram', textOnly, { type: 'media', kind: 'image', url: 'https://x/a.png' })
    ).not.toThrow();
  });

  it('rejects templates, interactive and undeclared media kinds', () => {
    expect(() =>
      assertChannelSupports('instagram', textOnly, { type: 'template', name: 'promo', language: 'es' })
    ).toThrow(UnsupportedMessageError);
    expect(() =>
      assertChannelSupports('instagram', textOnly, {
        type: 'interactive',
        payload: { kind: 'buttons', body: 'b', buttons: [{ id: 'a', title: 'A' }] },
      })
    ).toThrow(UnsupportedMessageError);
    expect(() =>
      assertChannelSupports('instagram', textOnly, { type: 'media', kind: 'audio', url: 'https://x/a.ogg' })
    ).toThrow(/does not support audio messages/);
  });
});

describe('whatsappChannel.send', () => {
  const update = vi.fn(() => ({ eq: vi.fn() }));
  const db = { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient;
  const ctx = {
    db,
    accountId: 'acct-1',
    conversationId: 'conv-1',
    channel: null,
    recipient: { contactId: 'ct-1', externalId: '+54 9 11 1111-2222' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveProvider.mockResolvedValue({ id: 'meta' });
  });

  it('sends to the sanitized phone and reports the provider', async () => {
    sendWithPhoneVariants.mockResolvedValue({ messageId: 'wamid-1', phone: '5491111112222' });
    const out = await whatsappChannel.send(ctx, { type: 'text', text: 'hola' });
    expect(sendWithPhoneVariants).toHaveBeenCalledWith(
      { id: 'meta' },
      '5491111112222',
      { type: 'text', text: 'hola' },
      undefined
    );
    expect(out).toEqual({ messageId: 'wamid-1', renderedText: undefined, via: 'meta' });
    expect(update).not.toHaveBeenCalled();
  });

  it('persists the phone variant that worked', async () => {
    sendWithPhoneVariants.mockResolvedValue({ messageId: 'wamid-2', phone: '54911011112222' });
    await whatsappChannel.send(ctx, { type: 'text', text: 'hola' });
    expect(update).toHaveBeenCalledWith({ phone: '54911011112222' });
  });

  it('maps a missing provider to ChannelNotConfiguredError', async () => {
    resolveProvider.mockRejectedValue(new WhatsAppNotConfiguredError());
    await expect(whatsappChannel.send(ctx, { type: 'text', text: 'hola' })).rejects.toBeInstanceOf(
      ChannelNotConfiguredError
    );
  });

  it('rejects an invalid phone before resolving a provider', async () => {
    await expect(
      whatsappChannel.send(
        { ...ctx, recipient: { contactId: 'ct-1', externalId: '12' } },
        { type: 'text', text: 'hola' }
      )
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
