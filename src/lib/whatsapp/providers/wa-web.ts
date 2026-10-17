// WhatsApp Web sidecar (whatsapp-service.mjs, one session per account,
// paired by QR / pairing code). Unofficial: text + media only, so
// templates and interactive messages are flattened to text.

import { renderAsText } from './render-text';
import type { WhatsAppProvider } from './types';

const DEFAULT_URL = 'http://localhost:3001';

/**
 * fetch() against the sidecar. Adds the shared-secret header when
 * `WA_SERVICE_TOKEN` is set (the sidecar rejects requests without it).
 * Every caller of the sidecar must go through here.
 */
export function waServiceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = process.env.WA_SERVICE_URL || DEFAULT_URL;
  const headers = new Headers(init.headers);
  const token = process.env.WA_SERVICE_TOKEN;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { cache: 'no-store', ...init, headers });
}

export interface WaWebSessionStatus {
  status: string;
  phone?: string | null;
  [key: string]: unknown;
}

/** Session status for an account; `disconnected` if the sidecar is down. */
export async function getWaWebSessionStatus(
  accountId: string,
  timeoutMs = 2000
): Promise<WaWebSessionStatus> {
  try {
    const res = await waServiceFetch(`/sessions/${accountId}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as WaWebSessionStatus;
  } catch {
    // sidecar not running / unreachable
  }
  return { status: 'disconnected' };
}

export function createWaWebProvider(accountId: string): WhatsAppProvider {
  return {
    id: 'wa-web',
    // Anti-ban pacing for bulk sends: 1.5s–2.5s between messages.
    bulkDelayMs: () => Math.floor(1500 + Math.random() * 1000),
    async send(to, msg) {
      const { text, mediaUrl, rendered } = renderAsText(msg);
      const contentType = msg.type === 'media' ? msg.kind : msg.type;

      const res = await waServiceFetch(`/sessions/${accountId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          message: text,
          mediaUrl,
          contentType,
          sendAudioAsVoice: contentType === 'audio',
          fromCrm: true,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(`[WA Web] ${err.error || `HTTP ${res.status}`}`);
      }
      const data = (await res.json()) as { messageId?: string };
      return {
        messageId: data.messageId || `wa-web-${Date.now()}`,
        renderedText: rendered ? text : undefined,
      };
    },
  };
}

/** WA Web provider if the account has a ready session, else null. */
export async function loadWaWebProvider(accountId: string): Promise<WhatsAppProvider | null> {
  const { status } = await getWaWebSessionStatus(accountId);
  return status === 'ready' ? createWaWebProvider(accountId) : null;
}
