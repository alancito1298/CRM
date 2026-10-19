// One-off import of what Instagram lets us read for an account:
// existing DM conversations (Meta returns only the 20 most recent
// messages of each) and the people who commented on recent posts.
// Messages are written directly — no flows, automations or AI run for
// history.

import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateConversation, resolveSenderContact } from '@/lib/channels/sender-resolution';

const GRAPH = 'https://graph.instagram.com/v26.0';
const MAX_CONVERSATIONS = 100;
const MAX_MEDIA = 25;

interface GraphMessage {
  id: string;
  created_time: string;
  message?: string;
  from?: { id: string; username?: string };
  attachments?: { data?: Array<{ image_data?: { url?: string }; video_data?: { url?: string }; file_url?: string }> };
}

export interface ImportResult {
  conversations: number;
  messages: number;
  commenters: number;
}

async function get<T>(url: string | URL, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Instagram API ${response.status}`);
  return response.json() as Promise<T>;
}

export async function importInstagramHistory(db: SupabaseClient, args: {
  accountId: string;
  auditUserId: string;
  channelId: string;
  businessId: string;
  token: string;
}): Promise<ImportResult> {
  const result: ImportResult = { conversations: 0, messages: 0, commenters: 0 };
  await importConversations(db, args, result);
  await importCommenters(db, args, result).catch((error) => {
    // Needs instagram_business_manage_comments; older tokens lack it.
    console.warn('[instagram] commenter import skipped:', error);
  });
  return result;
}

async function importConversations(
  db: SupabaseClient,
  { accountId, auditUserId, channelId, businessId, token }: Parameters<typeof importInstagramHistory>[1],
  result: ImportResult,
) {
  let next: string | null = (() => {
    const url = new URL(`${GRAPH}/me/conversations`);
    url.searchParams.set('platform', 'instagram');
    url.searchParams.set('fields', 'id,participants,messages{id,created_time,message,from,attachments}');
    url.searchParams.set('limit', '25');
    return url.toString();
  })();

  while (next && result.conversations < MAX_CONVERSATIONS) {
    const page: {
      data?: Array<{ participants?: { data?: Array<{ id: string; username?: string }> }; messages?: { data?: GraphMessage[] } }>;
      paging?: { next?: string };
    } = await get(next, token);

    for (const thread of page.data ?? []) {
      const customer = thread.participants?.data?.find((p) => p.id !== businessId);
      if (!customer) continue;
      const sender = await resolveSenderContact(db, {
        accountId, auditUserId, channelType: 'instagram',
        sender: { externalId: customer.id, username: customer.username ?? null, displayName: customer.username ?? null },
      });
      if (!sender) continue;
      const conv = await findOrCreateConversation(db, {
        accountId, auditUserId, contactId: sender.contact.id, channelId, identityId: sender.identityId,
      });
      if (!conv) continue;
      result.conversations += 1;

      const messages = [...(thread.messages?.data ?? [])]
        .sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
      const ids = messages.map((m) => m.id);
      const { data: existing } = ids.length
        ? await db.from('messages').select('message_id').eq('conversation_id', conv.conversation.id).in('message_id', ids)
        : { data: [] };
      const known = new Set((existing ?? []).map((row) => row.message_id));

      const rows = messages.filter((m) => !known.has(m.id)).map((m) => {
        const attachment = m.attachments?.data?.[0];
        const mediaUrl = attachment?.image_data?.url ?? attachment?.video_data?.url ?? attachment?.file_url ?? null;
        return {
          conversation_id: conv.conversation.id,
          sender_type: m.from?.id === businessId ? 'agent' : 'customer',
          content_type: attachment?.video_data ? 'video' : attachment?.image_data ? 'image' : attachment ? 'document' : 'text',
          content_text: m.message ?? null,
          media_url: mediaUrl,
          message_id: m.id,
          status: 'delivered',
          created_at: new Date(m.created_time).toISOString(),
        };
      });
      if (rows.length > 0) {
        const { error } = await db.from('messages').insert(rows);
        if (error) {
          console.error('[instagram] history insert failed:', error);
          continue;
        }
        result.messages += rows.length;
      }

      const last = messages.at(-1);
      if (last && (!conv.conversation.last_message_at ||
          Date.parse(conv.conversation.last_message_at) < Date.parse(last.created_time))) {
        await db.from('conversations').update({
          last_message_text: last.message || '[media]',
          last_message_at: new Date(last.created_time).toISOString(),
        }).eq('id', conv.conversation.id);
      }
    }
    next = page.paging?.next ?? null;
  }
}

async function importCommenters(
  db: SupabaseClient,
  { accountId, auditUserId, businessId, token }: Parameters<typeof importInstagramHistory>[1],
  result: ImportResult,
) {
  const media = await get<{ data?: Array<{ id: string }> }>(
    `${GRAPH}/me/media?fields=id&limit=${MAX_MEDIA}`, token,
  );
  const seen = new Set<string>();
  for (const post of media.data ?? []) {
    const comments = await get<{ data?: Array<{ from?: { id: string; username?: string } }> }>(
      `${GRAPH}/${post.id}/comments?fields=id,from&limit=50`, token,
    ).catch(() => ({ data: [] }));
    for (const comment of comments.data ?? []) {
      const author = comment.from;
      if (!author?.id || author.id === businessId || seen.has(author.id)) continue;
      seen.add(author.id);
      const sender = await resolveSenderContact(db, {
        accountId, auditUserId, channelType: 'instagram',
        sender: { externalId: author.id, username: author.username ?? null, displayName: author.username ?? null },
      });
      if (sender?.wasCreated) result.commenters += 1;
    }
  }
}
