import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { disconnectInstagramChannel } from '@/lib/instagram/connection';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { channelId } = await request.json().catch(() => ({})) as { channelId?: string };
    if (!channelId) return NextResponse.json({ error: 'channelId is required' }, { status: 400 });

    const { data: channel } = await supabaseAdmin().from('channels').select('id')
      .eq('id', channelId).eq('account_id', ctx.accountId).eq('type', 'instagram').maybeSingle();
    if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await disconnectInstagramChannel(channel.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
