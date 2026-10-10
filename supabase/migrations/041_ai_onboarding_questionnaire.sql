-- ============================================================
-- 041_ai_onboarding_questionnaire.sql
-- ============================================================
-- Tabla para almacenar las respuestas completas del Cuestionario de Onboarding
-- y permitir que el asistente de IA sea re-entrenado interactivamente.

-- Permitir que ai_configs guarde prompts antes de ingresar api_key si el usuario lo desea
ALTER TABLE ai_configs ALTER COLUMN api_key DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN model DROP NOT NULL;
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS onboarding_answers jsonb;

CREATE TABLE IF NOT EXISTS ai_onboarding_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id)
);

ALTER TABLE ai_onboarding_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_onboarding_responses_select ON ai_onboarding_responses;
CREATE POLICY ai_onboarding_responses_select ON ai_onboarding_responses FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_onboarding_responses_insert ON ai_onboarding_responses;
CREATE POLICY ai_onboarding_responses_insert ON ai_onboarding_responses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_onboarding_responses_update ON ai_onboarding_responses;
CREATE POLICY ai_onboarding_responses_update ON ai_onboarding_responses FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_onboarding_responses_delete ON ai_onboarding_responses;
CREATE POLICY ai_onboarding_responses_delete ON ai_onboarding_responses FOR DELETE
  USING (is_account_member(account_id, 'admin'));
