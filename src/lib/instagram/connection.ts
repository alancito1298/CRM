import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { unsubscribeInstagramWebhooks } from './client';

/**
 * Disconnect one Instagram account. The channel row and its
 * conversations stay (history is kept); the token is deleted and the
 * webhook ignores the account from now on.
 */
export async function disconnectInstagramChannel(channelId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: connection } = await db.from('instagram_connections')
    .select('access_token').eq('channel_id', channelId).maybeSingle();
  if (connection?.access_token) {
    try { await unsubscribeInstagramWebhooks(decrypt(connection.access_token)); } catch { /* best effort */ }
  }
  await db.from('instagram_connections').delete().eq('channel_id', channelId);
  await db.from('channels').update({ status: 'disconnected' }).eq('id', channelId);
}
