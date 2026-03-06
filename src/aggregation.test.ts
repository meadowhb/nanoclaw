import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';

import {
  merge,
  firstSuccess,
  summarize,
  type MemberResult,
} from './aggregation.js';

function mr(
  memberName: string,
  completedAt: number,
  status: 'success' | 'error',
  result: unknown,
): MemberResult {
  const base = {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    durationMs: 0,
    tokensUsed: { input: 0, output: 0 },
  };
  return {
    memberName,
    completedAt,
    response:
      status === 'success'
        ? { ...base, status: 'success', result }
        : { ...base, status: 'error', error: 'test error', result },
  };
}

describe('aggregation.merge', () => {
  it('later member overwrites earlier scalar at same key path', () => {
    const out = merge([
      mr('a', 1, 'success', { x: { y: 1 } }),
      mr('b', 2, 'success', { x: { y: 2 } }),
    ]);
    expect(out.result).toEqual({ x: { y: 2 } });
    expect(out.warnings).toEqual([]);
  });

  it('Array+Array concatenation at same key path', () => {
    const out = merge([
      mr('a', 1, 'success', { items: [1, 2] }),
      mr('b', 2, 'success', { items: [3] }),
    ]);
    expect(out.result).toEqual({ items: [1, 2, 3] });
    expect(out.warnings).toEqual([]);
  });

  it('type conflict emits merge_conflict warning with path and both values', () => {
    const out = merge([
      mr('a', 1, 'success', { x: { y: 1 } }),
      mr('b', 2, 'success', { x: 'oops' }),
    ]);
    expect(out.result).toEqual({ x: 'oops' });
    expect(out.warnings).toEqual([
      { type: 'merge_conflict', path: 'x', values: [{ y: 1 }, 'oops'] },
    ]);
  });

  it('non-object result triggers fallback wrapping with merge_fallback warning', () => {
    const out = merge([
      mr('a', 1, 'success', { x: 1 }),
      mr('b', 2, 'success', 'not-an-object'),
    ]);
    expect(out.result).toEqual({ a: { x: 1 }, b: 'not-an-object' });
    expect(out.warnings).toEqual([
      { type: 'merge_fallback', path: '', memberName: 'b' },
    ]);
  });

  it('mix of success and error members excludes error members from result', () => {
    const out = merge([
      mr('a', 1, 'success', { x: 1 }),
      mr('b', 2, 'error', { x: 999 }),
      mr('c', 3, 'success', { y: 2 }),
    ]);
    expect(out.result).toEqual({ x: 1, y: 2 });
    expect(out.warnings).toEqual([]);
  });

  it('all failed returns null result with no warnings', () => {
    const out = merge([
      mr('a', 1, 'error', { x: 1 }),
      mr('b', 2, 'error', { y: 2 }),
    ]);
    expect(out).toEqual({ result: null, warnings: [] });
  });

  it('empty array returns null result with no warnings', () => {
    expect(merge([])).toEqual({ result: null, warnings: [] });
  });
});

describe('aggregation.firstSuccess', () => {
  it('returns earliest completedAt success, not declaration order', () => {
    const out = firstSuccess([
      mr('late', 200, 'success', { ok: 2 }),
      mr('early', 100, 'success', { ok: 1 }),
    ]);
    expect(out.winnerName).toBe('early');
    expect(out.winner?.status).toBe('success');
    expect(out.winner?.result).toEqual({ ok: 1 });
    expect(out.others.map((x) => x.memberName)).toEqual(['late']);
  });

  it('all failed returns winner null and others includes all error responses ordered by completedAt', () => {
    const out = firstSuccess([
      mr('b', 200, 'error', 'b'),
      mr('a', 100, 'error', 'a'),
    ]);
    expect(out.winner).toBeNull();
    expect(out.winnerName).toBeNull();
    expect(out.others.map((x) => x.memberName)).toEqual(['a', 'b']);
  });

  it('empty array returns winner null and others empty', () => {
    expect(firstSuccess([])).toEqual({
      winner: null,
      winnerName: null,
      others: [],
    });
  });
});

describe('aggregation.summarize', () => {
  it('returns input unmodified (same array reference)', () => {
    const input = [mr('a', 1, 'success', { x: 1 })];
    const out = summarize(input);
    expect(out.results).toBe(input);
  });

  it('empty array returns results empty', () => {
    expect(summarize([])).toEqual({ results: [] });
  });
});
