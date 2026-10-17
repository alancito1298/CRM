// Twilio WhatsApp API. Text + media only; templates/interactive are
// flattened to text.

import { sendTwilioMessage } from '@/lib/whatsapp/twilio-api';
import { renderAsText } from './render-text';
import type { WhatsAppProvider } from './types';

export function createTwilioProvider(cfg: {
  accountSid: string;
  authToken: string;
  from: string;
}): WhatsAppProvider {
  return {
    id: 'twilio',
    bulkDelayMs: () => 0,
    async send(to, msg) {
      const { text, mediaUrl, rendered } = renderAsText(msg);
      const result = await sendTwilioMessage({
        ...cfg,
        to,
        body: text || null,
        mediaUrl: mediaUrl || null,
      });
      return { messageId: result.messageSid, renderedText: rendered ? text : undefined };
    },
  };
}

/**
 * Twilio is configured per deployment (env), not per account — so it is
 * only a last-resort fallback: every account without its own provider
 * would share this one number.
 */
export function loadTwilioProvider(): WhatsAppProvider | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return createTwilioProvider({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    from: TWILIO_PHONE_NUMBER || '+14155238886',
  });
}
