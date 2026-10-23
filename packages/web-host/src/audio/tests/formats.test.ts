import { describe, expect, it } from 'vitest';
import { formatTranscript, mergeSegments, normalizeSegments } from '../formats.js';

describe('audio subtitle formatting', () => {
  it('repairs negative, overlapping and out-of-range coarse timings', () => {
    expect(
      normalizeSegments(
        [
          { text: '最後一句。', startSecond: 16, endSecond: 20.8 },
          { text: '各位同學。', startSecond: -1, endSecond: 2 },
          { text: '請留意。', startSecond: 1, endSecond: 3 },
          { text: '', startSecond: 4, endSecond: 5 },
          { text: 'invalid', startSecond: 21, endSecond: 22 },
        ],
        19.8
      )
    ).toEqual([
      { text: '各位同學。', startSecond: 0, endSecond: 2 },
      { text: '請留意。', startSecond: 2, endSecond: 3 },
      { text: '最後一句。', startSecond: 16, endSecond: 19.8 },
    ]);
  });
  it('serializes all four formats without rewriting Cantonese', () => {
    const segments = [{ text: '記得帶水同雨褸。', startSecond: 3600.2, endSecond: 3602.3 }];
    expect(formatTranscript('srt', segments)).toBe('1\n01:00:00,200 --> 01:00:02,300\n記得帶水同雨褸。\n');
    expect(formatTranscript('vtt', segments)).toContain('WEBVTT\n\n01:00:00.200 --> 01:00:02.300');
    expect(formatTranscript('txt', segments)).toBe('記得帶水同雨褸。\n');
    expect(JSON.parse(formatTranscript('json', segments))).toEqual({ text: '記得帶水同雨褸。', segments });
  });
  it('deduplicates overlapping chunks but keeps intentional later repetitions', () => {
    const merged = mergeSegments(
      [
        { start: 0, segments: [{ text: '記得帶水。', startSecond: 298, endSecond: 301 }] },
        {
          start: 300,
          segments: [
            { text: '帶水。', startSecond: 0, endSecond: 1 },
            { text: '然後出發。', startSecond: 1, endSecond: 3 },
            { text: '記得帶水。', startSecond: 20, endSecond: 22 },
          ],
        },
      ],
      600
    );
    expect(merged.map((segment) => segment.text)).toEqual(['記得帶水。', '然後出發。', '記得帶水。']);
    expect(merged[1].startSecond).toBe(301);
  });
});
