import { NextResponse, after } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { verifyTwilioSignature } from '@/lib/whatsapp/twilio-api';
import { resolveWhatsAppChannelId } from '@/lib/whatsapp/channel-adapter';
import { ingestInbound, type InboundContentType } from '@/lib/channels';

export const maxDuration = 60;

let _adminClient: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

export async function POST(request: Request) {
  try {
    const { TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_ID, TWILIO_PHONE_NUMBER } = process.env;
    if (!TWILIO_AUTH_TOKEN || !TWILIO_ACCOUNT_ID || !TWILIO_PHONE_NUMBER) {
      console.error('[Twilio Webhook] Missing account, number, or auth token configuration.');
      return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 });
    }

    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = value.toString();
    });

    if (!verifyTwilioSignature({
      authToken: TWILIO_AUTH_TOKEN,
      signature: request.headers.get('x-twilio-signature'),
      url: request.url,
      params,
    })) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const from = params.From || '';
    const to = params.To || '';
    const body = params.Body || '';
    const profileName = params.ProfileName || null;
    const messageSid = params.MessageSid || '';
    const numMedia = parseInt(params.NumMedia || '0', 10);
    const mediaUrl = numMedia > 0 ? params.MediaUrl0 : null;
    const mediaContentType = numMedia > 0 ? params.MediaContentType0 : null;

    const rawSender = from.replace(/^whatsapp:/i, '');
    const rawRecipient = to.replace(/^whatsapp:/i, '');
    const senderPhone = normalizePhone(rawSender);
    if (!senderPhone || normalizePhone(rawRecipient) !== normalizePhone(TWILIO_PHONE_NUMBER)) {
      return NextResponse.json({ error: 'Unknown recipient' }, { status: 403 });
    }

    after(async () => {
      try {
        await processTwilioWebhook({
          accountId: TWILIO_ACCOUNT_ID,
          senderPhone,
          profileName,
          body,
          messageSid,
          mediaUrl,
          mediaContentType,
        });
      } catch (error) {
        console.error('[Twilio Webhook] Error processing message:', error);
      }
    });

    return new Response('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('[Twilio Webhook] Handler error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function processTwilioWebhook({
  accountId,
  senderPhone,
  profileName,
  body,
  messageSid,
  mediaUrl,
  mediaContentType,
}: {
  accountId: string;
  senderPhone: string;
  profileName: string | null;
  body: string;
  messageSid: string;
  mediaUrl: string | null;
  mediaContentType: string | null;
}) {
  const { data: account, error } = await supabaseAdmin()
    .from('accounts')
    .select('id, owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  if (error || !account) {
    console.error('[Twilio Webhook] Configured account not found:', error);
    return;
  }

  let contentType: InboundContentType = 'text';
  if (mediaContentType) {
    if (mediaContentType.startsWith('image/')) contentType = 'image';
    else if (mediaContentType.startsWith('video/')) contentType = 'video';
    else if (mediaContentType.startsWith('audio/')) contentType = 'audio';
    else contentType = 'document';
  }

  await ingestInbound(supabaseAdmin(), {
    accountId,
    auditUserId: account.owner_user_id,
    channelType: 'whatsapp',
    channelId: await resolveWhatsAppChannelId(supabaseAdmin(), accountId),
    sender: { externalId: senderPhone, displayName: profileName },
    event: {
      kind: 'message',
      externalMessageId: messageSid || `twilio-${Date.now()}`,
      sentAt: new Date(),
      contentType,
      text: body || null,
      mediaUrl,
      interactiveReplyId: null,
      previewFallback: `[${contentType}]`,
    },
  });
}
