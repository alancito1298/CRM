// ============================================================
// WhatsApp as a messaging channel.
//
// Bridges the channel contract (`@/lib/channels`) to the WhatsApp
// provider layer: provider resolution (WA Web → Meta → Twilio), the
// phone-variant retry and the contact auto-fix all stay here, so the
// channel-neutral senders never see a phone number.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import {
  resolveProvider,
  sendWithPhoneVariants,
  WhatsAppNotConfiguredError,
} from '@/lib/whatsapp/providers';
import {
  ChannelNotConfiguredError,
  InvalidRecipientError,
  type ChannelAdapter,
} from '@/lib/channels/types';

export const whatsappChannel: ChannelAdapter = {
  type: 'whatsapp',
  capabilities: {
    templates: true,
    broadcasts: true,
    interactive: true,
    media: ['image', 'video', 'document', 'audio'],
    reactions: true,
    replyContext: true,
    replyWindowHours: 24,
  },

  async send({ db, accountId, recipient }, message, options) {
    const phone = sanitizePhoneForMeta(recipient.externalId);
    if (!isValidE164(phone)) {
      throw new InvalidRecipientError(`Invalid phone number format: ${recipient.externalId}`);
    }

    let provider;
    try {
      provider = await resolveProvider(db, accountId);
    } catch (err) {
      if (err instanceof WhatsAppNotConfiguredError) {
        throw new ChannelNotConfiguredError('whatsapp', err.message);
      }
      throw err;
    }

    const sent = await sendWithPhoneVariants(provider, phone, message, options);

    // Persist the variant that worked so the next send goes straight
    // through. The contacts trigger (migration 043) moves the WhatsApp
    // identity along with it.
    if (sent.phone !== phone) {
      console.log(`[whatsapp] auto-corrected contact phone: ${phone} → ${sent.phone}`);
      await db.from('contacts').update({ phone: sent.phone }).eq('id', recipient.contactId);
    }

    return { messageId: sent.messageId, renderedText: sent.renderedText, via: provider.id };
  },
};

/**
 * The account's WhatsApp `channels` row id, created on demand by
 * `ensure_whatsapp_channel` (migration 043). Null if the lookup fails —
 * the conversation trigger then fills it in.
 */
export async function resolveWhatsAppChannelId(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data, error } = await db.rpc('ensure_whatsapp_channel', { p_account_id: accountId });
  if (error) {
    console.error('[whatsapp] ensure_whatsapp_channel failed:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}
