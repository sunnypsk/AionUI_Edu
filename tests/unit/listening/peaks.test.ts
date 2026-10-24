import { describe, expect, it } from 'vitest';
import { parsePeaks } from '@/renderer/pages/listening/timeline/peaks';
import { listeningApi } from '@/renderer/pages/listening/data/api';

const buffer = (magic: string, pairs: number[]) => {
  const bytes = new Uint8Array(16 + pairs.length);
  const view = new DataView(bytes.buffer);
  [...magic].forEach((char, index) => view.setUint8(index, char.charCodeAt(0)));
  view.setUint32(4, 10, true);
  view.setUint32(8, pairs.length / 2, true);
  pairs.forEach((value, index) => view.setInt8(16 + index, value));
  return bytes.buffer;
};

describe('waveform peaks', () => {
  it('reads bucket size and min/max pairs', () => {
    const peaks = parsePeaks(buffer('LPK1', [-5, 7, -128, 127, 0, 0]));
    expect(peaks.bucketMs).toBe(10);
    expect([...peaks.min]).toEqual([-5, -128, 0]);
    expect([...peaks.max]).toEqual([7, 127, 0]);
  });

  it('rejects data that is not a peaks file', () => {
    expect(() => parsePeaks(buffer('NOPE', [0, 0]))).toThrow();
    expect(() => parsePeaks(new ArrayBuffer(4))).toThrow();
  });

  it('builds preview URLs for the project and source', () => {
    const target = { conversation_id: 'c1', path: 'listening/unit.listening.json' };
    expect(listeningApi.peaksUrl(target, 'audio/a b.mp3')).toMatch(
      /\/api\/edu\/audio\/listening\/peaks\?conversation_id=c1&path=listening%2Funit\.listening\.json&source=audio%2Fa\+b\.mp3$/
    );
    expect(listeningApi.rangeUrl(target, 'a.mp3', 1.5, 3)).toContain('&source=a.mp3&start=1.5&end=3');
  });
});
