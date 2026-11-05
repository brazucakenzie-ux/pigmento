// Rasterises resources/logo.svg into the PNG/ICO files used by the window, taskbar and installer.
// Run with `npm run icons` after changing the logo.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'resources', 'logo.svg'), 'utf8');

function render(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function buildIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

mkdirSync(path.join(root, 'build'), { recursive: true });
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, png: render(size) }));
writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco(images));
writeFileSync(path.join(root, 'build', 'icon.png'), render(512));
writeFileSync(path.join(root, 'resources', 'icon.png'), render(256));
console.warn(`Wrote build/icon.ico (${sizes.join(', ')}), build/icon.png, resources/icon.png`);
