import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  resolveSenderContact: vi.fn(),
  findOrCreateConversation: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
}));
vi.mock('./sender-resolution', () => ({
  resolveSenderContact: mocks.resolveSenderContact,
  findOrCreateConversation: mocks.findOrCreateConversation,
}));
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: mocks.dispatchInboundToFlows }));
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: mocks.runAutomationsForTrigger }));
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: mocks.dispatchInboundToAiReply }));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: mocks.dispatchWebhookEvent }));

import { ingestInbound, type IngestInput } from './ingest';

// Chainable stub: every query resolves to `result(table)`; writes are recorded.
const writes: Array<{ table: string; op: string; payload: unknown }> = [];
let priorCustomerMessages = 0;

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = vi.fn(chain);
      for (const op of ['insert', 'update', 'upsert', 'delete']) {
        b[op] = vi.fn((payload: unknown) => {
          writes.push({ table, op, payload });
          return b;
        });
      }
      const result = () =>
        table === 'messages'
          ? { data: null, error: null, count: priorCustomerMessages }
          : { data: [], error: null };
      b.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      b.then = (resolve: (v: unknown) => unknown) => resolve(result());
      return b;
    },
  } as unknown as SupabaseClient;
}

const base: Omit<IngestInput, 'event'> = {
  accountId: 'acct-1',
  auditUserId: 'user-1',
  channelType: 'instagram',
  channelId: 'ch-ig',
  sender: { externalId: 'IGSID-1', username: 'ana' },
};

const textEvent = {
  kind: 'message' as const,
  externalMessageId: 'mid-1',
  sentAt: new Date('2026-10-19T12:00:00Z'),
  contentType: 'text' as const,
  text: 'hola',
  mediaUrl: null,
  interactiveReplyId: null,
  previewFallback: '[text]',
};

describe('ingestInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writes.length = 0;
    priorCustomerMessages = 3;
    mocks.resolveSenderContact.mockResolvedValue({
      contact: { id: 'ct-1' },
      identityId: 'id-1',
      wasCreated: false,
    });
    mocks.findOrCreateConversation.mockResolvedValue({
      conversation: { id: 'cv-1', unread_count: 2 },
      created: false,
    });
    mocks.dispatchInboundToFlows.mockResolvedValue({ consumed: false });
    mocks.runAutomationsForTrigger.mockResolvedValue(undefined);
  });

  it('stores the message on the channel conversation and runs every responder', async () => {
    const out = await ingestInbound(makeDb(), { ...base, event: textEvent });

    expect(out).toEqual({ contactId: 'ct-1', conversationId: 'cv-1' });
    expect(mocks.findOrCreateConversation).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acct-1',
      auditUserId: 'user-1',
      contactId: 'ct-1',
      channelId: 'ch-ig',
      identityId: 'id-1',
    });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: 'messages',
        op: 'insert',
        payload: expect.objectContaining({ sender_type: 'customer', message_id: 'mid-1', content_text: 'hola' }),
      })
    );
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: 'conversations',
        op: 'update',
        payload: expect.objectContaining({ last_message_text: 'hola', unread_count: 3 }),
      })
    );
    expect(mocks.runAutomationsForTrigger.mock.calls.map(([a]) => a.triggerType)).toEqual([
      'new_message_received',
      'keyword_match',
    ]);
    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalledOnce();
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'message.received',
      expect.objectContaining({ channel: 'instagram', whatsapp_message_id: 'mid-1' })
    );
  });

  it('adds the relationship triggers for a new contact writing for the first time', async () => {
    priorCustomerMessages = 0;
    mocks.resolveSenderContact.mockResolvedValue({ contact: { id: 'ct-1' }, identityId: 'id-1', wasCreated: true });
    mocks.findOrCreateConversation.mockResolvedValue({ conversation: { id: 'cv-1' }, created: true });

    await ingestInbound(makeDb(), { ...base, event: textEvent });

    expect(mocks.runAutomationsForTrigger.mock.calls.map(([a]) => a.triggerType)).toEqual([
      'first_inbound_message',
      'new_contact_created',
      'new_message_received',
      'keyword_match',
    ]);
    expect(mocks.dispatchWebhookEvent.mock.calls[0][2]).toBe('conversation.created');
  });

  it('lets a consuming flow silence content automations and the AI', async () => {
    mocks.dispatchInboundToFlows.mockResolvedValue({ consumed: true });
    await ingestInbound(makeDb(), { ...base, event: textEvent });
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('routes a button tap to the flow as an interactive reply, never to the AI', async () => {
    await ingestInbound(makeDb(), {
      ...base,
      event: { ...textEvent, contentType: 'interactive', text: 'Sí', interactiveReplyId: 'yes' },
    });
    expect(mocks.dispatchInboundToFlows.mock.calls[0][0].message).toEqual({
      kind: 'interactive_reply',
      reply_id: 'yes',
      reply_title: 'Sí',
      meta_message_id: 'mid-1',
    });
    expect(mocks.runAutomationsForTrigger.mock.calls.map(([a]) => a.triggerType)).toContain('interactive_reply');
    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('handles a reaction without creating a message', async () => {
    await ingestInbound(makeDb(), {
      ...base,
      event: { kind: 'reaction', externalMessageId: 'mid-2', targetExternalId: 'mid-1', emoji: '👍' },
    });
    expect(writes.filter((w) => w.table === 'messages')).toEqual([]);
    expect(mocks.dispatchInboundToFlows).not.toHaveBeenCalled();
  });

  it('stops quietly when the sender cannot be resolved', async () => {
    mocks.resolveSenderContact.mockResolvedValue(null);
    expect(await ingestInbound(makeDb(), { ...base, event: textEvent })).toBeNull();
    expect(mocks.findOrCreateConversation).not.toHaveBeenCalled();
  });
});
