-- ============================================================
-- 042_realtime_handoff_notifications.sql
--
-- 1. Expands allowed notification types to support AI handoffs,
--    new leads, and payments.
-- 2. Adds an automatic trigger on conversation updates: when
--    ai_handoff_summary is set, notifies assigned agent or all
--    account team members in real-time.
-- ============================================================

-- 1. Expand notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_handoff', 'new_lead', 'payment_received'));

-- 2. Trigger function to notify on AI handoff
CREATE OR REPLACE FUNCTION notify_conversation_ai_handoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_member RECORD;
BEGIN
  -- Only trigger when ai_handoff_summary is newly set or changed
  IF NEW.ai_handoff_summary IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.ai_handoff_summary IS NOT NULL AND OLD.ai_handoff_summary = NEW.ai_handoff_summary THEN
    RETURN NEW;
  END IF;

  -- Get contact name or phone
  SELECT COALESCE(NULLIF(name, ''), phone, 'un cliente') INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  -- Case A: Conversation is assigned to a specific agent
  IF NEW.assigned_agent_id IS NOT NULL THEN
    INSERT INTO notifications (
      account_id,
      user_id,
      type,
      conversation_id,
      contact_id,
      actor_user_id,
      title,
      body
    ) VALUES (
      NEW.account_id,
      NEW.assigned_agent_id,
      'ai_handoff',
      NEW.id,
      NEW.contact_id,
      NULL,
      '🚨 Derivación de IA: ' || COALESCE(v_contact_name, 'Contacto'),
      COALESCE(NEW.ai_handoff_summary, 'El cliente requiere atención de un asesor humano.')
    );
  ELSE
    -- Case B: Conversation is unassigned — notify all active agents/admins in the account
    FOR v_member IN
      SELECT user_id FROM profiles
      WHERE account_id = NEW.account_id
    LOOP
      INSERT INTO notifications (
        account_id,
        user_id,
        type,
        conversation_id,
        contact_id,
        actor_user_id,
        title,
        body
      ) VALUES (
        NEW.account_id,
        v_member.user_id,
        'ai_handoff',
        NEW.id,
        NEW.contact_id,
        NULL,
        '🚨 Derivación de IA: ' || COALESCE(v_contact_name, 'Contacto'),
        COALESCE(NEW.ai_handoff_summary, 'El cliente requiere atención de un asesor humano.')
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create AI handoff notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_ai_handoff() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_ai_handoff ON conversations;
CREATE TRIGGER on_conversation_ai_handoff
  AFTER INSERT OR UPDATE OF ai_handoff_summary ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_ai_handoff();
