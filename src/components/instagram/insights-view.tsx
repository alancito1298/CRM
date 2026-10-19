'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Camera, ExternalLink, Heart, MessageCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AccountMetric, InstagramInsights, WeekHourGrid } from '@/lib/instagram/insights';

interface InstagramAccount { id: string; name: string; status: string }

const TILE_METRICS: AccountMetric[] = [
  'reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves',
];
// Monday-first rows; values are JS getDay() indexes.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Any Sunday 00:00 UTC, used to shift the UTC grid into the viewer's time zone.
const REFERENCE_SUNDAY = Date.UTC(2026, 9, 18);

/** Re-bucket a Sunday-first UTC grid into the browser's local weekday/hour. */
function toLocal(grid: WeekHourGrid): WeekHourGrid {
  const local: WeekHourGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
  grid.forEach((row, day) => row.forEach((value, hour) => {
    const at = new Date(REFERENCE_SUNDAY + (day * 24 + hour) * 3600_000);
    local[at.getDay()][at.getHours()] += value;
  }));
  return local;
}

export function InstagramInsightsView() {
  const t = useTranslations('InstagramInsights');
  const [accounts, setAccounts] = useState<InstagramAccount[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; data?: InstagramInsights; error?: boolean } | null>(null);
  const current = result && result.id === selected ? result : null;
  const data = current?.data ?? null;
  const error = !!current?.error;
  const loading = !!selected && !current;

  useEffect(() => {
    fetch('/api/instagram/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: { accounts?: InstagramAccount[] }) => {
        const connected = (s.accounts ?? []).filter((a) => a.status === 'connected');
        setAccounts(connected);
        setSelected(connected[0]?.id ?? null);
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/instagram/insights?channelId=${selected}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: InstagramInsights) => { if (!cancelled) setResult({ id: selected, data: d }); })
      .catch(() => { if (!cancelled) setResult({ id: selected, error: true }); });
    return () => { cancelled = true; };
  }, [selected]);

  if (accounts && accounts.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <Camera className="size-6 text-muted-foreground" />
        <p className="text-sm">{t('noAccounts')}</p>
        <Link href="/settings?tab=instagram" className="text-sm font-medium text-primary hover:underline">
          {t('goToSettings')}
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {data?.account.profilePictureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.account.profilePictureUrl} alt="" className="size-10 rounded-full object-cover" />
          )}
          <div>
            <h1 className="text-lg font-semibold">{data?.account.username ? `@${data.account.username}` : t('title')}</h1>
            <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        {accounts && accounts.length > 1 && (
          <select aria-label={t('selectAccount')} value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{t('loadError')}</p>}
      {loading && !data && <p className="text-sm text-muted-foreground">{t('loading')}</p>}

      {data && (
        <>
          {!data.insightsAllowed && (
            <Card className="border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              {t('needsReconnect')}{' '}
              <Link href="/settings?tab=instagram" className="font-medium text-primary hover:underline">
                {t('goToSettings')}
              </Link>
            </Card>
          )}

          <section aria-label={t('summary')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label={t('followers')} value={data.account.followers} />
            <StatTile label={t('posts')} value={data.account.mediaCount} />
            {TILE_METRICS.slice(0, 4).map((m) => (
              <StatTile key={m} label={t(`metrics.${m}`)} value={data.totals[m]} hint={t('last30')} />
            ))}
          </section>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TILE_METRICS.slice(4).map((m) => (
              <StatTile key={m} label={t(`metrics.${m}`)} value={data.totals[m]} hint={t('last30')} />
            ))}
          </section>

          <HeatmapCard data={data} />
          <TopPosts posts={data.topPosts} />
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  const locale = useLocale();
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value === null ? '—' : value.toLocaleString(locale)}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function HeatmapCard({ data }: { data: InstagramInsights }) {
  const t = useTranslations('InstagramInsights');
  const locale = useLocale();
  const hasOnline = !!data.onlineFollowers;
  const [mode, setMode] = useState<'online' | 'posts'>(hasOnline ? 'online' : 'posts');

  const grid = useMemo(
    () => toLocal(mode === 'online' && data.onlineFollowers ? data.onlineFollowers : data.postPerformance.grid),
    [mode, data],
  );
  const postCounts = useMemo(() => toLocal(data.postPerformance.posts), [data]);
  const max = Math.max(0, ...grid.flat());
  const dayName = (d: number) =>
    new Date(REFERENCE_SUNDAY + d * 86400_000 + 12 * 3600_000).toLocaleDateString(locale, { weekday: 'short' });

  // Five sequential steps of the primary hue; empty cells stay neutral.
  const step = (v: number) => {
    if (v <= 0 || max <= 0) return 'bg-muted';
    const r = v / max;
    return r > 0.8 ? 'bg-primary' : r > 0.6 ? 'bg-primary/75' : r > 0.4 ? 'bg-primary/50' : r > 0.2 ? 'bg-primary/30' : 'bg-primary/15';
  };

  const best = useMemo(() => {
    let top = { d: 0, h: 0, v: 0 };
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > top.v) top = { d, h, v }; }));
    return top.v > 0 ? top : null;
  }, [grid]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t('heatmapTitle')}</h2>
          <p className="text-xs text-muted-foreground">
            {mode === 'online' ? t('heatmapOnlineHint') : t('heatmapPostsHint')}
          </p>
          {!hasOnline && <p className="mt-1 text-[11px] text-muted-foreground">{t('onlineUnavailable')}</p>}
        </div>
        {hasOnline && (
          <div className="flex rounded-md border border-border p-0.5 text-xs" role="tablist">
            {(['online', 'posts'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={cn('rounded px-2.5 py-1', mode === m ? 'bg-muted font-medium' : 'text-muted-foreground')}>
                {m === 'online' ? t('modeOnline') : t('modePosts')}
              </button>
            ))}
          </div>
        )}
      </div>

      {best && (
        <p className="mt-3 text-sm">
          {t('bestTime', { day: dayName(best.d), hour: `${String(best.h).padStart(2, '0')}:00` })}
        </p>
      )}
      {!best && <p className="mt-3 text-sm text-muted-foreground">{t('noData')}</p>}

      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-160 gap-0.5" style={{ gridTemplateColumns: '3rem repeat(24, minmax(0, 1fr))' }}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[10px] text-muted-foreground">{h % 3 === 0 ? h : ''}</span>
          ))}
          {WEEK_ORDER.map((d) => (
            <div key={d} className="contents">
              <span className="pr-2 text-right text-[11px] leading-6 text-muted-foreground">{dayName(d)}</span>
              {grid[d].map((v, h) => {
                const label = mode === 'online'
                  ? t('cellOnline', { day: dayName(d), hour: h, value: v })
                  : t('cellPosts', { day: dayName(d), hour: h, value: Math.round(v), posts: postCounts[d][h] });
                return <span key={h} title={label} aria-label={label} className={cn('h-6 rounded-[3px]', step(v))} />;
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t('less')}</span>
        {['bg-muted', 'bg-primary/15', 'bg-primary/30', 'bg-primary/50', 'bg-primary/75', 'bg-primary'].map((c) => (
          <span key={c} className={cn('size-3 rounded-[3px]', c)} />
        ))}
        <span>{t('more')}</span>
        <span className="ml-auto">{t('localTime')}</span>
      </div>
    </Card>
  );
}

function TopPosts({ posts }: { posts: InstagramInsights['topPosts'] }) {
  const t = useTranslations('InstagramInsights');
  const locale = useLocale();
  if (posts.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{t('topPosts')}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {posts.map((post) => (
          <li key={post.id}>
            <a href={post.permalink} target="_blank" rel="noreferrer"
              className="group block overflow-hidden rounded-lg border border-border">
              <div className="aspect-square bg-muted">
                {post.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbnailUrl} alt={post.caption?.slice(0, 80) ?? ''} className="size-full object-cover" />
                )}
              </div>
              <div className="space-y-1 p-2 text-xs">
                <div className="flex items-center gap-3 text-foreground">
                  <span className="inline-flex items-center gap-1"><Heart className="size-3" />{post.likes}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" />{post.comments}</span>
                  <ExternalLink className="ml-auto size-3 text-muted-foreground group-hover:text-foreground" />
                </div>
                {post.reach !== null && (
                  <p className="text-muted-foreground">{t('reachValue', { value: post.reach.toLocaleString(locale) })}</p>
                )}
                <p className="text-muted-foreground">
                  {new Date(post.timestamp).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
