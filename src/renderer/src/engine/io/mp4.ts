/**
 * A minimal MP4 (ISO base media file) writer for one H.264 video track at a steady frame rate:
 * ftyp, then moov (so players can start before the end), then mdat with every frame. The frames
 * come from WebCodecs' VideoEncoder in "avc" form (length-prefixed NAL units) with its avcC
 * description. Nothing else (sound, edits, fragments) is written.
 */
export interface Mp4Sample {
  data: Uint8Array;
  key: boolean;
}

export interface Mp4Input {
  width: number;
  height: number;
  fps: number;
  /** The AVCDecoderConfigurationRecord (VideoEncoder's decoderConfig.description). */
  avcC: Uint8Array;
  samples: readonly Mp4Sample[];
}

/** Ticks per frame; the timescale is fps × this, so any whole frame rate is exact. */
const TICKS = 1000;

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  bytes(b: Uint8Array): this {
    this.chunks.push(b);
    this.length += b.length;
    return this;
  }

  u8(v: number): this {
    return this.bytes(Uint8Array.of(v & 0xff));
  }

  u16(v: number): this {
    return this.bytes(Uint8Array.of((v >>> 8) & 0xff, v & 0xff));
  }

  u32(v: number): this {
    return this.bytes(Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff));
  }

  zeros(n: number): this {
    return this.bytes(new Uint8Array(n));
  }

  str(s: string): this {
    return this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }

  out(): Uint8Array {
    const o = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      o.set(c, at);
      at += c.length;
    }
    return o;
  }
}

/** A box: 32-bit size, four-letter type, then its contents. */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const w = new Writer();
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  w.u32(size).str(type);
  for (const p of parts) w.bytes(p);
  return w.out();
}

/** A full box: a box whose contents start with a version byte and 24 bits of flags. */
function fullBox(type: string, version: number, flags: number, body: Uint8Array): Uint8Array {
  const w = new Writer().u8(version).u8(flags >>> 16).u8(flags >>> 8).u8(flags);
  return box(type, w.out(), body);
}

/** The identity transform every video track header carries. */
function matrix(w: Writer): Writer {
  return w.u32(0x00010000).u32(0).u32(0).u32(0).u32(0x00010000).u32(0).u32(0).u32(0).u32(0x40000000);
}

function moov(input: Mp4Input, mdatPayloadOffset: number): Uint8Array {
  const { width, height, fps, samples } = input;
  const timescale = fps * TICKS;
  const duration = samples.length * TICKS;
  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    matrix(new Writer().u32(0).u32(0).u32(timescale).u32(duration).u32(0x00010000).u16(0x0100).zeros(10))
      .zeros(24)
      .u32(2)
      .out(),
  );
  const tkhd = fullBox(
    'tkhd',
    0,
    0x000003,
    matrix(new Writer().u32(0).u32(0).u32(1).u32(0).u32(duration).zeros(8).u16(0).u16(0).u16(0).u16(0))
      .u32(width * 0x10000)
      .u32(height * 0x10000)
      .out(),
  );
  // Language "und" packed as three 5-bit letters.
  const mdhd = fullBox('mdhd', 0, 0, new Writer().u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4).u16(0).out());
  const hdlr = fullBox('hdlr', 0, 0, new Writer().u32(0).str('vide').zeros(12).str('VideoHandler').u8(0).out());
  const vmhd = fullBox('vmhd', 0, 1, new Writer().u16(0).zeros(6).out());
  const dinf = box('dinf', fullBox('dref', 0, 0, new Writer().u32(1).bytes(fullBox('url ', 0, 1, new Uint8Array(0))).out()));
  const avc1 = box(
    'avc1',
    new Writer()
      .zeros(6)
      .u16(1)
      .zeros(16)
      .u16(width)
      .u16(height)
      .u32(0x00480000)
      .u32(0x00480000)
      .u32(0)
      .u16(1)
      .zeros(32)
      .u16(0x0018)
      .u16(0xffff)
      .out(),
    box('avcC', input.avcC),
  );
  const stsd = fullBox('stsd', 0, 0, new Writer().u32(1).bytes(avc1).out());
  const stts = fullBox('stts', 0, 0, new Writer().u32(1).u32(samples.length).u32(TICKS).out());
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  const stssW = new Writer().u32(keys.length);
  for (const k of keys) stssW.u32(k);
  const stss = fullBox('stss', 0, 0, stssW.out());
  // Every sample in one chunk, right after the mdat header.
  const stsc = fullBox('stsc', 0, 0, new Writer().u32(1).u32(1).u32(samples.length).u32(1).out());
  const stszW = new Writer().u32(0).u32(samples.length);
  for (const s of samples) stszW.u32(s.data.length);
  const stsz = fullBox('stsz', 0, 0, stszW.out());
  const stco = fullBox('stco', 0, 0, new Writer().u32(1).u32(mdatPayloadOffset).out());
  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco);
  const minf = box('minf', vmhd, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  return box('moov', mvhd, trak);
}

export function muxMp4(input: Mp4Input): Uint8Array {
  if (!input.samples.length) throw new Error('No frames');
  const ftyp = box('ftyp', new Writer().str('isom').u32(512).str('isom').str('iso2').str('avc1').str('mp41').out());
  const payload = input.samples.reduce((n, s) => n + s.data.length, 0);
  if (payload + 8 > 0xffffffff) throw new Error('Video too large');
  // moov's size doesn't depend on the offset's value, so write it once to measure, then for real.
  const probe = moov(input, 0);
  const offset = ftyp.length + probe.length + 8;
  const head = moov(input, offset);
  const w = new Writer().bytes(ftyp).bytes(head).u32(payload + 8).str('mdat');
  for (const s of input.samples) w.bytes(s.data);
  return w.out();
}

/**
 * H.264 High profile at the lowest level that fits the frame (its macroblock count), or null
 * when the frame is too big for H.264 encoders (over level 5.1: 4096 × 2304).
 */
export function avcCodecFor(w: number, h: number): string | null {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  if (mbs <= 8192) return 'avc1.640028';
  if (mbs <= 22080) return 'avc1.640032';
  if (mbs <= 36864) return 'avc1.640033';
  return null;
}
