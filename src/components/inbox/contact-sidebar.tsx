"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId, canEditSettings } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [identities, setIdentities] = useState<Array<{ id: string; channel_type: string; username: string | null; external_id: string }>>([]);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeCandidates, setMergeCandidates] = useState<Array<{ id: string; name: string | null; phone: string | null }>>([]);
  const [merging, setMerging] = useState(false);

  // MercadoPago Cobros state
  const [mpTitle, setMpTitle] = useState("");
  const [mpAmount, setMpAmount] = useState("");
  const [mpLoading, setMpLoading] = useState(false);
  const [mpUrl, setMpUrl] = useState<string | null>(null);
  const [mpCopied, setMpCopied] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes, identitiesRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("contact_identities").select("id, channel_type, username, external_id")
        .eq("contact_id", contact.id).order("created_at"),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    setIdentities(identitiesRes.data ?? []);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  useEffect(() => {
    if (!accountId || !contact || mergeSearch.trim().length < 2) return;
    let cancelled = false;
    const supabase = createClient();
    const term = mergeSearch.trim().replace(/[\\%_]/g, "\\$&");
    Promise.all([
      supabase.from("contacts").select("id,name,phone").eq("account_id", accountId)
        .neq("id", contact.id).ilike("name", `%${term}%`).limit(10),
      supabase.from("contacts").select("id,name,phone").eq("account_id", accountId)
        .neq("id", contact.id).ilike("phone", `%${term}%`).limit(10),
    ]).then((results) => {
      if (cancelled) return;
      const unique = new Map<string, { id: string; name: string | null; phone: string | null }>();
      for (const result of results) for (const row of result.data ?? []) unique.set(row.id, row);
      setMergeCandidates([...unique.values()]);
    });
    return () => { cancelled = true; };
  }, [accountId, contact, mergeSearch]);

  const handleMerge = async (candidate: { id: string; name: string | null; phone: string | null }) => {
    if (!contact || !window.confirm(tSidebar("mergeConfirm", { name: candidate.name || candidate.phone || candidate.id }))) return;
    setMerging(true);
    try {
      const response = await fetch("/api/contacts/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_id: contact.id, merge_id: candidate.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tSidebar("mergeError"));
      toast.success(tSidebar("mergeSuccess"));
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tSidebar("mergeError"));
    } finally {
      setMerging(false);
    }
  };

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleCreateMpPayment = async () => {
    if (!mpAmount || Number(mpAmount) <= 0) return;
    setMpLoading(true);
    setMpUrl(null);
    try {
      const res = await fetch("/api/payments/mercadopago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: mpTitle.trim() || "Cobro de Servicio",
          amount: Number(mpAmount),
        }),
      });
      const data = await res.json();
      if (res.ok && data.init_point) {
        setMpUrl(data.init_point);
      } else {
        alert(data.error || "Error al generar link de MercadoPago");
      }
    } catch {
      alert("Error al conectar con MercadoPago");
    } finally {
      setMpLoading(false);
    }
  };

  const handleCopyMpUrl = async () => {
    if (!mpUrl) return;
    await navigator.clipboard.writeText(mpUrl);
    setMpCopied(true);
    setTimeout(() => setMpCopied(false), 2000);
  };

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || identities[0]?.username || "Contact";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground overflow-hidden">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = "none";
                  }}
                />
              ) : null}
              <span className={contact.avatar_url ? "hidden" : ""}>{initials}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.phone && <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>}

            {identities.map((identity) => (
              <div key={identity.id} className="flex items-center gap-2 rounded-lg px-3 py-1 text-xs text-muted-foreground">
                <span className="font-medium capitalize">{identity.channel_type}</span>
                <span className="truncate">{identity.username || identity.external_id}</span>
              </div>
            ))}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {canEditSettings && <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{tSidebar("mergeTitle")}</p>
            <input value={mergeSearch} onChange={(event) => setMergeSearch(event.target.value)}
              placeholder={tSidebar("mergeSearch")} aria-label={tSidebar("mergeSearch")}
              className="w-full rounded border border-border bg-background px-2.5 py-2 text-xs" />
            {mergeSearch.trim().length >= 2 && mergeCandidates.map((candidate) => (
              <button key={candidate.id} type="button" disabled={merging} onClick={() => handleMerge(candidate)}
                className="block w-full rounded border border-border px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50">
                <span className="block font-medium">{candidate.name || candidate.phone || candidate.id}</span>
                {candidate.phone && <span className="text-muted-foreground">{candidate.phone}</span>}
              </button>
            ))}
          </div>}

          {canEditSettings && <div className="my-4 border-t border-border" />}

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* MercadoPago Link Generator */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <CreditCard className="h-3 w-3 text-blue-500" />
              MercadoPago (Cobro)
            </div>
            <div className="mt-2 rounded-lg bg-muted p-3 space-y-2">
              <input
                type="text"
                value={mpTitle}
                onChange={(e) => setMpTitle(e.target.value)}
                placeholder="Concepto (ej. Consulta)"
                className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  value={mpAmount}
                  onChange={(e) => setMpAmount(e.target.value)}
                  placeholder="Monto ($)"
                  className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                />
                <Button
                  size="sm"
                  onClick={handleCreateMpPayment}
                  disabled={!mpAmount || Number(mpAmount) <= 0 || mpLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3"
                >
                  {mpLoading ? "..." : "Link"}
                </Button>
              </div>

              {mpUrl && (
                <div className="mt-2 space-y-1.5 pt-2 border-t border-border/50">
                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    ¡Link generado con éxito!
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyMpUrl}
                      className="flex-1 text-[11px] h-7 gap-1"
                    >
                      {mpCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      {mpCopied ? "Copiado" : "Copiar Link"}
                    </Button>
                    <a
                      href={mpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded border border-border bg-background px-2 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
