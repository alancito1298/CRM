import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse, ForbiddenError } from '@/lib/auth/account';
import { createClient } from '@supabase/supabase-js';
import { STATIC_PLANS } from '@/lib/saas/plans';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Solo los owners pueden acceder a la vista de administración general
    if (ctx.role !== 'owner') {
      throw new ForbiddenError('Solo el propietario de la cuenta puede acceder al panel de administración');
    }

    const adminDb = getAdminClient();

    // Consultar todas las cuentas
    const { data: accounts, error: accError } = await adminDb
      .from('accounts')
      .select('id, name, owner_user_id, created_at')
      .order('created_at', { ascending: false });

    if (accError) {
      console.error('Error fetching accounts:', accError);
    }

    // Consultar todos los perfiles para asociar el email del owner
    const { data: profiles } = await adminDb
      .from('profiles')
      .select('user_id, email, full_name, account_id');

    // Consultar suscripciones existentes
    const { data: subscriptions } = await adminDb
      .from('subscriptions')
      .select('account_id, plan_id, status, messages_used_this_month, plans(slug, name)');

    // Métricas totales
    const [contactsCount, membersCount] = await Promise.all([
      adminDb.from('contacts').select('id', { count: 'exact', head: true }),
      adminDb.from('account_members').select('id', { count: 'exact', head: true }),
    ]);

    // Combinar información por tenant
    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
    const subMap = new Map((subscriptions || []).map((s) => [s.account_id, s]));

    const tenants = (accounts || []).map((acc) => {
      const ownerProfile = profileMap.get(acc.owner_user_id);
      const sub = subMap.get(acc.id);
      const planSlug = (sub?.plans as any)?.slug || 'free';
      const planName = (sub?.plans as any)?.name || 'Gratuito';

      return {
        id: acc.id,
        name: acc.name,
        owner_name: ownerProfile?.full_name || 'Sin nombre',
        owner_email: ownerProfile?.email || 'N/A',
        plan_slug: planSlug,
        plan_name: planName,
        status: sub?.status || 'active',
        messages_used: sub?.messages_used_this_month || 0,
        created_at: acc.created_at,
      };
    });

    const stats = {
      total_tenants: tenants.length,
      total_users: (profiles?.length || 0),
      total_contacts: contactsCount.count || 0,
      paid_subscriptions: tenants.filter((t) => t.plan_slug !== 'free').length,
    };

    return NextResponse.json({
      tenants,
      stats,
      plans: STATIC_PLANS,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (ctx.role !== 'owner') {
      throw new ForbiddenError('Acceso denegado');
    }

    const body = (await request.json().catch(() => ({}))) as {
      account_id?: string;
      plan_slug?: string;
    };

    const { account_id, plan_slug } = body;
    if (!account_id || !plan_slug) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 });
    }

    const adminDb = getAdminClient();

    // Buscar el id del plan
    const { data: dbPlan } = await adminDb
      .from('plans')
      .select('id, name')
      .eq('slug', plan_slug)
      .maybeSingle();

    if (dbPlan) {
      await adminDb
        .from('subscriptions')
        .upsert(
          {
            account_id,
            plan_id: dbPlan.id,
            status: 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'account_id' }
        );
    }

    return NextResponse.json({
      success: true,
      message: `Plan actualizado correctamente a ${dbPlan?.name || plan_slug}`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
