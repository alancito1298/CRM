import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { createClient } from '@/lib/supabase/server';
import { getAccountPlanDetails } from '@/lib/saas/plans';

const WA_SERVICE_URL = process.env.WA_SERVICE_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const supabase = await createClient();

    // 1. Consultar estado del plan
    const planDetails = await getAccountPlanDetails(supabase, ctx.accountId);

    // 2. Consultar estado de WhatsApp de esta cuenta
    let waStatus = 'disconnected';
    let waPhone = null;
    try {
      const waRes = await fetch(`${WA_SERVICE_URL}/sessions/${ctx.accountId}/status`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1500),
      });
      if (waRes.ok) {
        const waData = await waRes.json();
        waStatus = waData.status || 'disconnected';
        waPhone = waData.phone || null;
      }
    } catch {}

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
