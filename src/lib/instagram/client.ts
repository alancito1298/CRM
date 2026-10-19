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
  meUrl.searchParams.set('fields', 'user_id');
  const meResponse = await fetch(meUrl, {
    headers: { Authorization: `Bearer ${longData.access_token}` }, cache: 'no-store',
  });
  const me = await meResponse.json() as { user_id?: string | number };
  if (!meResponse.ok || !me.user_id) throw new Error('Instagram account lookup failed');
  return { userId: String(me.user_id), token: longData.access_token, expiresIn: longData.expires_in };
}

export async function getInstagramToken(accountId: string, channelId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.from('instagram_connections')
    .select('id, access_token, token_issued_at, token_expires_at')
    .eq('account_id', accountId).eq('channel_id', channelId).single();
  if (error || !data) throw new Error('Instagram is not connected');

  const token = decrypt(data.access_token);
  const expiresAt = Date.parse(data.token_expires_at);
  if (expiresAt <= Date.now()) throw new Error('Instagram token expired; reconnect the account');
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
  if (!response.ok || !data.message_id) throw new Error('Instagram message send failed');
  return data.message_id as string;
}
