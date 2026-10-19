// ============================================================
// Inbound sender → contact + identity, and contact → conversation.
//
// "Who is writing" is answered by `contact_identities` (channel_type,
// external_id). WhatsApp keeps its historical phone-based matching
// (`findExistingContact`, trunk-prefix tolerant) so a number saved by
// hand or imported from CSV still matches its first inbound message;
// every other channel matches strictly on its identity.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { ChannelType } from './types';

export interface InboundSender {
  /** Address on the channel: phone (WhatsApp), IGSID (Instagram). */
  externalId: string;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface ResolvedSender {
  contact: Row;
  identityId: string | null;
  /** True when this call created the contact. */
  wasCreated: boolean;
}

export async function resolveSenderContact(
  db: SupabaseClient,
  args: {
    accountId: string;
    auditUserId: string;
    channelType: ChannelType;
    sender: InboundSender;
  }
): Promise<ResolvedSender | null> {
  return args.channelType === 'whatsapp'
    ? resolveWhatsAppSender(db, args)
    : resolveIdentitySender(db, args);
}

async function resolveWhatsAppSender(
  db: SupabaseClient,
  {
    accountId,
    auditUserId,
    sender,
  }: { accountId: string; auditUserId: string; sender: InboundSender }
): Promise<ResolvedSender | null> {
  const phone = normalizePhone(sender.externalId);
  if (!phone) return null;
  const name = sender.displayName || null;

  let contact: Row | null = await findExistingContact(db, accountId, phone);
  let wasCreated = false;

  if (contact) {
    if (name && name !== contact.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', contact.id);
    }
  } else {
    // account_id is the tenancy column; user_id is the NOT NULL audit
    // FK (no human created an inbound contact — attribute it to the
    // channel owner as a stable default).
    const { data: created, error } = await db
      .from('contacts')
      .insert({ account_id: accountId, user_id: auditUserId, phone, name: name || phone })
      .select()
      .single();

    if (error || !created) {
      // Lost a race against a concurrent inbound: the unique index
      // (migration 022) rejected the duplicate. Re-resolve the winner.
      if (isUniqueViolation(error)) {
        contact = await findExistingContact(db, accountId, phone);
      }
      if (!contact) {
        console.error('[channels] error creating whatsapp contact:', error);
        return null;
      }
    } else {
      contact = created;
      wasCreated = true;
    }
  }

  const identityId = await ensureWhatsAppIdentity(db, accountId, contact!);
  return { contact: contact!, identityId, wasCreated };
}

/** The contact's WhatsApp identity, creating it if the sync trigger hasn't. */
async function ensureWhatsAppIdentity(
  db: SupabaseClient,
  accountId: string,
  contact: Row
): Promise<string | null> {
  const phone = normalizePhone(contact.phone ?? '');

  const find = async () => {
    const { data } = await db
      .from('contact_identities')
      .select('id, external_id')
      .eq('contact_id', contact.id)
      .eq('channel_type', 'whatsapp')
      .order('created_at', { ascending: true });
    const rows = (data ?? []) as Row[];
    return (rows.find((r) => r.external_id === phone) ?? rows[0])?.id ?? null;
  };

  const existing = await find();
  if (existing || !phone) return existing;

  await db
    .from('contact_identities')
    .upsert(
      { account_id: accountId, contact_id: contact.id, channel_type: 'whatsapp', external_id: phone },
      { onConflict: 'account_id,channel_type,external_id', ignoreDuplicates: true }
    );
  return find();
}

async function resolveIdentitySender(
  db: SupabaseClient,
  {
    accountId,
    auditUserId,
    channelType,
    sender,
  }: { accountId: string; auditUserId: string; channelType: ChannelType; sender: InboundSender }
): Promise<ResolvedSender | null> {
  const findIdentity = async () => {
    const { data } = await db
      .from('contact_identities')
      .select('id, username, display_name, avatar_url, contact:contacts(*)')
      .eq('account_id', accountId)
      .eq('channel_type', channelType)
      .eq('external_id', sender.externalId)
      .maybeSingle();
    return data as Row | null;
  };

  const existing = await findIdentity();
  if (existing?.contact) {
    const changes = Object.fromEntries(
      Object.entries(pickProfile(sender)).filter(([k, v]) => v && v !== existing[k])
    );
    if (Object.keys(changes).length > 0) {
      await db.from('contact_identities').update(changes).eq('id', existing.id);
    }
    // Contacts created before the profile was known are named after the
    // raw id; upgrade them once a real name arrives.
    const contact = existing.contact as Row;
    const betterName = sender.displayName || sender.username;
    const contactChanges: Row = {};
    if (betterName && (!contact.name || contact.name === sender.externalId)) contactChanges.name = betterName;
    if (sender.avatarUrl && !contact.avatar_url) contactChanges.avatar_url = sender.avatarUrl;
    if (Object.keys(contactChanges).length > 0) {
      await db.from('contacts').update(contactChanges).eq('id', contact.id);
      Object.assign(contact, contactChanges);
    }
    return { contact, identityId: existing.id, wasCreated: false };
  }

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: null,
      name: sender.displayName || sender.username || sender.externalId,
      avatar_url: sender.avatarUrl ?? null,
    })
    .select()
    .single();
  if (contactErr || !contact) {
    console.error(`[channels] error creating ${channelType} contact:`, contactErr);
    return null;
  }

  const { data: identity, error: identityErr } = await db
    .from('contact_identities')
    .insert({
      account_id: accountId,
      contact_id: contact.id,
      channel_type: channelType,
      external_id: sender.externalId,
      ...pickProfile(sender),
    })
    .select('id')
    .single();

  if (identityErr || !identity) {
    // Lost a race against a concurrent inbound from the same sender:
    // drop our contact and use the winner's.
    await db.from('contacts').delete().eq('id', contact.id);
    if (isUniqueViolation(identityErr)) {
      const raced = await findIdentity();
      if (raced?.contact) {
        return { contact: raced.contact, identityId: raced.id, wasCreated: false };
      }
    }
    console.error(`[channels] error creating ${channelType} identity:`, identityErr);
    return null;
  }

  return { contact, identityId: identity.id, wasCreated: true };
}

function pickProfile(sender: InboundSender) {
  return {
    username: sender.username ?? null,
    display_name: sender.displayName ?? null,
    avatar_url: sender.avatarUrl ?? null,
  };
}

/**
 * Find (oldest-first) or create the conversation for this contact on
 * this channel. Never `.single()`: if duplicates predate the unique
 * index (migration 036) we converge on the canonical survivor instead
 * of creating yet another (issue #363).
 */
export async function findOrCreateConversation(
  db: SupabaseClient,
  args: {
    accountId: string;
    auditUserId: string;
    contactId: string;
    channelId: string | null;
    identityId: string | null;
  }
): Promise<{ conversation: Row; created: boolean } | null> {
  const { accountId, auditUserId, contactId, channelId, identityId } = args;

  const find = async () => {
    let query = db
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId);
    if (channelId) query = query.eq('channel_id', channelId);
    const { data, error } = await query.order('created_at', { ascending: true }).limit(1);
    if (error) {
      console.error('[channels] error finding conversation:', error);
      return undefined;
    }
    return (data?.[0] as Row | undefined) ?? null;
  };

  const existing = await find();
  if (existing === undefined) return null;
  if (existing) {
    if (identityId && !existing.contact_identity_id) {
      await db
        .from('conversations')
        .update({ contact_identity_id: identityId })
        .eq('id', existing.id);
      existing.contact_identity_id = identityId;
    }
    return { conversation: existing, created: false };
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      contact_id: contactId,
      channel_id: channelId,
      contact_identity_id: identityId,
    })
    .select()
    .single();

  if (error || !created) {
    // Lost a race: a concurrent inbound created it first and the unique
    // index rejected ours. Re-resolve the winner.
    if (isUniqueViolation(error)) {
      const raced = await find();
      if (raced) return { conversation: raced, created: false };
    }
    console.error('[channels] error creating conversation:', error);
    return null;
  }

  return { conversation: created, created: true };
}
