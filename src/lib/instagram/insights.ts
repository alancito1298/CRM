// Instagram account statistics for the insights page: profile counters,
// 30-day totals, the best posting times and the top recent posts.
// Requires instagram_business_manage_insights on the account's token.

const GRAPH = 'https://graph.instagram.com/v26.0';

const ACCOUNT_METRICS = [
  'reach', 'views', 'accounts_engaged', 'total_interactions',
  'likes', 'comments', 'shares', 'saves', 'profile_links_taps',
] as const;
export type AccountMetric = (typeof ACCOUNT_METRICS)[number];

/** 7 rows (Sunday..Saturday) × 24 hours, in UTC. */
export type WeekHourGrid = number[][];

export interface InstagramPost {
  id: string;
  caption: string | null;
  mediaType: string;
  permalink: string;
  thumbnailUrl: string | null;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number | null;
  interactions: number | null;
}

export interface InstagramInsights {
  account: {
    username: string | null;
    name: string | null;
    profilePictureUrl: string | null;
    followers: number;
    follows: number;
    mediaCount: number;
  };
  /** Last 30 days; a metric Meta doesn't return for this account is null. */
  totals: Record<AccountMetric, number | null>;
  /** When followers are online (UTC). Null under 100 followers. */
  onlineFollowers: WeekHourGrid | null;
  /** Average interactions of the account's own posts by publish time (UTC). */
  postPerformance: { grid: WeekHourGrid; posts: number[][] };
  topPosts: InstagramPost[];
  /** False when the token lacks the insights permission (reconnect needed). */
  insightsAllowed: boolean;
}

async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? `Instagram API ${response.status}`) as Error & { code?: number };
    error.code = data?.error?.code;
    throw error;
  }
  return data as T;
}

const emptyGrid = (): WeekHourGrid => Array.from({ length: 7 }, () => Array(24).fill(0));

export async function fetchInstagramInsights(userId: string, token: string): Promise<InstagramInsights> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - 30 * 86400 + 60;

  const [profile, media] = await Promise.all([
    graph<{
      username?: string; name?: string; profile_picture_url?: string;
      followers_count?: number; follows_count?: number; media_count?: number;
    }>('me', token, { fields: 'username,name,profile_picture_url,followers_count,follows_count,media_count' }),
    graph<{ data?: Array<Record<string, unknown>> }>('me/media', token, {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: '50',
    }).catch(() => ({ data: [] })),
  ]);

  // One request per metric: Meta rejects the whole call when any metric
  // in it is unavailable for the account.
  let insightsAllowed = true;
  const totalsEntries = await Promise.all(ACCOUNT_METRICS.map(async (metric) => {
    try {
      const res = await graph<{ data?: Array<{ total_value?: { value?: number } }> }>(
        `${userId}/insights`, token,
        { metric, period: 'day', metric_type: 'total_value', since: String(since), until: String(until) },
      );
      return [metric, res.data?.[0]?.total_value?.value ?? null] as const;
    } catch (error) {
      // 10 / 200 = permission missing from the token.
      const code = (error as { code?: number }).code;
      if (code === 10 || code === 200) insightsAllowed = false;
      return [metric, null] as const;
    }
  }));

  const posts = (media.data ?? []).map((m): InstagramPost => ({
    id: String(m.id),
    caption: (m.caption as string) ?? null,
    mediaType: String(m.media_product_type ?? m.media_type ?? ''),
    permalink: String(m.permalink ?? ''),
    thumbnailUrl: (m.thumbnail_url as string) ?? (m.media_type === 'VIDEO' ? null : (m.media_url as string) ?? null),
    timestamp: String(m.timestamp),
    likes: Number(m.like_count ?? 0),
    comments: Number(m.comments_count ?? 0),
    reach: null,
    interactions: null,
  }));

  if (insightsAllowed) {
    await Promise.all(posts.slice(0, 25).map(async (post) => {
      try {
        const res = await graph<{ data?: Array<{ name: string; values?: Array<{ value?: number }> }> }>(
          `${post.id}/insights`, token, { metric: 'reach,total_interactions' },
        );
        for (const row of res.data ?? []) {
          const value = row.values?.[0]?.value ?? null;
          if (row.name === 'reach') post.reach = value;
          if (row.name === 'total_interactions') post.interactions = value;
        }
      } catch { /* older or unsupported media */ }
    }));
  }

  return {
    account: {
      username: profile.username ?? null,
      name: profile.name ?? null,
      profilePictureUrl: profile.profile_picture_url ?? null,
      followers: profile.followers_count ?? 0,
      follows: profile.follows_count ?? 0,
      mediaCount: profile.media_count ?? 0,
    },
    totals: Object.fromEntries(totalsEntries) as Record<AccountMetric, number | null>,
    onlineFollowers: insightsAllowed ? await fetchOnlineFollowers(userId, token, since, until) : null,
    postPerformance: postPerformanceGrid(posts),
    topPosts: [...posts]
      .sort((a, b) => engagement(b) - engagement(a))
      .slice(0, 6),
    insightsAllowed,
  };
}

function engagement(post: InstagramPost): number {
  return post.interactions ?? post.likes + post.comments;
}

/** Average engagement per post, bucketed by the post's weekday and hour (UTC). */
export function postPerformanceGrid(posts: InstagramPost[]): { grid: WeekHourGrid; posts: number[][] } {
  const sum = emptyGrid();
  const count = emptyGrid();
  for (const post of posts) {
    const at = new Date(post.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    sum[at.getUTCDay()][at.getUTCHours()] += engagement(post);
    count[at.getUTCDay()][at.getUTCHours()] += 1;
  }
  return {
    grid: sum.map((row, d) => row.map((total, h) => (count[d][h] ? total / count[d][h] : 0))),
    posts: count,
  };
}

/**
 * online_followers returns, per day, follower counts keyed by hour 0-23.
 * Meta's lifetime periods end on UTC−07:00, so hour h is UTC h+7. Days
 * are averaged per weekday. Null when Meta has no data (<100 followers).
 */
async function fetchOnlineFollowers(
  userId: string, token: string, since: number, until: number,
): Promise<WeekHourGrid | null> {
  try {
    const res = await graph<{ data?: Array<{ values?: Array<{ value?: Record<string, number>; end_time?: string }> }> }>(
      `${userId}/insights`, token,
      { metric: 'online_followers', period: 'lifetime', since: String(since), until: String(until) },
    );
    const days = (res.data?.[0]?.values ?? []).filter((v) => v.value && Object.keys(v.value).length > 0);
    if (days.length === 0) return null;
    const sum = emptyGrid();
    const count = emptyGrid();
    for (const day of days) {
      const dayStart = new Date(Date.parse(day.end_time ?? '') - 86400_000);
      for (const [hour, value] of Object.entries(day.value!)) {
        const at = new Date(dayStart.getTime() + Number(hour) * 3600_000);
        sum[at.getUTCDay()][at.getUTCHours()] += value;
        count[at.getUTCDay()][at.getUTCHours()] += 1;
      }
    }
    return sum.map((row, d) => row.map((total, h) => (count[d][h] ? Math.round(total / count[d][h]) : 0)));
  } catch {
    return null;
  }
}
