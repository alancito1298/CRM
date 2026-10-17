import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { renderAsText, renderInteractiveText } from './render-text';
import { resolveProvider, sendWithPhoneVariants } from './resolve';
import { createWaWebProvider } from './wa-web';
import { WhatsAppNotConfiguredError, type WhatsAppProvider } from './types';
import type { MessageTemplate } from '@/types';

const template = {
  name: 'promo',
  header_type: 'text',
  header_content: 'Hola {{1}}',
  body_text: 'Tu código es {{1}} y vence el {{2}}',
  footer_text: 'Gracias',
  buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.test' }],
} as unknown as MessageTemplate;

describe('renderAsText', () => {
  it('passes text and media through unchanged', () => {
    expect(renderAsText({ type: 'text', text: 'hola' })).toEqual({ text: 'hola', rendered: false });
    expect(
      renderAsText({ type: 'media', kind: 'image', url: 'https://i.test/a.png', caption: 'c' })
    ).toEqual({ text: 'c', mediaUrl: 'https://i.test/a.png', rendered: false });
  });

  it('renders a template with header, body variables, footer and buttons', () => {
    const out = renderAsText({
      type: 'template',
      name: 'promo',
      language: 'es',
      template,
      messageParams: { body: ['ABC', 'lunes'], headerText: 'Ana' },
    });
    expect(out.rendered).toBe(true);
    expect(out.text).toBe(
      '*Hola Ana*\n\nTu código es ABC y vence el lunes\n\n_Gracias_\n\n👉 Ver: https://x.test'
    );
  });

  it('falls back to the template name without a local row', () => {
    expect(renderAsText({ type: 'template', name: 'promo', language: 'es' }).text).toBe('[promo]');
  });

  it('numbers interactive buttons', () => {
    const text = renderInteractiveText({
      kind: 'buttons',
      body: '¿Seguimos?',
      buttons: [
        { id: 'y', title: 'Sí' },
        { id: 'n', title: 'No' },
      ],
    });
    expect(text).toContain('¿Seguimos?');
    expect(text).toContain('1️⃣ *Sí*');
    expect(text).toContain('2️⃣ *No*');
  });
});

describe('sendWithPhoneVariants', () => {
  const fakeProvider = (send: WhatsAppProvider['send']): WhatsAppProvider => ({
    id: 'meta',
    bulkDelayMs: () => 0,
    send,
  });

  it('retries the next variant only on "recipient not allowed"', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('(#131030) Recipient phone number not in allowed list'))
      .mockResolvedValueOnce({ messageId: 'wamid.1' });
    const out = await sendWithPhoneVariants(fakeProvider(send), '5491112345678', {
      type: 'text',
      text: 'hi',
    });
    expect(out.messageId).toBe('wamid.1');
    expect(send).toHaveBeenCalledTimes(2);
    expect(out.phone).toBe(send.mock.calls[1][0]);
  });

  it('does not retry other errors', async () => {
    const send = vi.fn().mockRejectedValue(new Error('token expired'));
    await expect(
      sendWithPhoneVariants(fakeProvider(send), '5491112345678', { type: 'text', text: 'hi' })
    ).rejects.toThrow('token expired');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('resolveProvider', () => {
  const fetchMock = vi.fn();
  const env = { ...process.env };

  // whatsapp_config lookup → returns `config`.
  const dbWith = (config: unknown) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: config }) }) }),
      }),
    }) as unknown as SupabaseClient;

  const sessionStatus = (status: string) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status }), { status: 200 }));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    process.env = { ...env };
  });

  it('prefers a ready WA Web session', async () => {
    sessionStatus('ready');
    const p = await resolveProvider(dbWith(null), 'acc-1');
    expect(p.id).toBe('wa-web');
  });

  it('falls back to Twilio when nothing else is configured', async () => {
    sessionStatus('disconnected');
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    const p = await resolveProvider(dbWith(null), 'acc-1');
    expect(p.id).toBe('twilio');
  });

  it('throws WhatsAppNotConfiguredError when no provider is available', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(resolveProvider(dbWith(null), 'acc-1')).rejects.toBeInstanceOf(
      WhatsAppNotConfiguredError
    );
  });
});

describe('WA Web provider', () => {
  const fetchMock = vi.fn();
  const env = { ...process.env };
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    process.env = { ...env };
  });

  it('sends the shared-secret header and returns the rendered text', async () => {
    process.env.WA_SERVICE_TOKEN = 's3cret';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ messageId: 'w1' }), { status: 200 }));

    const out = await createWaWebProvider('acc-1').send('5491112345678', {
      type: 'template',
      name: 'promo',
      language: 'es',
      template,
      params: ['ABC', 'lunes'],
    });

    expect(out.messageId).toBe('w1');
    expect(out.renderedText).toContain('Tu código es ABC');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/sessions\/acc-1\/send$/);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer s3cret');
  });

  it('throws with the sidecar error message on failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'WhatsApp no conectado' }), { status: 503 })
    );
    await expect(
      createWaWebProvider('acc-1').send('5491112345678', { type: 'text', text: 'hi' })
    ).rejects.toThrow('WhatsApp no conectado');
  });
});
