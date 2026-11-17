// Writes dist/Pigmento-<version>-SHA256SUMS.txt with the SHA-256 of the installer and the portable
// exe, to publish next to them so people can check their download (in PowerShell:
// Get-FileHash <file>). Run by `npm run dist` after electron-builder.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = [`Pigmento Setup ${version}.exe`, `Pigmento-${version}-portable.exe`];

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const lines = [];
for (const name of files) {
  const file = path.join(dist, name);
  if (!existsSync(file)) throw new Error(`${file} not found: run npm run dist`);
  lines.push(`${await sha256(file)}  ${name}`);
}
const out = path.join(dist, `Pigmento-${version}-SHA256SUMS.txt`);
writeFileSync(out, `${lines.join('\n')}\n`);
console.warn(`Wrote ${path.relative(root, out)}`);
