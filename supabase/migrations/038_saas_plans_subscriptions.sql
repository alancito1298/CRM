-- ============================================================
-- 038_saas_plans_subscriptions.sql
-- Introduce planes y suscripciones para el modelo SaaS
-- ============================================================

-- ─── PLANS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
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

DROP TRIGGER IF EXISTS set_updated_at ON plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans_read_all" ON plans;
CREATE POLICY "plans_read_all" ON plans FOR SELECT USING (true);

INSERT INTO plans (slug, name, description, price_monthly_usd, price_yearly_usd,
  max_contacts, max_agents, max_messages_per_month, max_broadcasts_per_month, max_flows,
  feature_ai_reply, feature_broadcasts, feature_flows, feature_api_access, feature_white_label,
  is_public, sort_order)
VALUES
  ('free','Gratuito','Para empezar y explorar la plataforma',0,0,300,1,300,0,3,false,false,false,false,false,true,0),
  ('starter','Starter','Para pequenos negocios que quieren automatizar',29,290,2000,3,2000,5,10,true,true,true,false,false,true,1),
  ('pro','Pro','Para equipos en crecimiento con alto volumen',79,790,10000,10,10000,50,50,true,true,true,true,false,true,2),
  ('enterprise','Enterprise','Solucion personalizada sin limites',299,2990,999999,999999,999999,999999,999999,true,true,true,true,true,false,3)
ON CONFLICT (slug) DO NOTHING;

-- ─── SUBSCRIPTIONS ──────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status_enum') THEN
    CREATE TYPE subscription_status_enum AS ENUM ('trialing','active','past_due','canceled','paused','incomplete');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id                   uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                    subscription_status_enum NOT NULL DEFAULT 'trialing',
  stripe_customer_id        text,
  stripe_subscription_id    text UNIQUE,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  trial_ends_at             timestamptz,
  canceled_at               timestamptz,
  messages_used_this_month  integer NOT NULL DEFAULT 0,
  broadcasts_used_this_month integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_read_own" ON subscriptions;
CREATE POLICY "subscriptions_read_own" ON subscriptions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

-- ─── FUNCION: get_account_plan ───────────────────────────────
CREATE OR REPLACE FUNCTION get_account_plan(p_account_id uuid)
RETURNS TABLE (
  plan_slug text, plan_name text, sub_status text,
  max_contacts integer, max_agents integer,
  max_messages_per_month integer, max_broadcasts_per_month integer, max_flows integer,
  feature_ai_reply boolean, feature_broadcasts boolean,
  feature_flows boolean, feature_api_access boolean, feature_white_label boolean,
  messages_used_this_month integer, current_period_end timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT p.slug, p.name, COALESCE(s.status::text,'none'),
    p.max_contacts, p.max_agents, p.max_messages_per_month, p.max_broadcasts_per_month, p.max_flows,
    p.feature_ai_reply, p.feature_broadcasts, p.feature_flows, p.feature_api_access, p.feature_white_label,
    COALESCE(s.messages_used_this_month,0), s.current_period_end
  FROM plans p
  LEFT JOIN subscriptions s ON s.account_id = p_account_id AND s.status IN ('active','trialing')
  WHERE p.slug = COALESCE(
    (SELECT pl.slug FROM subscriptions sub JOIN plans pl ON sub.plan_id = pl.id
     WHERE sub.account_id = p_account_id AND sub.status IN ('active','trialing') LIMIT 1),
    'free'
  ) LIMIT 1;
$$;

-- ─── TRIGGER: auto-crear subscription free al crear account ──
CREATE OR REPLACE FUNCTION handle_new_account_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE free_plan_id uuid;
BEGIN
  SELECT id INTO free_plan_id FROM plans WHERE slug = 'free' LIMIT 1;
  IF free_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
    VALUES (NEW.id, free_plan_id, 'active', now(), now() + interval '100 years')
    ON CONFLICT (account_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_account_created_add_subscription ON accounts;
CREATE TRIGGER on_account_created_add_subscription
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION handle_new_account_subscription();
