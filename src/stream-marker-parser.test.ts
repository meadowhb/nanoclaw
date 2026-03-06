import { describe, it, expect } from 'vitest';

import { StreamMarkerParser } from './stream-marker-parser.js';

describe('StreamMarkerParser', () => {
  it('caps bufferedChars to the configured keep window', () => {
    const start = '---START---';
    const end = '---END---';
    const max = 128;
    const parser = new StreamMarkerParser(start, end, max);

    parser.append('x'.repeat(50_000));

    const expectedKeep = Math.max(64 * 1024, max + start.length + end.length);
    expect(parser.bufferedChars).toBeLessThanOrEqual(expectedKeep);
  });

  it('extracts payloads between markers across chunk boundaries', () => {
    const parser = new StreamMarkerParser('S', 'E', 1024);
    const payload = JSON.stringify({ ok: true });

    expect(parser.append('noise')).toEqual([]);
    expect(parser.append('S')).toEqual([]);
    expect(parser.append(payload.slice(0, 3))).toEqual([]);
    expect(parser.append(payload.slice(3) + 'E')).toEqual([payload]);
  });
});
