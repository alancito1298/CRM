import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import {
  STATIC_PLANS,
  getAccountPlanDetails,
  getAccountLiveUsage,
} from '@/lib/saas/plans';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const supabase = await createClient();

    const [planDetails, liveUsage] = await Promise.all([
      getAccountPlanDetails(supabase, ctx.accountId),
      getAccountLiveUsage(supabase, ctx.accountId),
    ]);

    const enrichedDetails = {
      ...planDetails,
      contacts_count: liveUsage.contacts,
      agents_count: liveUsage.agents,
      flows_count: liveUsage.flows,
    };

    return NextResponse.json({
      subscription: enrichedDetails,
      plans: STATIC_PLANS,
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    // Only owner can change the billing plan
    const ctx = await requireRole('owner');
    const supabase = await createClient();

    const body = (await request.json().catch(() => ({}))) as {
      plan_slug?: string;
    };

    const targetSlug = body?.plan_slug;
    const selectedPlan = STATIC_PLANS.find((p) => p.slug === targetSlug);

    if (!selectedPlan) {
      return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
    }

    // Try updating database if table exists
    try {
      // Find the plan in DB
      const { data: dbPlan } = await supabase
        .from('plans')
        .select('id')
        .eq('slug', targetSlug)
        .maybeSingle();

      if (dbPlan) {
        await supabase
          .from('subscriptions')
          .upsert(
            {
              account_id: ctx.accountId,
              plan_id: dbPlan.id,
              status: 'active',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'account_id' }
          );
      }
    } catch (dbErr) {
      console.warn('[SaaS Plan Update] Could not update DB table directly:', dbErr);
    }

    return NextResponse.json({
      success: true,
      message: `Plan actualizado con éxito a ${selectedPlan.name}`,
      plan: selectedPlan,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
