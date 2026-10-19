// WhatsApp Embedded Signup: the customer logs in with Facebook from the
// CRM, picks (or creates) a WhatsApp Business number, and Meta hands
// the browser a short-lived `code` plus the phone_number_id / waba_id.
// The server swaps the code for a business token and finishes the
// setup (subscribe + register) so nothing is configured by hand.

import { randomInt } from 'node:crypto';

const GRAPH = 'https://graph.facebook.com/v21.0';

export function embeddedSignupAppId(): string | undefined {
  return process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
}

/** Exchange the code from FB.login (Embedded Signup) for a business integration token. */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const appId = embeddedSignupAppId();
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Meta app credentials are missing');

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({})) as {
    access_token?: string; error?: { message?: string };
  };
  if (!response.ok || !data.access_token) {
    console.error('[whatsapp] embedded signup code exchange failed:', data.error?.message ?? response.status);
    throw new Error('Facebook authorization failed');
  }
  return data.access_token;
}

/** Random 6-digit two-step verification PIN for /register. */
export function generateRegistrationPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
