-- Instagram credentials are server-side only. The channels row contains
-- non-secret routing metadata; no authenticated RLS policy exposes tokens.
CREATE TABLE IF NOT EXISTS instagram_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
  instagram_user_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  token_issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_connections_account
  ON instagram_connections(account_id);
ALTER TABLE instagram_connections ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS set_updated_at ON instagram_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
