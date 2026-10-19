-- ============================================================
-- 043_multichannel_foundation.sql — Channels + contact identities
--
-- Groundwork for serving more than one messaging channel
-- (WhatsApp today, Instagram DMs next) from the same inbox.
--
-- Model
--   contacts            the PERSON (name, email, tags, notes). No
--                       longer tied to a phone number.
--   contact_identities  how that person is reachable on a channel:
--                       (channel_type, external_id) — the phone for
--                       WhatsApp, the IGSID for Instagram. One
--                       contact may own several identities.
--   channels            each connected business account (a WhatsApp
--                       number, an Instagram account). Provider
--                       secrets stay in per-provider tables
--                       (whatsapp_config today); `channels` is the
--                       registry the inbox and webhooks route by.
--   conversations       gain `channel_id` + `contact_identity_id`, so
--                       a reply always leaves through the channel the
--                       conversation came in on.
--
-- Compatibility (this migration changes NO application behaviour)
--   - `contacts.phone` stays, but becomes nullable (Instagram
--     contacts have no phone). Existing code keeps reading it.
--   - Triggers keep the new tables in sync with the code paths that
--     still only know about WhatsApp:
--       * whatsapp_config insert/update/delete → its channel row;
--       * contacts insert / phone change       → whatsapp identity;
--       * conversations insert without channel → account's WhatsApp
--                                                channel + identity.
--     They are transitional: once every write path sets these
--     columns explicitly, a later migration drops them.
--   - The (account_id, contact_id) unique index on conversations
--     (migration 036) stays for now; it moves to per-identity when
--     the inbound pipeline is rewritten.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- CHANNELS
-- ============================================================
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('whatsapp', 'instagram')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'pending', 'disconnected', 'error')),
  -- Provider-side id the webhooks route by: Meta phone_number_id for
  -- WhatsApp Cloud API, the Instagram professional account id for
  -- Instagram. NULL when the provider has none (WA Web, Twilio).
  external_id TEXT,
  -- Link to the provider-specific settings row. NULL for accounts that
  -- send through the deployment-wide Twilio fallback.
  whatsapp_config_id UUID UNIQUE REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_account ON channels(account_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_type_external
  ON channels(type, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON channels;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Settings-class, mirroring whatsapp_config: members read, admins write.
DROP POLICY IF EXISTS channels_select ON channels;
DROP POLICY IF EXISTS channels_insert ON channels;
DROP POLICY IF EXISTS channels_update ON channels;
DROP POLICY IF EXISTS channels_delete ON channels;
CREATE POLICY channels_select ON channels FOR SELECT USING (is_account_member(account_id));
CREATE POLICY channels_insert ON channels FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY channels_update ON channels FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY channels_delete ON channels FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- CONTACT_IDENTITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('whatsapp', 'instagram')),
  -- WhatsApp: phone, digits only (same as contacts.phone_normalized).
  -- Instagram: the IGSID Meta assigns to the user.
  external_id TEXT NOT NULL CHECK (external_id <> ''),
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The authoritative "who is this sender" lookup for inbound messages.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_identities_lookup
  ON contact_identities(account_id, channel_type, external_id);
CREATE INDEX IF NOT EXISTS idx_contact_identities_contact
  ON contact_identities(contact_id);

ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON contact_identities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_identities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Operational, mirroring contacts: members read, agents write.
DROP POLICY IF EXISTS contact_identities_select ON contact_identities;
DROP POLICY IF EXISTS contact_identities_insert ON contact_identities;
DROP POLICY IF EXISTS contact_identities_update ON contact_identities;
DROP POLICY IF EXISTS contact_identities_delete ON contact_identities;
CREATE POLICY contact_identities_select ON contact_identities FOR SELECT USING (is_account_member(account_id));
CREATE POLICY contact_identities_insert ON contact_identities FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_identities_update ON contact_identities FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY contact_identities_delete ON contact_identities FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- CONTACTS / CONVERSATIONS
-- ============================================================
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_identity_id UUID REFERENCES contact_identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id);
CREATE INDEX IF NOT EXISTS idx_conversations_identity ON conversations(contact_identity_id);

-- ============================================================
-- HELPERS
-- ============================================================

-- whatsapp_config.status has provider-specific values (WA Web adds
-- qr / ready / authenticated / …); channels expose a small common set.
CREATE OR REPLACE FUNCTION channel_status_from_whatsapp(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status IN ('connected', 'ready', 'authenticated') THEN 'connected'
    WHEN p_status = 'qr'    THEN 'pending'
    WHEN p_status = 'error' THEN 'error'
    ELSE 'disconnected'
  END;
$$;

-- The account's WhatsApp channel, created on demand. Accounts on the
-- Twilio fallback (or WA Web before its config row exists) have no
-- whatsapp_config, yet their conversations still need a channel.
CREATE OR REPLACE FUNCTION ensure_whatsapp_channel(p_account_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Serialise per account so two concurrent first conversations
  -- don't each create a channel.
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp_channel:' || p_account_id::text));

  SELECT id INTO v_id
  FROM channels
  WHERE account_id = p_account_id AND type = 'whatsapp'
  ORDER BY (whatsapp_config_id IS NULL), created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO channels (account_id, type, name, status)
    VALUES (p_account_id, 'whatsapp', 'WhatsApp', 'connected')
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================
-- TRANSITIONAL SYNC TRIGGERS
-- ============================================================

-- whatsapp_config → channels
CREATE OR REPLACE FUNCTION sync_whatsapp_config_channel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Keep the channel (conversations point at it), just mark it.
    UPDATE channels SET status = 'disconnected', external_id = NULL
    WHERE whatsapp_config_id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT id INTO v_id FROM channels WHERE whatsapp_config_id = NEW.id;

  -- Adopt a channel created on demand before the config existed.
  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM channels
    WHERE account_id = NEW.account_id AND type = 'whatsapp' AND whatsapp_config_id IS NULL
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO channels (account_id, type, name, status, external_id, whatsapp_config_id)
    VALUES (NEW.account_id, 'whatsapp', 'WhatsApp',
            channel_status_from_whatsapp(NEW.status),
            NULLIF(NEW.phone_number_id, ''), NEW.id);
  ELSE
    UPDATE channels
    SET account_id         = NEW.account_id,
        status             = channel_status_from_whatsapp(NEW.status),
        external_id        = NULLIF(NEW.phone_number_id, ''),
        whatsapp_config_id = NEW.id
    WHERE id = v_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_whatsapp_config_channel_upsert ON whatsapp_config;
CREATE TRIGGER sync_whatsapp_config_channel_upsert
  AFTER INSERT OR UPDATE OF account_id, status, phone_number_id ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION sync_whatsapp_config_channel();

DROP TRIGGER IF EXISTS sync_whatsapp_config_channel_delete ON whatsapp_config;
CREATE TRIGGER sync_whatsapp_config_channel_delete
  BEFORE DELETE ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION sync_whatsapp_config_channel();

-- contacts.phone → whatsapp identity
CREATE OR REPLACE FUNCTION sync_contact_whatsapp_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.phone_normalized, '') = '' THEN
    RETURN NEW;
  END IF;

  -- Phone edited (or corrected by sendWithPhoneVariants): move the
  -- existing identity so conversations keep pointing at it.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.phone_normalized, '') <> ''
     AND OLD.phone_normalized IS DISTINCT FROM NEW.phone_normalized THEN
    BEGIN
      UPDATE contact_identities
      SET external_id = NEW.phone_normalized
      WHERE contact_id = NEW.id
        AND channel_type = 'whatsapp'
        AND external_id = OLD.phone_normalized;
    EXCEPTION WHEN unique_violation THEN
      NULL; -- an identity for the new phone already exists; keep both
    END;
  END IF;

  INSERT INTO contact_identities (account_id, contact_id, channel_type, external_id, display_name)
  VALUES (NEW.account_id, NEW.id, 'whatsapp', NEW.phone_normalized, NEW.name)
  ON CONFLICT (account_id, channel_type, external_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_whatsapp_identity ON contacts;
CREATE TRIGGER sync_contact_whatsapp_identity
  AFTER INSERT OR UPDATE OF phone ON contacts
  FOR EACH ROW EXECUTE FUNCTION sync_contact_whatsapp_identity();

-- conversations without channel → account's WhatsApp channel
CREATE OR REPLACE FUNCTION fill_conversation_channel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF NEW.channel_id IS NULL THEN
    NEW.channel_id := ensure_whatsapp_channel(NEW.account_id);
  END IF;

  IF NEW.contact_identity_id IS NULL THEN
    SELECT type INTO v_type FROM channels WHERE id = NEW.channel_id;
    SELECT id INTO NEW.contact_identity_id
    FROM contact_identities
    WHERE contact_id = NEW.contact_id AND channel_type = v_type
    ORDER BY created_at
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fill_conversation_channel ON conversations;
CREATE TRIGGER fill_conversation_channel
  BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION fill_conversation_channel();

-- ============================================================
-- BACKFILL (re-runnable)
-- ============================================================

-- 1) One channel per existing whatsapp_config row.
INSERT INTO channels (account_id, type, name, status, external_id, whatsapp_config_id)
SELECT wc.account_id, 'whatsapp', 'WhatsApp',
       channel_status_from_whatsapp(wc.status),
       NULLIF(wc.phone_number_id, ''), wc.id
FROM whatsapp_config wc
WHERE NOT EXISTS (SELECT 1 FROM channels c WHERE c.whatsapp_config_id = wc.id);

-- 2) A WhatsApp identity for every contact with a phone.
INSERT INTO contact_identities (account_id, contact_id, channel_type, external_id, display_name)
SELECT account_id, id, 'whatsapp', phone_normalized, name
FROM contacts
WHERE COALESCE(phone_normalized, '') <> ''
ON CONFLICT (account_id, channel_type, external_id) DO NOTHING;

-- 3) Point existing conversations at their channel and identity.
--    Accounts without a config row (Twilio fallback / WA Web) get an
--    unlinked WhatsApp channel here.
UPDATE conversations cv
SET channel_id = ensure_whatsapp_channel(cv.account_id)
WHERE cv.channel_id IS NULL;

UPDATE conversations cv
SET contact_identity_id = ci.id
FROM contact_identities ci
WHERE cv.contact_identity_id IS NULL
  AND ci.contact_id = cv.contact_id
  AND ci.channel_type = 'whatsapp';
