import { describe, expect, it } from 'vitest';
import { exportSize, frameDelays, frameSequence } from '@engine/anim/exportFrames';
import { avcCodecFor, muxMp4 } from '@engine/io/mp4';

describe('which frames an export plays', () => {
  it('plays straight through, or there and back without repeating the ends', () => {
    expect(frameSequence(0, 4, 'loop')).toEqual([0, 1, 2, 3, 4]);
    expect(frameSequence(0, 4, 'once')).toEqual([0, 1, 2, 3, 4]);
    expect(frameSequence(0, 4, 'pingpong')).toEqual([0, 1, 2, 3, 4, 3, 2, 1]);
    expect(frameSequence(2, 3, 'pingpong')).toEqual([2, 3]);
    expect(frameSequence(5, 5, 'pingpong')).toEqual([5]);
    // A range given backwards is the same range.
    expect(frameSequence(3, 1, 'loop')).toEqual([1, 2, 3]);
  });

  it('spreads time so the total is right', () => {
    const d = frameDelays(12, 12);
    expect(d.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(new Set(d)).toEqual(new Set([83, 84]));
    // In GIF's hundredths of a second: 24 fps is 40 or 50 ms, two frames make 80 ms + …
    const g = frameDelays(24, 24, 10);
    expect(g.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(g.every((x) => x % 10 === 0)).toBe(true);
  });

  it('works out the size at a scale', () => {
    expect(exportSize(1280, 800, 0.5)).toEqual({ w: 640, h: 400 });
    expect(exportSize(3, 3, 0.1)).toEqual({ w: 1, h: 1 });
  });
});

/** Read the boxes of an MP4: [type, offset, size] at one level. */
function boxes(b: Uint8Array, start = 0, end = b.length): { type: string; at: number; size: number }[] {
  const out: { type: string; at: number; size: number }[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = start; at < end; ) {
    const size = dv.getUint32(at);
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    out.push({ type, at, size });
    expect(size).toBeGreaterThanOrEqual(8);
    at += size;
  }
  return out;
}

function child(b: Uint8Array, parent: { at: number; size: number }, path: string[], header = 8): { type: string; at: number; size: number } {
  const kids = boxes(b, parent.at + header, parent.at + parent.size);
  const k = kids.find((x) => x.type === path[0]);
  if (!k) throw new Error(`no ${path[0]}`);
  return path.length === 1 ? k : child(b, k, path.slice(1));
}

describe('MP4 writer', () => {
  const avcC = Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0);
  const samples = [
    { data: Uint8Array.of(0, 0, 0, 3, 1, 2, 3), key: true },
    { data: Uint8Array.of(0, 0, 0, 1, 9), key: false },
    { data: Uint8Array.of(0, 0, 0, 2, 7, 7), key: false },
  ];
  const mp4 = muxMp4({ width: 640, height: 360, fps: 12, avcC, samples });
  const dv = new DataView(mp4.buffer);

  it('lays out ftyp, moov (first, so it plays straight away) and mdat', () => {
    const top = boxes(mp4);
    expect(top.map((x) => x.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(top.reduce((n, x) => n + x.size, 0)).toBe(mp4.length);
  });

  it('points the chunk offset at the first frame and lists every frame’s size', () => {
    const [, moov, mdat] = boxes(mp4);
    const stbl = child(mp4, moov, ['trak', 'mdia', 'minf', 'stbl']);
    const stco = child(mp4, stbl, ['stco']);
    expect(dv.getUint32(stco.at + 16)).toBe(mdat.at + 8);
    expect(Array.from(mp4.subarray(mdat.at + 8, mdat.at + 15))).toEqual([0, 0, 0, 3, 1, 2, 3]);
    const stsz = child(mp4, stbl, ['stsz']);
    expect(dv.getUint32(stsz.at + 16)).toBe(3);
    expect([0, 1, 2].map((i) => dv.getUint32(stsz.at + 20 + i * 4))).toEqual([7, 5, 6]);
    // Only the first frame is a keyframe.
    const stss = child(mp4, stbl, ['stss']);
    expect(dv.getUint32(stss.at + 12)).toBe(1);
    expect(dv.getUint32(stss.at + 16)).toBe(1);
  });

  it('times the frames from the frame rate and carries the size and avcC', () => {
    const [, moov] = boxes(mp4);
    const mdhd = child(mp4, moov, ['trak', 'mdia', 'mdhd']);
    expect(dv.getUint32(mdhd.at + 20)).toBe(12000);
    expect(dv.getUint32(mdhd.at + 24)).toBe(3000);
    const tkhd = child(mp4, moov, ['trak', 'tkhd']);
    expect(dv.getUint32(tkhd.at + 84) / 65536).toBe(640);
    expect(dv.getUint32(tkhd.at + 88) / 65536).toBe(360);
    const stsd = child(mp4, moov, ['trak', 'mdia', 'minf', 'stbl', 'stsd']);
    const avc1 = { at: stsd.at + 16, size: dv.getUint32(stsd.at + 16) };
    expect(String.fromCharCode(...mp4.subarray(avc1.at + 4, avc1.at + 8))).toBe('avc1');
    const box = child(mp4, avc1, ['avcC'], 86);
    expect(Array.from(mp4.subarray(box.at + 8, box.at + box.size))).toEqual(Array.from(avcC));
  });

  it('picks an H.264 level by size, up to 4096 × 2304', () => {
    expect(avcCodecFor(1920, 1080)).toBe('avc1.640028');
    expect(avcCodecFor(2560, 1440)).toBe('avc1.640032');
    expect(avcCodecFor(4096, 2304)).toBe('avc1.640033');
    expect(avcCodecFor(5000, 3000)).toBeNull();
    expect(() => muxMp4({ width: 2, height: 2, fps: 1, avcC, samples: [] })).toThrow();
  });
});
