import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';

const GRAPH = 'https://graph.instagram.com/v26.0';

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export async function exchangeInstagramCode(code: string, redirectUri: string) {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Instagram app credentials are missing');

  const body = new FormData();
  body.set('client_id', appId);
  body.set('client_secret', appSecret);
  body.set('grant_type', 'authorization_code');
  body.set('redirect_uri', redirectUri);
  body.set('code', code);
  const shortResponse = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST', body, cache: 'no-store',
  });
  const shortData = await shortResponse.json();
  if (!shortResponse.ok) {
    const error = shortData && typeof shortData === 'object' ? shortData : {};
    const details = {
      status: shortResponse.status,
      redirectUri,
      type: typeof error.error_type === 'string' ? error.error_type : undefined,
      code: typeof error.code === 'number' ? error.code : undefined,
      message: typeof error.error_message === 'string'
        ? error.error_message.replaceAll(appSecret, '[redacted]').replaceAll(code, '[redacted]')
        : undefined,
    };
    console.error('[instagram] short token exchange failed:', details);
    throw new Error('Instagram authorization failed');
  }
  const payload = Array.isArray(shortData.data) ? shortData.data[0] : shortData;
  const userId = String(payload?.user_id ?? '');
  const shortToken = payload?.access_token as string | undefined;
  if (!userId || !shortToken) throw new Error('Instagram returned no user or token');

  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('access_token', shortToken);
  const longResponse = await fetch(url, { cache: 'no-store' });
  const longData = await longResponse.json() as Partial<TokenResponse>;
  if (!longResponse.ok || !longData.access_token || !longData.expires_in) {
    throw new Error('Instagram long-lived token exchange failed');
  }

  // The OAuth user_id is app-scoped; webhooks and /messages use the
  // professional account ID, which only /me?fields=user_id returns.
  const meUrl = new URL(`${GRAPH}/me`);
  meUrl.searchParams.set('fields', 'user_id,username');
  const meResponse = await fetch(meUrl, {
    headers: { Authorization: `Bearer ${longData.access_token}` }, cache: 'no-store',
  });
  const me = await meResponse.json() as { user_id?: string | number; username?: string };
  if (!meResponse.ok || !me.user_id) throw new Error('Instagram account lookup failed');
  return {
    userId: String(me.user_id),
    oauthUserId: userId,
    username: me.username ?? null,
    token: longData.access_token,
    expiresIn: longData.expires_in,
  };
}

/** The token was revoked or expired: the account must be reconnected. */
export class InstagramAuthError extends Error {}

const WEBHOOK_FIELDS = 'messages,messaging_postbacks,message_reactions';

/** Subscribe the connected account to this app's webhooks (no Meta dashboard step). */
export async function subscribeInstagramWebhooks(token: string): Promise<void> {
  const url = new URL(`${GRAPH}/me/subscribed_apps`);
  url.searchParams.set('subscribed_fields', WEBHOOK_FIELDS);
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  const data = await response.json().catch(() => ({})) as { success?: boolean };
  if (!response.ok || !data.success) throw new Error('Instagram webhook subscription failed');
}

/** Best effort: stop deliveries for an account being disconnected. */
export async function unsubscribeInstagramWebhooks(token: string): Promise<void> {
  await fetch(`${GRAPH}/me/subscribed_apps`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  }).catch(() => undefined);
}

export interface InstagramProfile {
  name: string | null;
  username: string | null;
  profilePic: string | null;
}

/** Public profile of someone who messaged the account; null when Meta withholds it. */
export async function fetchInstagramProfile(igsid: string, token: string): Promise<InstagramProfile | null> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(igsid)}`);
  url.searchParams.set('fields', 'name,username,profile_pic');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json() as { name?: string; username?: string; profile_pic?: string };
  return { name: data.name ?? null, username: data.username ?? null, profilePic: data.profile_pic ?? null };
}

/** Flag a channel whose token stopped working so the UI asks to reconnect. */
export async function markInstagramExpired(channelId: string): Promise<void> {
  await supabaseAdmin().from('channels').update({ status: 'error' })
    .eq('id', channelId).eq('type', 'instagram');
}

export async function getInstagramToken(accountId: string, channelId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.from('instagram_connections')
    .select('id, access_token, token_issued_at, token_expires_at')
    .eq('account_id', accountId).eq('channel_id', channelId).single();
  if (error || !data) throw new Error('Instagram is not connected');

  const token = decrypt(data.access_token);
  const expiresAt = Date.parse(data.token_expires_at);
  if (expiresAt <= Date.now()) {
    await markInstagramExpired(channelId);
    throw new InstagramAuthError('Instagram token expired; reconnect the account');
  }
  // Meta only accepts refresh after the long-lived token is at least 24h old.
  if (expiresAt - Date.now() > 7 * 24 * 60 * 60 * 1000 ||
      Date.now() - Date.parse(data.token_issued_at) < 24 * 60 * 60 * 1000) return token;

  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return token;
  const refreshed = await response.json() as Partial<TokenResponse>;
  if (!refreshed.access_token || !refreshed.expires_in) return token;
  const now = new Date();
  const { error: updateError } = await db.from('instagram_connections').update({
    access_token: encrypt(refreshed.access_token),
    token_issued_at: now.toISOString(),
    token_expires_at: new Date(now.getTime() + refreshed.expires_in * 1000).toISOString(),
  }).eq('id', data.id).eq('account_id', accountId).eq('channel_id', channelId);
  if (updateError) throw new Error('Instagram token refresh could not be saved');
  return refreshed.access_token;
}

export async function sendInstagramMessage(args: {
  userId: string;
  recipientId: string;
  token: string;
  text?: string;
  media?: { type: 'image' | 'video' | 'audio' | 'file'; url: string };
  replyTo?: string;
}): Promise<string> {
  const message = args.text
    ? { text: args.text }
    : { attachment: { type: args.media!.type, payload: { url: args.media!.url } } };
  const response = await fetch(`${GRAPH}/${encodeURIComponent(args.userId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: args.recipientId }, message,
      ...(args.replyTo ? { reply_to: { mid: args.replyTo } } : {}),
    }),
    cache: 'no-store',
  });
  const data = await response.json();
  // 190 = invalid/expired/revoked access token.
  if (data?.error?.code === 190) throw new InstagramAuthError('Instagram access was revoked');
  if (!response.ok || !data.message_id) throw new Error('Instagram message send failed');
  return data.message_id as string;
}
