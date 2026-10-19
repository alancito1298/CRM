import { describe, expect, it } from 'vitest';
import { postPerformanceGrid, type InstagramPost } from './insights';

const post = (timestamp: string, likes: number, interactions: number | null = null): InstagramPost => ({
  id: timestamp, caption: null, mediaType: 'FEED', permalink: '', thumbnailUrl: null,
  timestamp, likes, comments: 0, reach: null, interactions,
});

describe('postPerformanceGrid', () => {
  it('averages engagement per weekday and UTC hour, preferring insights interactions', () => {
    const { grid, posts } = postPerformanceGrid([
      post('2026-10-19T21:15:00+0000', 10), // Monday 21h
      post('2026-10-26T21:40:00+0000', 0, 30), // Monday 21h, insights win over likes
      post('2026-10-21T08:00:00+0000', 4), // Wednesday 08h
    ]);
    expect(grid[1][21]).toBe(20);
    expect(posts[1][21]).toBe(2);
    expect(grid[3][8]).toBe(4);
    expect(grid[0].every((v) => v === 0)).toBe(true);
  });

  it('ignores posts without a valid timestamp', () => {
    const { posts } = postPerformanceGrid([post('not-a-date', 5)]);
    expect(posts.flat().reduce((a, b) => a + b, 0)).toBe(0);
  });
});
