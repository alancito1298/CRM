'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface InstagramAccount {
  id: string;
  name: string;
  status: string;
  external_id: string;
}

interface InstagramStatus {
  accounts: InstagramAccount[];
  limit: number;
}

// Result of the OAuth round-trip, set by /api/instagram/callback.
const RESULT_KEYS: Record<string, string> = {
  connected: 'connectSuccess',
  error: 'connectError',
  invalid_state: 'invalidState',
  missing_code: 'connectError',
  cancelled: 'cancelled',
  in_use: 'inUse',
  limit_reached: 'limitReached',
  subscribe_failed: 'subscribeFailed',
};

export function InstagramConfig() {
  const t = useTranslations('Settings.instagramConfig');
  const params = useSearchParams();
  const { accountRole } = useAuth();
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/instagram/status', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('status failed');
        return response.json() as Promise<InstagramStatus>;
      })
      .then((data) => { setStatus(data); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const disconnect = async (account: InstagramAccount) => {
    if (!window.confirm(t('disconnectConfirm', { name: account.name }))) return;
    setBusyId(account.id);
    try {
      const response = await fetch('/api/instagram/disconnect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: account.id }),
      });
      if (!response.ok) throw new Error('disconnect failed');
      toast.success(t('disconnectSuccess'));
      load();
    } catch {
      toast.error(t('disconnectError'));
    } finally {
      setBusyId(null);
    }
  };

  const importHistory = async (account: InstagramAccount) => {
    setBusyId(account.id);
    setImportingId(account.id);
    try {
      const response = await fetch('/api/instagram/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: account.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error('import failed');
      toast.success(t('importSuccess', data));
    } catch {
      toast.error(t('importError'));
    } finally {
      setBusyId(null);
      setImportingId(null);
    }
  };

  const canConnect = accountRole === 'owner' || accountRole === 'admin';
  const accounts = status?.accounts ?? [];
  const atLimit = status ? accounts.length >= status.limit : false;
  const result = params.get('instagram');
  const resultKey = result ? RESULT_KEYS[result] : undefined;

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
        {resultKey && (
          <p role={result === 'connected' ? 'status' : 'alert'}
            className={result === 'connected' ? 'text-emerald-600' : 'text-destructive'}>
            {t(resultKey)}
          </p>
        )}
        {error && <p role="alert" className="text-destructive">{t('statusError')}</p>}
        {status && accounts.length === 0 && <p>{t('disconnected')}</p>}

        {accounts.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {accounts.map((account) => {
              const needsReconnect = account.status !== 'connected';
              return (
                <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.name}</p>
                    <p className={needsReconnect ? 'text-xs text-destructive' : 'text-xs text-emerald-600'}>
                      {needsReconnect ? t('statusNeedsReconnect') : t('statusConnected')}
                    </p>
                  </div>
                  {canConnect && (
                    <div className="flex gap-2">
                      {needsReconnect && (
                        <a href="/api/instagram/connect"
                          className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                          {t('reconnect')}
                        </a>
                      )}
                      {!needsReconnect && (
                        <Button variant="outline" size="sm" disabled={busyId === account.id}
                          onClick={() => importHistory(account)}>
                          {importingId === account.id ? t('importing') : t('import')}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" disabled={busyId === account.id}
                        onClick={() => disconnect(account)}>
                        {t('disconnect')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {status && (
          <p className="text-xs text-muted-foreground">
            {t('limitInfo', { used: accounts.length, limit: status.limit })}
          </p>
        )}

        {canConnect && status && !atLimit && (
          <a href="/api/instagram/connect"
            className="inline-flex rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
            {accounts.length > 0 ? t('connectAnother') : t('connect')}
          </a>
        )}
        {canConnect && atLimit && <p className="text-muted-foreground">{t('limitReached')}</p>}

        <p className="text-muted-foreground">{t('replyWindow')}</p>
      </div>
    </Card>
  );
}
