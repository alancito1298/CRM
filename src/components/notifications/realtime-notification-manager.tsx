'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { Notification } from '@/types';
import { playNotificationSound, type SoundType } from '@/lib/notifications/sound';
import { sendBrowserNotification } from '@/lib/notifications/browser-notification';

/**
 * RealtimeNotificationManager
 *
 * Headless background component mounted in DashboardShell.
 * Listens for new realtime notifications (assigned chats, AI handoffs, leads),
 * playing synthetic sound chimes and dispatching native desktop OS alerts.
 */
export function RealtimeNotificationManager() {
  const router = useRouter();
  const { user, accountId } = useAuth();
  const handledIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !accountId) return;

    const supabase = createClient();
    const channelName = `agent-notifications-${accountId}-${user.id}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Notification;
          if (!row || row.read_at) return;

          // Deduplicate events arriving in quick succession
          if (handledIdsRef.current.has(row.id)) return;
          handledIdsRef.current.add(row.id);

          // 1. Determine Sound Profile
          let soundType: SoundType = 'chime';
          if (row.type === 'ai_handoff') {
            soundType = 'urgent';
          } else if (row.type === 'payment_received' || row.type === 'new_lead') {
            soundType = 'lead';
          }

          // 2. Play Audio Chime
          playNotificationSound(soundType);

          // 3. In-App Interactive Toast
          if (row.type === 'ai_handoff') {
            toast.error(row.title, {
              description: row.body || 'Un cliente requiere atención inmediata de un asesor humano.',
              duration: 12000,
              action: row.conversation_id
                ? {
                    label: '⚡ Atender Chat',
                    onClick: () => router.push(`/inbox?c=${row.conversation_id}`),
                  }
                : undefined,
            });
          } else {
            toast.info(row.title, {
              description: row.body,
              duration: 7000,
              action: row.conversation_id
                ? {
                    label: 'Ver Chat',
                    onClick: () => router.push(`/inbox?c=${row.conversation_id}`),
                  }
                : undefined,
            });
          }

          // 4. Native OS Desktop Notification (if tab is minimized or in background)
          if (typeof document !== 'undefined' && (document.hidden || !document.hasFocus())) {
            sendBrowserNotification({
              title: row.title,
              body: row.body || '',
              conversationId: row.conversation_id,
              onClick: () => {
                if (row.conversation_id) {
                  router.push(`/inbox?c=${row.conversation_id}`);
                }
              },
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, accountId, router]);

  return null;
}
