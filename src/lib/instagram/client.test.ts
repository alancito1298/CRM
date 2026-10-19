import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  decrypt: vi.fn(() => 'plain-token'),
}));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt, encrypt: vi.fn() }));

import { getInstagramToken, sendInstagramMessage } from './client';

describe('Instagram messaging client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads encrypted credentials with the service role and scopes them to account and channel', async () => {
    const calls: Array<[string, string]> = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: string) => { calls.push([column, value]); return query; }),
      single: vi.fn(async () => ({ data: {
        id: 'connection-1', access_token: 'encrypted',
        token_issued_at: new Date().toISOString(),
        token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      }, error: null })),
    };
    mocks.supabaseAdmin.mockReturnValue({ from: vi.fn(() => query) });

    await expect(getInstagramToken('account-1', 'channel-1')).resolves.toBe('plain-token');
    expect(calls).toEqual([['account_id', 'account-1'], ['channel_id', 'channel-1']]);
    expect(mocks.decrypt).toHaveBeenCalledWith('encrypted');
  });

  it('sends a reply to the Instagram sender through the channel account', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ message_id: 'mid-1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(sendInstagramMessage({
        userId: 'ig-business', recipientId: 'igsid-customer', token: 'token',
        text: 'hola', replyTo: 'mid-0',
      })).resolves.toBe('mid-1');
      const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://graph.instagram.com/v26.0/ig-business/messages');
      expect(JSON.parse(options.body as string)).toEqual({
        recipient: { id: 'igsid-customer' }, message: { text: 'hola' }, reply_to: { mid: 'mid-0' },
      });
    } finally { vi.unstubAllGlobals(); }
  });
});
