import type { SupabaseClient } from '@supabase/supabase-js';
import type { Plan, PlanSlug, AccountPlanDetails, SubscriptionStatus } from '@/types/saas';

export const STATIC_PLANS: Plan[] = [
  {
    id: 'plan_free',
    slug: 'free',
    name: 'Gratuito',
    description: 'Para empezar y explorar la plataforma sin costo',
    price_monthly_usd: 0,
    price_yearly_usd: 0,
    max_contacts: 300,
    max_agents: 1,
    max_messages_per_month: 300,
    max_broadcasts_per_month: 0,
    max_flows: 3,
    feature_ai_reply: false,
    feature_broadcasts: false,
    feature_flows: false,
    feature_api_access: false,
    feature_white_label: false,
    is_public: true,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan_starter',
    slug: 'starter',
    name: 'Starter',
    description: 'Para pequeños negocios y emprendedores que quieren automatizar su atención',
    price_monthly_usd: 29,
    price_yearly_usd: 290,
    max_contacts: 2000,
    max_agents: 3,
    max_messages_per_month: 2000,
    max_broadcasts_per_month: 5,
    max_flows: 10,
    feature_ai_reply: true,
    feature_broadcasts: true,
    feature_flows: true,
    feature_api_access: false,
    feature_white_label: false,
    is_public: true,
    sort_order: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan_pro',
    slug: 'pro',
    name: 'Pro',
    description: 'Para equipos en crecimiento con alto volumen de conversaciones e IA avanzada',
    price_monthly_usd: 79,
    price_yearly_usd: 790,
    max_contacts: 10000,
    max_agents: 10,
    max_messages_per_month: 10000,
    max_broadcasts_per_month: 50,
    max_flows: 50,
    feature_ai_reply: true,
    feature_broadcasts: true,
    feature_flows: true,
    feature_api_access: true,
    feature_white_label: false,
    is_public: true,
    sort_order: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan_enterprise',
    slug: 'enterprise',
    name: 'Enterprise',
    description: 'Solución a medida para grandes empresas: multi-agentes y capacidad ilimitada',
    price_monthly_usd: 299,
    price_yearly_usd: 2990,
    max_contacts: 999999,
    max_agents: 999999,
    max_messages_per_month: 999999,
    max_broadcasts_per_month: 999999,
    max_flows: 999999,
    feature_ai_reply: true,
    feature_broadcasts: true,
    feature_flows: true,
    feature_api_access: true,
    feature_white_label: true,
    is_public: true,
    sort_order: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export async function getAccountPlanDetails(
  supabase: SupabaseClient,
  accountId: string
): Promise<AccountPlanDetails> {
  const defaultFreePlan = STATIC_PLANS.find((p) => p.slug === 'free')!;

  try {
    // 1. Try using the database RPC if available
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_account_plan', {
      p_account_id: accountId,
    });

    if (!rpcError && rpcData && rpcData.length > 0) {
      const row = rpcData[0];
      return {
        plan_slug: (row.plan_slug as PlanSlug) || 'free',
        plan_name: row.plan_name || 'Gratuito',
        sub_status: (row.sub_status as SubscriptionStatus) || 'active',
        max_contacts: Number(row.max_contacts ?? defaultFreePlan.max_contacts),
        max_agents: Number(row.max_agents ?? defaultFreePlan.max_agents),
        max_messages_per_month: Number(row.max_messages_per_month ?? defaultFreePlan.max_messages_per_month),
        max_broadcasts_per_month: Number(row.max_broadcasts_per_month ?? defaultFreePlan.max_broadcasts_per_month),
        max_flows: Number(row.max_flows ?? defaultFreePlan.max_flows),
        feature_ai_reply: Boolean(row.feature_ai_reply ?? defaultFreePlan.feature_ai_reply),
        feature_broadcasts: Boolean(row.feature_broadcasts ?? defaultFreePlan.feature_broadcasts),
        feature_flows: Boolean(row.feature_flows ?? defaultFreePlan.feature_flows),
        feature_api_access: Boolean(row.feature_api_access ?? defaultFreePlan.feature_api_access),
        feature_white_label: Boolean(row.feature_white_label ?? defaultFreePlan.feature_white_label),
        messages_used_this_month: Number(row.messages_used_this_month ?? 0),
        current_period_end: row.current_period_end ?? null,
      };
    }

    // 2. Fallback: Query subscriptions table directly
    const { data: subData, error: subError } = await supabase
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!subError && subData && subData.plans) {
      const p = subData.plans;
      return {
        plan_slug: (p.slug as PlanSlug) || 'free',
        plan_name: p.name || 'Gratuito',
        sub_status: (subData.status as SubscriptionStatus) || 'active',
        max_contacts: p.max_contacts,
        max_agents: p.max_agents,
        max_messages_per_month: p.max_messages_per_month,
        max_broadcasts_per_month: p.max_broadcasts_per_month,
        max_flows: p.max_flows,
        feature_ai_reply: p.feature_ai_reply,
        feature_broadcasts: p.feature_broadcasts,
        feature_flows: p.feature_flows,
        feature_api_access: p.feature_api_access,
        feature_white_label: p.feature_white_label,
        messages_used_this_month: subData.messages_used_this_month || 0,
        current_period_end: subData.current_period_end || null,
      };
    }
  } catch (err) {
    console.warn('[SaaS Plan] Falling back to default free plan:', err);
  }

  // Safe fallback to Free plan
  return {
    plan_slug: 'free',
    plan_name: defaultFreePlan.name,
    sub_status: 'active',
    max_contacts: defaultFreePlan.max_contacts,
    max_agents: defaultFreePlan.max_agents,
    max_messages_per_month: defaultFreePlan.max_messages_per_month,
    max_broadcasts_per_month: defaultFreePlan.max_broadcasts_per_month,
    max_flows: defaultFreePlan.max_flows,
    feature_ai_reply: defaultFreePlan.feature_ai_reply,
    feature_broadcasts: defaultFreePlan.feature_broadcasts,
    feature_flows: defaultFreePlan.feature_flows,
    feature_api_access: defaultFreePlan.feature_api_access,
    feature_white_label: defaultFreePlan.feature_white_label,
    messages_used_this_month: 0,
    current_period_end: null,
  };
}

export async function getAccountLiveUsage(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ contacts: number; agents: number; flows: number }> {
  try {
    const [contactsRes, membersRes, flowsRes] = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('account_members').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('flows').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    ]);

    return {
      contacts: contactsRes.count ?? 0,
      agents: (membersRes.count ?? 0) + 1, // +1 for owner
      flows: flowsRes.count ?? 0,
    };
  } catch (err) {
    console.error('[SaaS Plan] Error getting live usage:', err);
    return { contacts: 0, agents: 1, flows: 0 };
  }
}

export async function checkActionAllowed(
  supabase: SupabaseClient,
  accountId: string,
  action: 'send_message' | 'create_contact' | 'invite_agent' | 'use_ai'
): Promise<{ allowed: boolean; reason?: string; current?: number; limit?: number }> {
  try {
    const [details, usage] = await Promise.all([
      getAccountPlanDetails(supabase, accountId),
      getAccountLiveUsage(supabase, accountId),
    ]);

    switch (action) {
      case 'send_message': {
        const current = details.messages_used_this_month;
        const limit = details.max_messages_per_month;
        if (limit < 900000 && current >= limit) {
          return {
            allowed: false,
            reason: `Has alcanzado el límite mensual de ${limit.toLocaleString()} mensajes de tu plan ${details.plan_name}. Actualiza tu suscripción en Planes y Facturación para continuar enviando.`,
            current,
            limit,
          };
        }
        return { allowed: true, current, limit };
      }

      case 'create_contact': {
        const current = usage.contacts;
        const limit = details.max_contacts;
        if (limit < 900000 && current >= limit) {
          return {
            allowed: false,
            reason: `Has alcanzado la capacidad máxima de ${limit.toLocaleString()} contactos de tu plan ${details.plan_name}. Actualiza a un plan superior para guardar más prospectos.`,
            current,
            limit,
          };
        }
        return { allowed: true, current, limit };
      }

      case 'invite_agent': {
        const current = usage.agents;
        const limit = details.max_agents;
        if (limit < 900000 && current >= limit) {
          return {
            allowed: false,
            reason: `Tu plan ${details.plan_name} permite un máximo de ${limit} agente(s). Actualiza tu plan para sumar más miembros al equipo.`,
            current,
            limit,
          };
        }
        return { allowed: true, current, limit };
      }

      case 'use_ai': {
        if (!details.feature_ai_reply) {
          return {
            allowed: false,
            reason: `El auto-reply de Inteligencia Artificial está disponible a partir del plan Starter. Actualiza tu suscripción para habilitarlo.`,
          };
        }
        return { allowed: true };
      }
    }
  } catch (err) {
    console.warn('[SaaS Plan] Error checking action allowed:', err);
    return { allowed: true };
  }
}

export async function recordMessageSent(
  supabase: SupabaseClient,
  accountId: string
): Promise<void> {
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, messages_used_this_month')
      .eq('account_id', accountId)
      .maybeSingle();

    if (sub) {
      await supabase
        .from('subscriptions')
        .update({
          messages_used_this_month: (sub.messages_used_this_month || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id);
    }
  } catch (err) {
    console.warn('[SaaS Plan] Could not update messages count:', err);
  }
}

