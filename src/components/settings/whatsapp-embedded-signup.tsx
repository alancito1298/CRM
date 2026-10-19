'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Facebook JS SDK globals used by Embedded Signup.
interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
}
declare global {
  interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID;
const SDK_VERSION = 'v21.0';

function loadSdk(): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID!, autoLogAppEvents: true, xfbml: false, version: SDK_VERSION });
      resolve(window.FB!);
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Facebook SDK failed to load'));
    document.body.appendChild(script);
  });
}

type SessionInfo = { phone_number_id: string; waba_id: string; coexistence: boolean };

/**
 * "Connect WhatsApp" button (Meta Embedded Signup). Hidden until the
 * deployment sets NEXT_PUBLIC_META_APP_ID and NEXT_PUBLIC_WHATSAPP_ES_CONFIG_ID.
 */
export function WhatsAppEmbeddedSignup({ onConnected }: { onConnected: () => void }) {
  const t = useTranslations('Settings.whatsapp.embeddedSignup');
  const [busy, setBusy] = useState(false);
  // Meta delivers the auth code (FB.login callback) and the chosen
  // number (postMessage) separately; finish once both have arrived.
  const pending = useRef<{ code?: string; session?: SessionInfo }>({});

  const finish = useCallback(async () => {
    const { code, session } = pending.current;
    if (!code || !session) return;
    pending.current = {};
    try {
      const response = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...session }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'in_use' ? t('inUse') : t('error'));
      toast.success(data.registration_error ? t('connectedWithWarning') : t('connected'));
      onConnected();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error'));
    } finally {
      setBusy(false);
    }
  }, [onConnected, t]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      let data: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string } };
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'CANCEL' || data.event === 'ERROR') {
        pending.current = {};
        setBusy(false);
        if (data.event === 'ERROR') toast.error(t('error'));
        return;
      }
      const ids = data.data;
      if (ids?.phone_number_id && ids.waba_id) {
        pending.current.session = {
          phone_number_id: ids.phone_number_id,
          waba_id: ids.waba_id,
          coexistence: data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        };
        void finish();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [finish, t]);

  if (!APP_ID || !CONFIG_ID) return null;

  const start = async (coexistence: boolean) => {
    setBusy(true);
    pending.current = {};
    try {
      const FB = await loadSdk();
      FB.login((response) => {
        const code = response.authResponse?.code;
        if (!code) { setBusy(false); return; }
        pending.current.code = code;
        void finish();
      }, {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: coexistence ? 'whatsapp_business_app_onboarding' : '',
          sessionInfoVersion: '3',
        },
      });
    } catch {
      setBusy(false);
      toast.error(t('error'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <MessageCircle className="size-5" />
          {t('title')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button onClick={() => start(false)} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t('connect')}
        </Button>
        <Button variant="outline" onClick={() => start(true)} disabled={busy}>
          {t('connectBusinessApp')}
        </Button>
        <p className="w-full text-xs text-muted-foreground">{t('hint')}</p>
      </CardContent>
    </Card>
  );
}
