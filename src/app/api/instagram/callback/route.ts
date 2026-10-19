import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { exchangeInstagramCode } from '@/lib/instagram/client';

export async function GET(request: NextRequest) {
  const settingsUrl = new URL('/settings?tab=instagram', request.url);
  const response = (status: string) => {
    settingsUrl.searchParams.set('instagram', status);
    const result = NextResponse.redirect(settingsUrl);
    result.cookies.set('instagram_oauth_state', '', {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
      path: '/api/instagram/callback', maxAge: 0,
    });
    result.cookies.set('instagram_oauth_redirect', '', {
      httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax',
      path: '/api/instagram/callback', maxAge: 0,
    });
    return result;
  };

  try {
    const ctx = await requireRole('admin');
    const state = request.nextUrl.searchParams.get('state');
    const cookieState = request.cookies.get('instagram_oauth_state')?.value;
    if (!state || !cookieState || state !== cookieState) return response('invalid_state');
    if (request.nextUrl.searchParams.has('error')) return response('cancelled');
    const code = request.nextUrl.searchParams.get('code')?.replace(/#_$/, '');
    if (!code) return response('missing_code');

    const redirectUri = request.cookies.get('instagram_oauth_redirect')?.value;
    if (!redirectUri || new URL(redirectUri).pathname !== '/api/instagram/callback') {
      return response('invalid_state');
    }
    const token = await exchangeInstagramCode(code, redirectUri);
    const db = supabaseAdmin();
    const { data: existing } = await db.from('channels').select('id')
      .eq('account_id', ctx.accountId).eq('type', 'instagram').maybeSingle();
    const channelPayload = {
      account_id: ctx.accountId, type: 'instagram', name: 'Instagram',
      status: 'connected', external_id: token.userId,
    };
    const channelResult = existing
      ? await db.from('channels').update(channelPayload).eq('id', existing.id).select('id').single()
      : await db.from('channels').insert(channelPayload).select('id').single();
    if (channelResult.error || !channelResult.data) {
      console.error('[instagram] channel save failed:', channelResult.error);
      throw new Error('Could not save Instagram channel');
    }

    const now = new Date();
    const connectionResult = await db.from('instagram_connections').upsert({
      account_id: ctx.accountId,
      channel_id: channelResult.data.id,
      instagram_user_id: token.userId,
      access_token: encrypt(token.token),
      token_issued_at: now.toISOString(),
      token_expires_at: new Date(now.getTime() + token.expiresIn * 1000).toISOString(),
    }, { onConflict: 'account_id' });
    if (connectionResult.error) throw new Error('Could not save Instagram connection');
    return response('connected');
  } catch (error) {
    console.error('[instagram] OAuth callback failed:', error);
    return response('error');
  }
}
