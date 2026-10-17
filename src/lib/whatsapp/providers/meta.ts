// Meta WhatsApp Cloud API (official). Native templates + interactive.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import type { WhatsAppProvider } from './types';

export function createMetaProvider(cfg: {
  phoneNumberId: string;
  accessToken: string;
}): WhatsAppProvider {
  const { phoneNumberId, accessToken } = cfg;
  const base = { phoneNumberId, accessToken };

  return {
    id: 'meta',
    // Meta enforces its own throughput limits; no client-side pacing.
    bulkDelayMs: () => 0,
    async send(to, msg, options = {}) {
      const { contextMessageId } = options;
      switch (msg.type) {
        case 'text':
          return sendTextMessage({ ...base, to, text: msg.text, contextMessageId });
        case 'media':
          return sendMediaMessage({
            ...base,
            to,
            kind: msg.kind,
            link: msg.url,
            caption: msg.caption,
            filename: msg.filename,
            contextMessageId,
          });
        case 'template':
          return sendTemplateMessage({
            ...base,
            to,
            templateName: msg.name,
            language: msg.language,
            template: msg.template ?? undefined,
            messageParams: msg.messageParams,
            params: msg.params ?? [],
            contextMessageId,
          });
        case 'interactive': {
          const p = msg.payload;
          if (p.kind === 'buttons') {
            return sendInteractiveButtons({
              ...base,
              to,
              bodyText: p.body,
              headerText: p.header || undefined,
              footerText: p.footer || undefined,
              buttons: p.buttons,
              contextMessageId,
            });
          }
          return sendInteractiveList({
            ...base,
            to,
            bodyText: p.body,
            buttonLabel: p.button_label,
            headerText: p.header || undefined,
            footerText: p.footer || undefined,
            sections: p.sections,
            contextMessageId,
          });
        }
      }
    },
  };
}

/**
 * Build the Meta provider from the account's `whatsapp_config`, or
 * null when it isn't fully configured / the token can't be decrypted.
 */
export async function loadMetaProvider(
  db: SupabaseClient,
  accountId: string
): Promise<WhatsAppProvider | null> {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id, phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!config?.phone_number_id || !config.access_token) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch (err) {
    console.warn('[whatsapp/meta] access_token decryption failed:', err);
    return null;
  }
  if (!accessToken) return null;

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn('[whatsapp/meta] access_token GCM upgrade failed:', error.message);
        }
      });
  }

  return createMetaProvider({ phoneNumberId: config.phone_number_id, accessToken });
}
