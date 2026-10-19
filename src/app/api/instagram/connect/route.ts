import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(request: NextRequest) {
  try {
    await requireRole('admin');
    const appId = process.env.INSTAGRAM_APP_ID;
    if (!appId) return NextResponse.json({ error: 'Instagram is not configured' }, { status: 503 });

    const redirectUri = new URL('/api/instagram/callback', request.url).toString();
    const state = randomBytes(32).toString('hex');
    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'instagram_business_manage_insights',
    ].join(','));
    url.searchParams.set('state', state);

    const response = NextResponse.redirect(url);
    response.cookies.set('instagram_oauth_state', state, {
      httpOnly: true, secure: redirectUri.startsWith('https://'), sameSite: 'lax',
      path: '/api/instagram/callback', maxAge: 600,
    });
    response.cookies.set('instagram_oauth_redirect', redirectUri, {
      httpOnly: true, secure: redirectUri.startsWith('https://'), sameSite: 'lax',
      path: '/api/instagram/callback', maxAge: 600,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
