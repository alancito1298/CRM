'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Card } from '@/components/ui/card';

interface InstagramStatus {
  connected: boolean;
  channel: { external_id: string; status: string } | null;
}

export function InstagramConfig() {
  const t = useTranslations('Settings.instagramConfig');
  const params = useSearchParams();
  const { accountRole } = useAuth();
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/instagram/status', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('status failed');
        return response.json() as Promise<InstagramStatus>;
      })
      .then(setStatus)
      .catch(() => setError(true));
  }, []);

  const canConnect = accountRole === 'owner' || accountRole === 'admin';
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <Camera className="size-6" />
        <div>
          <h2 className="text-lg font-semibold">Instagram</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>
      <div className="mt-5 space-y-3 text-sm">
        {status?.connected ? <p>{t('connected', { id: status.channel?.external_id ?? '' })}</p> :
          <p>{error ? t('statusError') : t('disconnected')}</p>}
        {params.get('instagram') === 'error' && <p role="alert">{t('connectError')}</p>}
        {params.get('instagram') === 'invalid_state' && <p role="alert">{t('invalidState')}</p>}
        {params.get('instagram') === 'connected' && <p role="status">{t('connectSuccess')}</p>}
        {canConnect && (
          <a href="/api/instagram/connect"
            className="inline-flex rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
            {status?.connected ? t('reconnect') : t('connect')}
          </a>
        )}
        <p className="text-muted-foreground">{t('replyWindow')}</p>
      </div>
    </Card>
  );
}
