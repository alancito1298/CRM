import type { SupabaseClient } from '@supabase/supabase-js';

import { isRecipientNotAllowedError, phoneVariants } from '@/lib/whatsapp/phone-utils';
import { loadMetaProvider } from './meta';
import { loadTwilioProvider } from './twilio';
import { loadWaWebProvider } from './wa-web';
import {
  WhatsAppNotConfiguredError,
  type OutboundMessage,
  type SendOptions,
  type WhatsAppProvider,
} from './types';

/**
 * Pick the provider an account sends through. The ONLY place that
 * decides precedence:
 *
 *   1. WA Web — the account explicitly paired a phone by QR and the
 *      session is live.
 *   2. Meta Cloud API — the account saved its own credentials.
 *   3. Twilio — deployment-wide fallback from env.
 *
 * Throws {@link WhatsAppNotConfiguredError} when none is available.
 * `db` must be able to read the account's `whatsapp_config`.
 */
export async function resolveProvider(
  db: SupabaseClient,
  accountId: string
): Promise<WhatsAppProvider> {
  const provider =
    (await loadWaWebProvider(accountId)) ??
    (await loadMetaProvider(db, accountId)) ??
    loadTwilioProvider();
  if (!provider) throw new WhatsAppNotConfiguredError();
  return provider;
}

/**
 * Send, retrying across phone-number variants (with/without trunk 0,
 * AR mobile 9, …) while the provider answers "recipient not allowed".
 * Returns the variant that worked so callers can fix the contact.
 */
export async function sendWithPhoneVariants(
  provider: WhatsAppProvider,
  phone: string,
  message: OutboundMessage,
  options?: SendOptions
): Promise<{ messageId: string; renderedText?: string; phone: string }> {
  let lastError: unknown = null;
  for (const variant of phoneVariants(phone)) {
    try {
      const result = await provider.send(variant, message, options);
      return { ...result, phone: variant };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(msg)) throw err;
      lastError = err;
      console.warn(`[whatsapp/${provider.id}] variant "${variant}" rejected, trying next…`);
    }
  }
  throw lastError ?? new Error('No phone variants to try');
}
