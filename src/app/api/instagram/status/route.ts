import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase.from('channels')
      .select('id, status, external_id').eq('account_id', ctx.accountId)
      .eq('type', 'instagram').maybeSingle();
    if (error) throw error;
    return NextResponse.json({ connected: data?.status === 'connected', channel: data ?? null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
