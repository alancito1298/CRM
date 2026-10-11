"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Notification } from "@/types";
import {
  Bell,
  CheckCheck,
  Loader2,
  UserPlus,
  Bot,
  Sparkles,
  CreditCard,
  Volume2,
  VolumeX,
  Play,
  MonitorCheck,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  playNotificationSound,
  isSoundEnabled,
  setSoundEnabled,
} from "@/lib/notifications/sound";
import {
  isBrowserNotificationSupported,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from "@/lib/notifications/browser-notification";

const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
  ai_handoff: Bot,
  new_lead: Sparkles,
  payment_received: CreditCard,
};

const TYPE_BADGE: Record<Notification["type"], { label: string; className: string }> = {
  ai_handoff: {
    label: "Derivación IA",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  conversation_assigned: {
    label: "Asignado",
    className: "bg-primary/10 text-primary border-primary/30",
  },
  new_lead: {
    label: "Nuevo Lead",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  payment_received: {
    label: "Pago",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
};

export default function NotificationsPage() {
  const router = useRouter();
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setSoundOn(isSoundEnabled());
    setBrowserPermission(getBrowserNotificationPermission());
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) {
      playNotificationSound('chime');
      toast.success('Sonido de notificaciones activado');
    } else {
      toast.info('Sonido de notificaciones silenciado');
    }
  };

  const handleTestSound = () => {
    playNotificationSound('urgent');
    toast.info('Reproduciendo sonido de alerta urgente (Web Audio)');
  };

  const handleRequestDesktopPermission = async () => {
    const res = await requestBrowserNotificationPermission();
    setBrowserPermission(res);
    if (res === 'granted') {
      toast.success('¡Avisos de escritorio activados!');
    } else if (res === 'denied') {
      toast.error('Permiso bloqueado en el navegador. Habilítalo en el candado de la URL.');
    }
  };

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime — new assignments appear without a refresh
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ) ?? prev,
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (updateErr) {
        toast.error("Failed to mark notification as read");
        load();
      }
    },
    [load],
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) => prev?.map((n) => ({ ...n, read_at: n.read_at ?? now })) ?? prev,
    );
    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("notifications")
        .update({ read_at: now })
        .in("id", unreadIds);
      if (updateErr) {
        toast.error("Failed to mark all as read");
        load();
      } else {
        toast.success("All notifications marked as read");
      }
    } finally {
      setMarkingAll(false);
    }
  }, [unreadIds, load]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Title and Notification Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notificaciones en Tiempo Real</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alertas de derivaciones de la IA, leads y asignaciones para tu equipo.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sound Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSound}
            className="text-xs gap-1.5 h-8"
            title={soundOn ? "Silenciar sonido" : "Activar sonido"}
          >
            {soundOn ? <Volume2 className="h-3.5 w-3.5 text-emerald-500" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
            {soundOn ? "Sonido Activo" : "Silenciado"}
          </Button>

          {/* Test Sound Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTestSound}
            className="text-xs gap-1.5 h-8 text-muted-foreground hover:text-foreground"
          >
            <Play className="h-3 w-3" />
            Probar Alerta
          </Button>

          {/* Desktop Notification Request */}
          {browserPermission === 'default' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRequestDesktopPermission}
              className="text-xs gap-1.5 h-8 bg-primary/5 border-primary/30 text-primary"
            >
              <MonitorCheck className="h-3.5 w-3.5" />
              Activar Avisos de Escritorio
            </Button>
          )}

          {/* Mark All Read */}
          <Button
            variant="outline"
            size="sm"
            disabled={unreadIds.length === 0 || markingAll}
            onClick={markAllRead}
            className="text-xs gap-1.5 h-8"
          >
            {markingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            Marcar todas leídas
          </Button>
        </div>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No tienes notificaciones pendientes
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cuando un cliente solicite un asesor humano o se te asigne un chat, recibirás una alerta sonora aquí.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const badge = TYPE_BADGE[n.type];
            const isUnread = !n.read_at;
            const isUrgent = n.type === 'ai_handoff';

            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all",
                    isUrgent && isUnread
                      ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60 shadow-sm"
                      : isUnread
                        ? "border-primary/30 bg-primary/5 hover:border-primary/50"
                        : "border-border bg-card hover:border-border/70",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                      isUrgent && isUnread
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                        : isUnread
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "text-sm font-semibold truncate",
                          isUnread ? "text-foreground font-bold" : "text-muted-foreground",
                        )}
                      >
                        {n.title}
                      </span>

                      {badge && (
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", badge.className)}>
                          {badge.label}
                        </Badge>
                      )}

                      {isUnread && (
                        <span
                          aria-label="No leída"
                          className={cn(
                            "h-2 w-2 flex-shrink-0 rounded-full",
                            isUrgent ? "bg-amber-500 animate-pulse" : "bg-primary"
                          )}
                        />
                      )}
                    </div>

                    {n.body && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {n.body}
                      </p>
                    )}

                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground/70">
                      <span>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                      <span className="text-primary font-medium hover:underline">
                        Abrir conversación →
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
