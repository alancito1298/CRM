import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getInstagramToken } from '@/lib/instagram/client';
import { importInstagramHistory } from '@/lib/instagram/import';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { channelId } = await request.json().catch(() => ({})) as { channelId?: string };
    if (!channelId) return NextResponse.json({ error: 'channelId is required' }, { status: 400 });

    const db = supabaseAdmin();
    const [{ data: channel }, { data: account }] = await Promise.all([
      db.from('channels').select('id, external_id, status')
        .eq('id', channelId).eq('account_id', ctx.accountId).eq('type', 'instagram').maybeSingle(),
      db.from('accounts').select('owner_user_id').eq('id', ctx.accountId).single(),
    ]);
    if (!channel?.external_id || channel.status !== 'connected' || !account) {
      return NextResponse.json({ error: 'Instagram account is not connected' }, { status: 409 });
    }

    const result = await importInstagramHistory(db, {
      accountId: ctx.accountId,
      auditUserId: account.owner_user_id,
      channelId: channel.id,
      businessId: channel.external_id,
      token: await getInstagramToken(ctx.accountId, channel.id),
    });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
