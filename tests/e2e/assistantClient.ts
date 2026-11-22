// An MCP client for the AI assistants e2e tests, connected the way any client connects:
// `Pigmento --mcp` over stdio, on the test's own profile.
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AppHandle } from './harness';

const electronExe = createRequire(__filename)('electron') as unknown as string;

export async function connectStdio(h: AppHandle, clients: Client[], name = 'e2e-client'): Promise<Client> {
  const transport = new StdioClientTransport({
    command: electronExe,
    args: ['.', '--mcp'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...(process.env as Record<string, string>), PIGMENTO_USER_DATA: h.userData },
    stderr: 'pipe',
  });
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

type Text = { type: string; text?: string };
export const firstText = (r: unknown) => ((r as { content?: Text[] }).content ?? []).find((c) => c.type === 'text')?.text ?? '';
export const imageOf = (r: unknown) => ((r as { content?: { type: string; data?: string; mimeType?: string }[] }).content ?? []).find((c) => c.type === 'image');

/** Change the AI assistants settings, as the Settings tab would. */
export const setAssistants = (h: AppHandle, change: Record<string, unknown>) =>
  h.page.evaluate(async (c) => {
    const s = await window.pigmento.settings.get();
    await window.pigmento.settings.set({ assistants: { ...s.assistants, ...c } });
  }, change);

export type Pixel = { r: number; g: number; b: number; a: number };

/** A PNG an assistant got, decoded in the page: its size and the pixels at some points. */
export const decode = (h: AppHandle, base64: string, points: { x: number; y: number }[]) =>
  h.page.evaluate(
    async ([b64, pts]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const at = (x: number, y: number) => (y * bmp.width + x) * 4;
      return { width: bmp.width, height: bmp.height, pixels: pts.map(({ x, y }) => ({ r: d[at(x, y)], g: d[at(x, y) + 1], b: d[at(x, y) + 2], a: d[at(x, y) + 3] })) };
    },
    [base64, points] as const,
  );

export const near = (a: Pixel, b: Pixel, tolerance = 2) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a)) <= tolerance;

/** A GIF decoded in the page: its size, frame count, each frame's delay (ms), and pixels at some frames. */
export const decodeGif = (h: AppHandle, base64: string, probes: { frame: number; x: number; y: number }[]) =>
  h.page.evaluate(
    async ({ b64, probes }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack!;
      await dec.completed;
      const first = (await dec.decode({ frameIndex: 0 })).image;
      const size = { width: first.displayWidth, height: first.displayHeight };
      first.close();
      const delays: number[] = [];
      for (let i = 0; i < track.frameCount; i++) delays.push(Math.round(((await dec.decode({ frameIndex: i })).image.duration ?? 0) / 1000));
      const pixels: { r: number; g: number; b: number; a: number }[] = [];
      for (const p of probes) {
        const { image } = await dec.decode({ frameIndex: p.frame });
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const d = ctx.getImageData(p.x, p.y, 1, 1).data;
        pixels.push({ r: d[0], g: d[1], b: d[2], a: d[3] });
        image.close();
      }
      return { ...size, frames: track.frameCount, delays, pixels };
    },
    { b64: base64, probes },
  );
