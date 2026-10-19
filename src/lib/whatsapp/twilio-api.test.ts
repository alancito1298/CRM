import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTwilioSignature } from './twilio-api';

describe('Twilio webhook signature', () => {
  const url = 'https://crm.example.com/api/whatsapp/twilio/webhook';
  const params = { From: 'whatsapp:+15551234567', To: 'whatsapp:+15557654321', Body: 'hola' };
  const authToken = 'test-auth-token';
  const payload = url + Object.keys(params).sort()
    .map((key) => key + params[key as keyof typeof params]).join('');
  const signature = createHmac('sha1', authToken).update(payload).digest('base64');

  it('accepts the complete signed URL and all form fields', () => {
    expect(verifyTwilioSignature({ url, params, authToken, signature })).toBe(true);
  });

  it('rejects tampering and malformed signatures without throwing', () => {
    expect(verifyTwilioSignature({ url, params: { ...params, Body: 'changed' }, authToken, signature })).toBe(false);
    expect(verifyTwilioSignature({ url, params, authToken, signature: 'x' })).toBe(false);
    expect(verifyTwilioSignature({ url, params, authToken, signature: null })).toBe(false);
  });
});
