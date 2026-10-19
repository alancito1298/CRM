-- Several Instagram accounts per CRM account: one connection per channel.
-- instagram_user_id stays globally unique, so a professional account can
-- only be connected to one CRM account at a time.
DROP INDEX IF EXISTS idx_instagram_connections_account;
CREATE INDEX IF NOT EXISTS idx_instagram_connections_account_lookup
  ON instagram_connections(account_id);

-- A disconnected channel keeps its row (and conversation history) but no
-- longer claims the provider id, so the same account can be connected
-- again elsewhere.
DROP INDEX IF EXISTS idx_channels_type_external;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_type_external
  ON channels(type, external_id)
  WHERE external_id IS NOT NULL AND status <> 'disconnected';
