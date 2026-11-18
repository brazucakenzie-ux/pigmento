import type { Rect } from '../core/geometry';
import { TILE_SIZE, type Surface, type Tile } from '../raster/Surface';
import type { Homography } from '../raster/warp';
import type { Tiling } from '../anim/pieceSample';
import type { Placement } from '../anim/space';

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Biggest piece of the target drawn in one go (the WebGL canvas never grows past it). */
const CHUNK = 2048;

/** A sheet: its own box, drawn through its homography (perspective-correct, multisampled edges). */
const SHEET_VS = `#version 300 es
in vec2 aQ;
uniform mat3 uH;
uniform vec4 uView;
out vec2 vQ;
void main() {
  vec3 s = uH * vec3(aQ, 1.0);
  // Device pixels (s.xy / s.z) to clip space for the chunk at uView, kept projective by s.z.
  gl_Position = vec4(2.0 * (s.x - uView.x * s.z) / uView.z - s.z, s.z - 2.0 * (s.y - uView.y * s.z) / uView.w, 0.0, s.z);
  vQ = aQ;
}`;

const SHEET_FS = `#version 300 es
precision highp float;
in vec2 vQ;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uShade;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vQ / uSize);
  outColor = vec4(c.rgb * uShade, c.a);
}`;

/** A repeating plane: every pixel of the chunk finds its piece point through the inverse homography. */
const PLANE_VS = `#version 300 es
in vec2 aQ;
void main() {
  gl_Position = vec4(aQ, 0.0, 1.0);
}`;

const PLANE_FS = `#version 300 es
precision highp float;
uniform mat3 uInv;
uniform vec4 uView;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uScroll;
uniform vec2 uWrap;
uniform float uShade;
out vec4 outColor;
void main() {
  // Device pixel (top-left origin) of this fragment.
  vec2 d = vec2(uView.x + gl_FragCoord.x, uView.y + uView.w - gl_FragCoord.y);
  vec3 q = uInv * vec3(d, 1.0);
  if (q.z <= 0.0) discard;
  vec2 p = q.xy / q.z;
  // Along an axis it doesn't repeat on, the strip ends at the piece's edges (smoothed over a pixel).
  float cover = 1.0;
  for (int i = 0; i < 2; i++) {
    if (uWrap[i] < 0.5) {
      float edge = min(p[i], uSize[i] - p[i]) / max(fwidth(p[i]), 1e-6);
      cover *= clamp(edge + 0.5, 0.0, 1.0);
    }
  }
  if (cover <= 0.0) discard;
  vec4 c = texture(uTex, (p - uScroll) / uSize) * cover;
  outColor = vec4(c.rgb * uShade, c.a);
}`;

interface Program {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

interface Texture {
  tex: WebGLTexture;
  tiles: (Tile | null)[];
  wrap: boolean;
}

/** Row-major homography → GLSL column-major mat3. */
function glMat3(h: Homography): Float32Array {
  return new Float32Array([h[0], h[3], h[6], h[1], h[4], h[7], h[2], h[5], h[8]]);
}

/** a ∘ b for row-major homographies (b first). */
function compose(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out as unknown as Homography;
}

/** Scale a homography so its largest entry is about 1 (keeps float32 in the shader precise). */
function normalised(h: Homography): Homography {
  const k = Math.max(...h.map(Math.abs)) || 1;
  return h.map((v) => v / k) as unknown as Homography;
}

/**
 * Pieces tilted in 3D, drawn on the GPU with WebGL2 (Canvas 2D can't draw a true perspective
 * image). A piece's pixels become a texture with mip levels and, where the GPU has it,
 * anisotropic filtering, so a sheet tilted far back stays sharp without shimmering; edges get 4×
 * multisampling. Each piece is drawn into the 2D target in device pixels, a chunk at a time.
 * If WebGL2 is missing or the GPU resets, `draw` says no and the caller uses the CPU path.
 */
export class PlaneRenderer {
  private canvas: OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private sheet: Program | null = null;
  private plane: Program | null = null;
  private quad: WebGLBuffer | null = null;
  private screenQuad: WebGLBuffer | null = null;
  private textures = new Map<Surface, Texture>();
  private lost = false;
  private failed = false;
  private aniso = 0;
  private maxTexture = 0;
  private zeros = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
  private scratch = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);

  /** True once WebGL2 has worked here (for tests and the performance overlay). */
  get ready(): boolean {
    return this.init() !== null;
  }

  private init(): WebGL2RenderingContext | null {
    if (this.gl && !this.lost) return this.gl;
    if (this.failed || this.lost || typeof OffscreenCanvas === 'undefined') return null;
    try {
      const canvas = new OffscreenCanvas(256, 256);
      const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true, depth: false, stencil: false, preserveDrawingBuffer: false });
      if (!gl) {
        this.failed = true;
        return null;
      }
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.lost = true;
        this.textures.clear();
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.lost = false;
        this.gl = null;
      });
      this.canvas = canvas;
      this.gl = gl;
      this.sheet = this.program(gl, SHEET_VS, SHEET_FS, ['uH', 'uView', 'uTex', 'uSize', 'uShade']);
      this.plane = this.program(gl, PLANE_VS, PLANE_FS, ['uInv', 'uView', 'uTex', 'uSize', 'uScroll', 'uWrap', 'uShade']);
      this.quad = gl.createBuffer();
      this.screenQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      this.aniso = ext ? Math.min(16, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
      this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return gl;
    } catch {
      this.failed = true;
      return null;
    }
  }

  private program(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'aQ');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog) ?? 'program');
    return { prog, loc: Object.fromEntries(uniforms.map((u) => [u, gl.getUniformLocation(prog, u)])) };
  }

  /** The piece's texture, brought up to date tile by tile (premultiplied, then mip levels on the GPU). */
  private texture(gl: WebGL2RenderingContext, src: Surface, wrap: boolean): WebGLTexture | null {
    let t = this.textures.get(src);
    if (t && t.wrap !== wrap) {
      gl.deleteTexture(t.tex);
      this.textures.delete(src);
      t = undefined;
    }
    if (!t) {
      const tex = gl.createTexture();
      if (!tex) return null;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const levels = Math.floor(Math.log2(Math.max(src.width, src.height))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, src.width, src.height);
      const mode = wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (this.aniso > 1) gl.texParameterf(gl.TEXTURE_2D, 0x84fe /* TEXTURE_MAX_ANISOTROPY_EXT */, this.aniso);
      t = { tex, tiles: src.tiles.map(() => undefined as unknown as Tile | null), wrap };
      this.textures.set(src, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    let changed = false;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, TILE_SIZE);
    for (let i = 0; i < src.tiles.length; i++) {
      const tile = src.tiles[i];
      if (t.tiles[i] === tile && t.tiles[i] !== undefined) continue;
      const r = src.tileRect(i);
      let data = this.zeros;
      if (tile) {
        // Premultiply on the way up, so smoothing and mip levels mix colours by their coverage.
        const s = this.scratch;
        for (let p = 0; p < tile.length; p += 4) {
          const a = tile[p + 3];
          s[p] = (tile[p] * a + 127) / 255;
          s[p + 1] = (tile[p + 1] * a + 127) / 255;
          s[p + 2] = (tile[p + 2] * a + 127) / 255;
          s[p + 3] = a;
        }
        data = s;
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      t.tiles[i] = tile;
      changed = true;
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    if (changed) gl.generateMipmap(gl.TEXTURE_2D);
    return t.tex;
  }

  /** A stroke is under way on `src` inside r (its tiles keep their arrays): upload those tiles again next time. */
  touch(src: Surface, r: Rect): void {
    const t = this.textures.get(src);
    if (!t) return;
    const tx0 = Math.max(0, Math.floor(r.x / TILE_SIZE));
    const ty0 = Math.max(0, Math.floor(r.y / TILE_SIZE));
    const tx1 = Math.min(src.cols - 1, Math.floor((r.x + r.w - 1) / TILE_SIZE));
    const ty1 = Math.min(src.rows - 1, Math.floor((r.y + r.h - 1) / TILE_SIZE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) t.tiles[ty * src.cols + tx] = undefined as unknown as Tile | null;
  }

  /** Let go of the textures of pieces that are gone. */
  retain(live: ReadonlySet<Surface>): void {
    for (const [s, t] of this.textures) {
      if (live.has(s)) continue;
      this.gl?.deleteTexture(t.tex);
      this.textures.delete(s);
    }
  }

  /**
   * Draw `src` through placement `pl` (piece pixels → document pixels) into the target inside
   * `area` (document pixels), with the target's own transform, clip and alpha. False when the GPU
   * can't (no WebGL2, a reset, a piece too big for a texture): then nothing was drawn.
   */
  draw(target: Ctx2D, src: Surface, pl: Placement, tiling: Tiling | null, area: Rect, shade = 1): boolean {
    const gl = this.init();
    if (!gl || !this.canvas || !this.sheet || !this.plane || gl.isContextLost()) return false;
    if (src.width > this.maxTexture || src.height > this.maxTexture) return false;
    const m = target.getTransform();
    // Document → device pixels, then the piece's homography on top.
    const toDevice: Homography = [m.a, m.c, m.e, m.b, m.d, m.f, 0, 0, 1];
    const h = compose(toDevice, pl.h);
    const corners = [
      [area.x, area.y],
      [area.x + area.w, area.y],
      [area.x, area.y + area.h],
      [area.x + area.w, area.y + area.h],
    ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
    const tw = target.canvas.width;
    const th = target.canvas.height;
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
    const x1 = Math.min(tw, Math.ceil(Math.max(...corners.map((p) => p.x))));
    const y1 = Math.min(th, Math.ceil(Math.max(...corners.map((p) => p.y))));
    if (x1 <= x0 || y1 <= y0) return true;
    const tex = this.texture(gl, src, tiling !== null);
    if (!tex) return false;
    const inv = tiling ? invert(h) : null;
    if (tiling && !inv) return true;
    const cw = Math.min(CHUNK, x1 - x0);
    const ch = Math.min(CHUNK, y1 - y0);
    if (this.canvas.width < cw || this.canvas.height < ch) {
      this.canvas.width = Math.max(this.canvas.width, cw);
      this.canvas.height = Math.max(this.canvas.height, ch);
    }
    const H = this.canvas.height;
    for (let cy = y0; cy < y1; cy += CHUNK) {
      for (let cx = x0; cx < x1; cx += CHUNK) {
        const w = Math.min(CHUNK, x1 - cx);
        const hh = Math.min(CHUNK, y1 - cy);
        // The chunk sits at the top-left of the canvas (GL's origin is bottom-left).
        gl.viewport(0, H - hh, w, hh);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, H - hh, w, hh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (tiling && inv) this.drawPlane(gl, normalised(inv), { x: cx, y: cy, w, h: hh }, src, tiling, shade);
        else this.drawSheet(gl, normalised(h), { x: cx, y: cy, w, h: hh }, src, shade);
        gl.disable(gl.SCISSOR_TEST);
        target.save();
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.drawImage(this.canvas, 0, 0, w, hh, cx, cy, w, hh);
        target.restore();
      }
    }
    return true;
  }

  private drawSheet(gl: WebGL2RenderingContext, h: Homography, view: Rect, src: Surface, shade: number): void {
    const p = this.sheet!;
    gl.useProgram(p.prog);
    gl.uniform1f(p.loc.uShade, shade);
    gl.uniformMatrix3fv(p.loc.uH, false, glMat3(h));
    gl.uniform4f(p.loc.uView, view.x, view.y, view.w, view.h);
    gl.uniform1i(p.loc.uTex, 0);
    gl.uniform2f(p.loc.uSize, src.width, src.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, src.width, 0, 0, src.height, src.width, src.height]), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawPlane(gl: WebGL2RenderingContext, inv: Homography, view: Rect, src: Surface, tiling: Tiling, shade: number): void {
    const p = this.plane!;
    gl.useProgram(p.prog);
    gl.uniform1f(p.loc.uShade, shade);
    gl.uniformMatrix3fv(p.loc.uInv, false, glMat3(inv));
    // gl_FragCoord counts up from the canvas's bottom and the chunk is its top-left w × h, so a
    // fragment's device y is the chunk's top plus (canvas height − gl_FragCoord.y).
    gl.uniform4f(p.loc.uView, view.x, view.y, view.w, this.canvas!.height);
    gl.uniform1i(p.loc.uTex, 0);
    gl.uniform2f(p.loc.uSize, src.width, src.height);
    gl.uniform2f(p.loc.uScroll, tiling.x ? tiling.scrollX : 0, tiling.y ? tiling.scrollY : 0);
    gl.uniform2f(p.loc.uWrap, tiling.x ? 1 : 0, tiling.y ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function invert(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const k = 1 / det;
  // The sign is kept (k may be negative): which side is in front depends on it, as for the CPU.
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
