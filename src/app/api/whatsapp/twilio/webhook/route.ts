import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

export const maxDuration = 60;

let _adminClient: any = null;
function supabaseAdmin() {
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
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = value.toString();
    });

    const from = params.From || '';
    const to = params.To || '';
    const body = params.Body || '';
    const messageSid = params.MessageSid || '';
    const numMedia = parseInt(params.NumMedia || '0', 10);
    const mediaUrl = numMedia > 0 ? params.MediaUrl0 : null;
    const mediaContentType = numMedia > 0 ? params.MediaContentType0 : null;

    const rawSender = from.replace(/^whatsapp:/i, '');
    const rawRecipient = to.replace(/^whatsapp:/i, '');
    const senderPhone = normalizePhone(rawSender);

    after(async () => {
      try {
        await processTwilioWebhook({
          senderPhone,
          recipientPhone: rawRecipient,
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
  senderPhone,
  recipientPhone,
  body,
  messageSid,
  mediaUrl,
  mediaContentType,
}: {
  senderPhone: string;
  recipientPhone: string;
  body: string;
  messageSid: string;
  mediaUrl: string | null;
  mediaContentType: string | null;
}) {
  const { data: configRows } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .or(`phone_number_id.eq.${recipientPhone},waba_id.eq.${recipientPhone}`);

  let config = configRows && configRows.length > 0 ? configRows[0] : null;

  if (!config) {
    const { data: fallback } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('*')
      .limit(1)
      .maybeSingle();
    config = fallback;
  }

  if (!config) {
    console.error('[Twilio Webhook] No active whatsapp_config found in DB.');
    return;
  }

  const accountId = config.account_id;
  const configOwnerUserId = config.user_id;

  let contactRecord = await findExistingContact(supabaseAdmin(), accountId, senderPhone);
  let wasCreated = false;

  if (!contactRecord) {
    const { data: newContact, error: contactErr } = await supabaseAdmin()
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        phone: senderPhone,
        name: senderPhone,
      })
      .select()
      .single();

    if (contactErr || !newContact) {
      console.error('[Twilio Webhook] Error creating contact:', contactErr);
      return;
    }
    contactRecord = newContact;
    wasCreated = true;
  }

  if (!contactRecord) return;

  const { data: existingConvs } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactRecord.id)
    .order('created_at', { ascending: true })
    .limit(1);

  let conversation = existingConvs && existingConvs.length > 0 ? existingConvs[0] : null;

  if (!conversation) {
    const { data: newConv, error: convErr } = await supabaseAdmin()
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        contact_id: contactRecord.id,
      })
      .select()
      .single();

    if (convErr || !newConv) {
      console.error('[Twilio Webhook] Error creating conversation:', convErr);
      return;
    }
    conversation = newConv;
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    });
  }

  let contentType = 'text';
  if (mediaContentType) {
    if (mediaContentType.startsWith('image/')) contentType = 'image';
    else if (mediaContentType.startsWith('video/')) contentType = 'video';
    else if (mediaContentType.startsWith('audio/')) contentType = 'audio';
    else contentType = 'document';
  }

  const { error: msgErr } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: body || null,
    media_url: mediaUrl,
    message_id: messageSid || `twilio-${Date.now()}`,
    status: 'delivered',
    created_at: new Date().toISOString(),
  });

  if (msgErr) {
    console.error('[Twilio Webhook] Error inserting message:', msgErr);
    return;
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: body || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: body, meta_message_id: messageSid },
    isFirstInboundMessage: wasCreated,
  });

  await runAutomationsForTrigger({
    accountId,
    triggerType: 'new_message_received',
    contactId: contactRecord.id,
    context: { message_text: body, conversation_id: conversation.id },
  }).catch((err) => console.error('[Twilio Automations] Error:', err));
}
