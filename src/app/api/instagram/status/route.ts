import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getAccountPlanDetails, INSTAGRAM_ACCOUNTS_BY_PLAN } from '@/lib/saas/plans';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [{ data, error }, plan] = await Promise.all([
      ctx.supabase.from('channels')
        .select('id, name, status, external_id').eq('account_id', ctx.accountId)
        .eq('type', 'instagram').neq('status', 'disconnected').order('created_at'),
      getAccountPlanDetails(ctx.supabase, ctx.accountId),
    ]);
    if (error) throw error;
    return NextResponse.json({
      accounts: data ?? [],
      limit: INSTAGRAM_ACCOUNTS_BY_PLAN[plan.plan_slug],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
