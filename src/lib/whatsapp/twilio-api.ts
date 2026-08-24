import crypto from 'node:crypto';

export interface SendTwilioMessageParams {
  accountSid: string;
  authToken: string;
  from: string; // e.g. "whatsapp:+14155238886"
  to: string; // e.g. "whatsapp:+5491124742069"
  body?: string | null;
  mediaUrl?: string | null;
}

export interface TwilioSendResult {
  messageSid: string;
  status: string;
}

/**
 * Send an outbound message via Twilio's WhatsApp API.
 * Uses HTTP Basic Authentication with Account SID and Auth Token.
 */
export async function sendTwilioMessage({
  accountSid,
  authToken,
  from,
  to,
  body,
  mediaUrl,
}: SendTwilioMessageParams): Promise<TwilioSendResult> {
  const formattedFrom = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  const params = new URLSearchParams();
  params.append('From', formattedFrom);
  params.append('To', formattedTo);
  if (body) params.append('Body', body);
  if (mediaUrl) params.append('MediaUrl', mediaUrl);

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.message || data.detail || `Twilio error ${response.status}`;
    throw new Error(`[Twilio API] ${errorMsg}`);
  }

  return {
    messageSid: data.sid,
    status: data.status || 'queued',
  };
}

/**
 * Validate incoming Twilio webhook signature (`X-Twilio-Signature`).
 * Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature({
  authToken,
  signature,
  url,
  params,
}: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!signature || !authToken) return false;

  // Sort parameter keys alphabetically and construct string
  let data = url;
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expectedSignature = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf-8'),
    Buffer.from(expectedSignature, 'utf-8'),
  );
}
