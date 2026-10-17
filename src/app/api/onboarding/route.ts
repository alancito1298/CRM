import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import { getAccountPlanDetails } from '@/lib/saas/plans';
import { getWaWebSessionStatus } from '@/lib/whatsapp/providers';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const supabase = await createClient();

    // 1. Consultar estado del plan
    const planDetails = await getAccountPlanDetails(supabase, ctx.accountId);

    // 2. Consultar estado de WhatsApp de esta cuenta
    const waData = await getWaWebSessionStatus(ctx.accountId, 1500);
    const waStatus = waData.status || 'disconnected';
    const waPhone = waData.phone || null;

    // 3. Consultar estado de la IA
    const { data: aiConfig } = await supabase
      .from('ai_configs')
      .select('is_active, auto_reply_enabled, provider, model')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    return NextResponse.json({
      account: {
        id: ctx.accountId,
        name: ctx.account.name,
        role: ctx.role,
      },
      plan: planDetails,
      whatsapp: {
        status: waStatus,
        phone: waPhone,
      },
      ai: {
        configured: Boolean(aiConfig),
        active: Boolean(aiConfig?.is_active),
        auto_reply: Boolean(aiConfig?.auto_reply_enabled),
        provider: aiConfig?.provider || 'groq',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const supabase = await createClient();

    const body = (await request.json().catch(() => ({}))) as {
      companyName?: string;
      completed?: boolean;
    };

    if (body.companyName && body.companyName.trim()) {
      await supabase
        .from('accounts')
        .update({ name: body.companyName.trim() })
        .eq('id', ctx.accountId);
    }

    return NextResponse.json({
      success: true,
      message: 'Onboarding actualizado exitosamente',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
