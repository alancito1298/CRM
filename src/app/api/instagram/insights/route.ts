import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getInstagramToken } from '@/lib/instagram/client';
import { fetchInstagramInsights } from '@/lib/instagram/insights';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getCurrentAccount();
    const channelId = request.nextUrl.searchParams.get('channelId');
    if (!channelId) return NextResponse.json({ error: 'channelId is required' }, { status: 400 });

    const { data: channel } = await ctx.supabase.from('channels').select('id, external_id, status')
      .eq('id', channelId).eq('account_id', ctx.accountId).eq('type', 'instagram').maybeSingle();
    if (!channel?.external_id || channel.status !== 'connected') {
      return NextResponse.json({ error: 'Instagram account is not connected' }, { status: 409 });
    }
    const token = await getInstagramToken(ctx.accountId, channel.id);
    return NextResponse.json(await fetchInstagramInsights(channel.external_id, token));
  } catch (error) {
    return toErrorResponse(error);
  }
}
