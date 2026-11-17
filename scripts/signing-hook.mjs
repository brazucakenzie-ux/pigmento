// electron-builder's custom sign hook for the release workflow's signed build. Only
// .github/workflows/release.yml uses it (with --config.win.signtoolOptions.sign); `npm run dist`
// never does. SignPath signs files in workflow steps of their own, between electron-builder runs, so
// this hook doesn't sign anything itself. It only deals with the NSIS uninstaller, which
// electron-builder builds and signs half-way through building the installer:
//   PIGMENTO_SIGNING=collect  copies the new uninstaller to dist/signing/unsigned/uninstaller.exe
//   PIGMENTO_SIGNING=apply    puts dist/signing/signed/uninstaller.exe in its place, once it has
//                             checked that the new uninstaller is byte for byte the one that was signed
// Every other file (the installer and the portable exe, which are signed afterwards) is left alone.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const signing = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'signing');
const unsigned = path.join(signing, 'unsigned', 'uninstaller.exe');
const signed = path.join(signing, 'signed', 'uninstaller.exe');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** @param {{ path: string }} configuration */
export default async function sign(configuration) {
  const file = configuration.path;
  // electron-builder writes the uninstaller as dist/<installer name>__uninstaller.exe.
  if (!path.basename(file).endsWith('__uninstaller.exe')) return;
  const stage = process.env.PIGMENTO_SIGNING;
  if (stage === 'collect') {
    mkdirSync(path.dirname(unsigned), { recursive: true });
    copyFileSync(file, unsigned);
    console.warn(`Collected the uninstaller for signing: ${unsigned}`);
  } else if (stage === 'apply') {
    if (!existsSync(signed) || !existsSync(unsigned)) {
      throw new Error(`${signed} or ${unsigned} is missing: collect and sign the uninstaller first`);
    }
    const built = sha256(file);
    // electron-builder calls the hook once per hash algorithm, so it may already be in place.
    if (built === sha256(signed)) return;
    if (built !== sha256(unsigned)) {
      throw new Error('The uninstaller built now differs from the one that was signed');
    }
    copyFileSync(signed, file);
    console.warn(`Put the signed uninstaller in place: ${file}`);
  } else {
    throw new Error(`PIGMENTO_SIGNING must be "collect" or "apply", not ${JSON.stringify(stage)}`);
  }
}
