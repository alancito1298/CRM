-- ============================================================
-- 039_saas_complete_system.sql
-- Sistema Integral de Multi-Tenant, Planes, Suscripciones y
-- Aprovisionamiento Automático de Cuentas SaaS.
-- ============================================================

-- ─── 1. TABLA DE PLANES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  description               text,
  price_monthly_usd         numeric(10,2) NOT NULL DEFAULT 0,
  price_yearly_usd          numeric(10,2) NOT NULL DEFAULT 0,
  max_contacts              integer NOT NULL DEFAULT 500,
  max_agents                integer NOT NULL DEFAULT 1,
  max_messages_per_month    integer NOT NULL DEFAULT 300,
  max_broadcasts_per_month  integer NOT NULL DEFAULT 0,
  max_flows                 integer NOT NULL DEFAULT 5,
  feature_ai_reply          boolean NOT NULL DEFAULT false,
  feature_broadcasts        boolean NOT NULL DEFAULT false,
  feature_flows             boolean NOT NULL DEFAULT false,
  feature_api_access        boolean NOT NULL DEFAULT false,
  feature_white_label       boolean NOT NULL DEFAULT false,
  is_public                 boolean NOT NULL DEFAULT true,
  sort_order                integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Trigger de updated_at para plans
DROP TRIGGER IF EXISTS set_plans_updated_at ON public.plans;
CREATE TRIGGER set_plans_updated_at BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: Todo usuario autenticado o anónimo puede leer los planes públicos
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_read_all" ON public.plans;
CREATE POLICY "plans_read_all" ON public.plans FOR SELECT USING (true);

-- Catálogo de Planes iniciales
INSERT INTO public.plans (slug, name, description, price_monthly_usd, price_yearly_usd,
  max_contacts, max_agents, max_messages_per_month, max_broadcasts_per_month, max_flows,
  feature_ai_reply, feature_broadcasts, feature_flows, feature_api_access, feature_white_label,
  is_public, sort_order)
VALUES
  ('free', 'Gratuito', 'Para explorar y dar los primeros pasos sin costo', 0, 0, 300, 1, 300, 0, 3, false, false, false, false, false, true, 0),
  ('starter', 'Starter', 'Para pequeños negocios que quieren automatizar su WhatsApp', 29, 290, 2000, 3, 2000, 5, 10, true, true, true, false, false, true, 1),
  ('pro', 'Pro', 'Para equipos comerciales en crecimiento con alto volumen', 79, 790, 10000, 10, 10000, 50, 50, true, true, true, true, false, true, 2),
  ('enterprise', 'Enterprise', 'Capacidad ilimitada, multi-agentes y soporte VIP a medida', 299, 2990, 999999, 999999, 999999, 999999, 999999, true, true, true, true, true, false, 3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly_usd = EXCLUDED.price_monthly_usd,
  price_yearly_usd = EXCLUDED.price_yearly_usd,
  max_contacts = EXCLUDED.max_contacts,
  max_agents = EXCLUDED.max_agents,
  max_messages_per_month = EXCLUDED.max_messages_per_month,
  max_broadcasts_per_month = EXCLUDED.max_broadcasts_per_month,
  max_flows = EXCLUDED.max_flows,
  feature_ai_reply = EXCLUDED.feature_ai_reply,
  feature_broadcasts = EXCLUDED.feature_broadcasts,
  feature_flows = EXCLUDED.feature_flows,
  feature_api_access = EXCLUDED.feature_api_access,
  feature_white_label = EXCLUDED.feature_white_label,
  sort_order = EXCLUDED.sort_order;

-- ─── 2. TABLA DE SUSCRIPCIONES ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
    CREATE TYPE subscription_status_enum AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused', 'incomplete');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id                   uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status                    subscription_status_enum NOT NULL DEFAULT 'active',
  stripe_customer_id        text,
  stripe_subscription_id    text UNIQUE,
  current_period_start      timestamptz DEFAULT now(),
  current_period_end        timestamptz DEFAULT (now() + interval '30 days'),
  trial_ends_at             timestamptz,
  canceled_at               timestamptz,
  messages_used_this_month  integer NOT NULL DEFAULT 0,
  broadcasts_used_this_month integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Trigger de updated_at para subscriptions
DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON public.subscriptions(account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON public.subscriptions(stripe_subscription_id);

-- RLS: Los miembros del workspace pueden leer su suscripción activa
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_read_own" ON public.subscriptions;
CREATE POLICY "subscriptions_read_own" ON public.subscriptions
  FOR SELECT USING (public.is_account_member(account_id, 'viewer'));

-- ─── 3. RPC: get_account_plan ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_account_plan(p_account_id uuid)
RETURNS TABLE (
  plan_slug text,
  plan_name text,
  sub_status text,
  max_contacts integer,
  max_agents integer,
  max_messages_per_month integer,
  max_broadcasts_per_month integer,
  max_flows integer,
  feature_ai_reply boolean,
  feature_broadcasts boolean,
  feature_flows boolean,
  feature_api_access boolean,
  feature_white_label boolean,
  messages_used_this_month integer,
  current_period_end timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.slug,
    p.name,
    COALESCE(s.status::text, 'active'),
    p.max_contacts,
    p.max_agents,
    p.max_messages_per_month,
    p.max_broadcasts_per_month,
    p.max_flows,
    p.feature_ai_reply,
    p.feature_broadcasts,
    p.feature_flows,
    p.feature_api_access,
    p.feature_white_label,
    COALESCE(s.messages_used_this_month, 0),
    s.current_period_end
  FROM public.plans p
  LEFT JOIN public.subscriptions s ON s.account_id = p_account_id
  WHERE p.slug = COALESCE(
    (SELECT pl.slug FROM public.subscriptions sub
     JOIN public.plans pl ON sub.plan_id = pl.id
     WHERE sub.account_id = p_account_id LIMIT 1),
    'free'
  )
  LIMIT 1;
$$;

ALTER FUNCTION public.get_account_plan(uuid) OWNER TO postgres;

-- ─── 4. TRIGGER MEJORADO: handle_new_user ───────────────────
-- Crea la cuenta con company_name, perfil con rol 'owner' y su suscripción al plan correspondiente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_company_name TEXT;
  v_plan_slug TEXT;
  v_plan_id UUID;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_company_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'company_name'), ''),
    NULLIF(TRIM(v_full_name), ''),
    SPLIT_PART(NEW.email, '@', 1),
    'Mi Empresa'
  );
  v_plan_slug := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'plan_slug'), ''), 'free');

  -- 1. Crear Organización / Workspace para la empresa
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (v_company_name, NEW.id)
  RETURNING id INTO v_account_id;

  -- 2. Crear Perfil con rol de Owner en esa cuenta
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner')
  ON CONFLICT (user_id) DO UPDATE SET
    account_id = EXCLUDED.account_id,
    account_role = 'owner',
    full_name = CASE WHEN profiles.full_name IS NULL OR profiles.full_name = '' THEN EXCLUDED.full_name ELSE profiles.full_name END;

  -- 3. Asignar Suscripción inicial al plan seleccionado
  SELECT id INTO v_plan_id FROM public.plans WHERE slug = v_plan_slug LIMIT 1;
  IF v_plan_id IS NULL THEN
    SELECT id INTO v_plan_id FROM public.plans WHERE slug = 'free' LIMIT 1;
  END IF;

  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      account_id,
      plan_id,
      status,
      current_period_start,
      current_period_end
    )
    VALUES (
      v_account_id,
      v_plan_id,
      'active',
      now(),
      now() + interval '30 days'
    )
    ON CONFLICT (account_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user error for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Re-asociar el trigger a auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill para cuentas existentes que no tengan suscripción asignada
INSERT INTO public.subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
SELECT
  a.id,
  p.id,
  'active',
  now(),
  now() + interval '100 years'
FROM public.accounts a
CROSS JOIN (SELECT id FROM public.plans WHERE slug = 'free' LIMIT 1) p
LEFT JOIN public.subscriptions s ON s.account_id = a.id
WHERE s.id IS NULL
ON CONFLICT (account_id) DO NOTHING;
