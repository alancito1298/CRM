import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { exchangeInstagramCode, subscribeInstagramWebhooks } from '@/lib/instagram/client';
import { getAccountPlanDetails, INSTAGRAM_ACCOUNTS_BY_PLAN } from '@/lib/saas/plans';

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

    // A professional account belongs to one CRM account at a time.
    const { data: owner } = await db.from('instagram_connections').select('account_id')
      .eq('instagram_user_id', token.userId).maybeSingle();
    if (owner && owner.account_id !== ctx.accountId) return response('in_use');

    // Reconnecting reuses the account's channel row (keeps its history);
    // a new account counts against the plan limit.
    const { data: existing } = await db.from('channels').select('id, status')
      .eq('account_id', ctx.accountId).eq('type', 'instagram')
      .eq('external_id', token.userId).order('created_at').limit(1).maybeSingle();
    if (!existing || existing.status === 'disconnected') {
      const [{ count }, plan] = await Promise.all([
        db.from('channels').select('id', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId).eq('type', 'instagram').neq('status', 'disconnected'),
        getAccountPlanDetails(ctx.supabase, ctx.accountId),
      ]);
      if ((count ?? 0) >= INSTAGRAM_ACCOUNTS_BY_PLAN[plan.plan_slug]) return response('limit_reached');
    }

    const channelPayload = {
      account_id: ctx.accountId, type: 'instagram',
      name: token.username ? `@${token.username}` : 'Instagram',
      status: 'connected', external_id: token.userId,
      // Deauthorize callbacks identify the user by the OAuth-scoped id.
      metadata: { oauth_user_id: token.oauthUserId },
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
    }, { onConflict: 'channel_id' });
    if (connectionResult.error) throw new Error('Could not save Instagram connection');

    try {
      await subscribeInstagramWebhooks(token.token);
    } catch (error) {
      console.error('[instagram] webhook subscription failed:', error);
      return response('subscribe_failed');
    }
    return response('connected');
  } catch (error) {
    console.error('[instagram] OAuth callback failed:', error);
    return response('error');
  }
}
