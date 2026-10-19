-- ============================================================
-- 044_conversation_last_inbound.sql — Reply-window tracking
--
-- WhatsApp Cloud API and Instagram only accept free-form replies
-- within 24h of the customer's last message. `last_message_at` can't
-- answer that (it moves on OUR sends too), so conversations get a
-- dedicated `last_inbound_at`.
--
-- Maintained by a trigger on `messages` rather than in application
-- code so every ingest path — the webhooks AND the WA Web sidecar,
-- which writes to the DB directly — keeps it current.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION touch_conversation_last_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_conversation_last_inbound ON messages;
CREATE TRIGGER touch_conversation_last_inbound
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION touch_conversation_last_inbound();

-- Backfill (re-runnable).
UPDATE conversations cv
SET last_inbound_at = m.last_at
FROM (
  SELECT conversation_id, MAX(created_at) AS last_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = cv.id
  AND cv.last_inbound_at IS DISTINCT FROM m.last_at;
