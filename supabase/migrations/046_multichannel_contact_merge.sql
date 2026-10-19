-- One thread per contact and connected channel. Existing rows were backfilled
-- by 043, so the former account/contact constraint can now be narrowed.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations(account_id, contact_id, channel_id)
  WHERE channel_id IS NOT NULL;

-- Called only by the server with the service role, after an admin has chosen
-- two contacts. A transaction either transfers all their data or none of it.
CREATE OR REPLACE FUNCTION public.merge_channel_contacts(
  p_account_id UUID, p_keep_id UUID, p_merge_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_keep contacts%ROWTYPE;
  v_merge contacts%ROWTYPE;
BEGIN
  IF p_keep_id = p_merge_id THEN RAISE EXCEPTION 'Contacts must differ'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_account_id::text));
  SELECT * INTO v_keep FROM contacts WHERE id = p_keep_id AND account_id = p_account_id FOR UPDATE;
  SELECT * INTO v_merge FROM contacts WHERE id = p_merge_id AND account_id = p_account_id FOR UPDATE;
  IF v_keep.id IS NULL OR v_merge.id IS NULL THEN RAISE EXCEPTION 'Contact not found in account'; END IF;

  -- A channel can have only one conversation for the merged person. Never
  -- silently fold message histories or choose a destination for a reply.
  IF EXISTS (
    SELECT 1 FROM conversations a JOIN conversations b
      ON a.channel_id = b.channel_id
     WHERE a.contact_id = p_keep_id AND b.contact_id = p_merge_id
  ) THEN RAISE EXCEPTION 'Both contacts already have a conversation on the same channel'; END IF;

  IF EXISTS (
    SELECT 1 FROM flow_runs a JOIN flow_runs b
      ON a.user_id = b.user_id
     WHERE a.contact_id = p_keep_id AND b.contact_id = p_merge_id
       AND a.status = 'active' AND b.status = 'active'
  ) THEN RAISE EXCEPTION 'Both contacts have active flows'; END IF;

  UPDATE contact_identities SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE conversations SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE contact_notes SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE deals SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE broadcast_recipients SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE automation_logs SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE automation_pending_executions SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE notifications SET contact_id = p_keep_id WHERE contact_id = p_merge_id;
  UPDATE flow_runs SET contact_id = p_keep_id WHERE contact_id = p_merge_id;

  INSERT INTO contact_tags(contact_id, tag_id)
    SELECT p_keep_id, tag_id FROM contact_tags WHERE contact_id = p_merge_id
    ON CONFLICT(contact_id, tag_id) DO NOTHING;
  INSERT INTO contact_custom_values(contact_id, custom_field_id, value)
    SELECT p_keep_id, custom_field_id, value FROM contact_custom_values WHERE contact_id = p_merge_id
    ON CONFLICT(contact_id, custom_field_id) DO NOTHING;

  DELETE FROM contacts WHERE id = p_merge_id;
  UPDATE contacts SET
    phone = COALESCE(NULLIF(v_keep.phone, ''), v_merge.phone),
    email = COALESCE(NULLIF(v_keep.email, ''), v_merge.email),
    company = COALESCE(NULLIF(v_keep.company, ''), v_merge.company),
    avatar_url = COALESCE(NULLIF(v_keep.avatar_url, ''), v_merge.avatar_url)
  WHERE id = p_keep_id;
  RETURN p_keep_id;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_channel_contacts(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_channel_contacts(UUID, UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_channel_contacts(UUID, UUID, UUID) TO service_role;
