import { createHmac, timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestInbound, type InboundContentType, type InboundSender } from '@/lib/channels';
import { fetchInstagramProfile, getInstagramToken } from '@/lib/instagram/client';

export const maxDuration = 60;

interface InstagramMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    reply_to?: { mid?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  reaction?: { mid?: string; emoji?: string; action?: string };
  postback?: { payload?: string; title?: string; mid?: string };
}

interface InstagramWebhook {
  object?: string;
  entry?: Array<{ id?: string; messaging?: InstagramMessagingEvent[] }>;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (token && url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === token) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.INSTAGRAM_APP_SECRET;
  const header = request.headers.get('x-hub-signature-256');
  if (!secret || !header?.startsWith('sha256=')) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const receivedBytes = Buffer.from(header);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(receivedBytes, expectedBytes)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: InstagramWebhook;
  try { payload = JSON.parse(raw) as InstagramWebhook; }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }
  if (payload.object !== 'instagram') return NextResponse.json({ error: 'Invalid object' }, { status: 400 });

  after(async () => {
    for (const entry of payload.entry ?? []) {
      if (!entry.id) continue;
      const db = supabaseAdmin();
      const { data: channel } = await db.from('channels')
        .select('id, account_id').eq('type', 'instagram')
        .eq('external_id', entry.id).eq('status', 'connected').maybeSingle();
      if (!channel) continue;
      const { data: account } = await db.from('accounts').select('owner_user_id')
        .eq('id', channel.account_id).single();
      if (!account) continue;
      // Also keeps the long-lived token refreshed while the account is active.
      const token = await getInstagramToken(channel.account_id, channel.id).catch(() => null);

      for (const item of entry.messaging ?? []) {
        try {
          const senderId = item.sender?.id;
          if (!senderId || senderId === entry.id || item.message?.is_echo) continue;
          const sender = await describeSender(db, channel.account_id, senderId, token);
          const event = item.message;
          const reaction = item.reaction;
          const postback = item.postback;
          if (reaction?.mid) {
            await ingestInbound(db, {
              accountId: channel.account_id, auditUserId: account.owner_user_id,
              channelType: 'instagram', channelId: channel.id,
              sender,
              event: { kind: 'reaction', externalMessageId: reaction.mid,
                targetExternalId: reaction.mid,
                emoji: reaction.action === 'unreact' ? null : reaction.emoji ?? null },
            });
            continue;
          }
          if (!event?.mid && !postback?.mid) continue;
          const attachment = event?.attachments?.[0];
          const type = attachment?.type === 'image' || attachment?.type === 'video' ||
            attachment?.type === 'audio' ? attachment.type : attachment ? 'document' :
            postback ? 'interactive' : 'text';
          await ingestInbound(db, {
            accountId: channel.account_id, auditUserId: account.owner_user_id,
            channelType: 'instagram', channelId: channel.id,
            sender,
            event: {
              kind: 'message', externalMessageId: event?.mid ?? postback!.mid!,
              sentAt: new Date(item.timestamp ?? Date.now()),
              contentType: type as InboundContentType,
              text: event?.text ?? postback?.title ?? null,
              mediaUrl: attachment?.payload?.url ?? null,
              interactiveReplyId: postback?.payload ?? null,
              replyToExternalId: event?.reply_to?.mid ?? null,
              previewFallback: `[${type}]`,
            },
          });
        } catch (error) {
          console.error('[instagram] inbound event failed:', error);
        }
      }
    }
  });
  return NextResponse.json({ received: true });
}

/** Sender with its Instagram profile, fetched only until we have a username. */
async function describeSender(
  db: SupabaseClient, accountId: string, senderId: string, token: string | null,
): Promise<InboundSender> {
  if (!token) return { externalId: senderId };
  const { data: identity } = await db.from('contact_identities').select('username')
    .eq('account_id', accountId).eq('channel_type', 'instagram')
    .eq('external_id', senderId).maybeSingle();
  if (identity?.username) return { externalId: senderId };
  const profile = await fetchInstagramProfile(senderId, token);
  return {
    externalId: senderId,
    displayName: profile?.name ?? null,
    username: profile?.username ?? null,
    avatarUrl: profile?.profilePic ?? null,
  };
}
