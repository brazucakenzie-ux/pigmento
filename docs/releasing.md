# Releasing Pigmento

Releases are built on GitHub by [`.github/workflows/release.yml`](../.github/workflows/release.yml), so anyone can see how each installer was made. The workflow runs when a `v*` tag is pushed, or when you start it by hand (Actions → Release build → Run workflow). It installs the dependencies with `npm ci` on `windows-latest` with Node.js 26, runs the lint, type-check and unit tests, and builds three files:

- `Pigmento-Setup-<version>.exe`, the installer
- `Pigmento-<version>-portable.exe`, the portable version
- `Pigmento-<version>-SHA256SUMS.txt`, the SHA-256 of both

They're kept as one artifact on the run, called `Pigmento-<version>-signed` or `Pigmento-<version>-unsigned`. The workflow doesn't publish anything. You attach the files to a GitHub release yourself.

The end-to-end tests don't run on GitHub. The runners have no GPU and only 4 CPU cores, and the suite checks performance budgets measured on a PC with a GPU (brush latency, opening a 100-megapixel image, MP4 export time). MP4 export also needs Windows' H.264 encoder, which Windows Server may not have. So run `npm run check` on your PC before tagging.

## Cutting a release

1. Set the new version in `package.json` (for example `npm version 1.2.0 --no-git-tag-version`). In `CHANGELOG.md`, turn the Unreleased section into the new version with today's date. If a bundled package changed, run `npm run notices`.
2. Run `npm run check`. Everything must pass, including the end-to-end tests.
3. Optionally, run `npm run dist` and `npm run smoke:installed`. The smoke test installs the build for your account, tests it and uninstalls it. It stops if Pigmento is already installed.
4. Commit, then tag the commit and push both. The tag must match the version in `package.json`, or the workflow stops:

   ```powershell
   git tag v1.2.0
   git push origin main v1.2.0
   ```

5. On GitHub, open Actions → Release build and wait for the tag's run to finish. With signing on, the run waits twice for an approver to approve its signing request on SignPath. Download the run's artifact (a zip) and extract it.
6. Open Releases → Draft a new release, choose the tag, paste the version's CHANGELOG section, attach the three files and publish.
7. Download the installer from the release page and check it: `Get-FileHash .\Pigmento-Setup-1.2.0.exe` should match its line in the checksum file.

A run started by hand from a branch builds the same files without a tag, which is handy for trying the workflow out. Once signing is on, untick **Sign with SignPath** for such a run, so it doesn't ask for an approval (a signing policy limited to tags would refuse it anyway).

## Turning on code signing

Unsigned installers make Windows SmartScreen warn on first run. [SignPath Foundation](https://signpath.org) signs open-source projects for free, with a certificate in the Foundation's name, as long as the build comes from CI. The workflow is ready for this. It signs once the repository has a secret and three variables. Until then it builds unsigned, and each run says so in a notice.

Only the repository owner can do these steps: they involve creating accounts and handling a token.

1. **Check the conditions** in [SignPath Foundation's terms](https://signpath.org/terms). In short:
   - Every component has an OSI-approved licence. Pigmento is MIT, and its bundled packages are listed in `THIRD-PARTY-NOTICES.md`.
   - The software is already released in the form to be signed. The unsigned 1.1.0 counts.
   - Everyone on the team uses multi-factor authentication on GitHub and SignPath.
   - Every release is approved for signing by hand.
   - Only the project's own files are signed. Upstream binaries, such as Electron's DLLs and electron-builder's `elevate.exe`, may ship unsigned inside the signed package, but must not be signed with the project's certificate. The artifact configurations below sign only Pigmento's own files.
2. **Add a code signing policy** to the README (and link it from the release notes) before you apply, using the text in [Code signing policy text](#code-signing-policy-text) below. The application form asks for a download page that mentions SignPath Foundation, and the terms ask for the policy on the project's home and download pages.
3. **Apply** at [signpath.org/apply](https://signpath.org/apply). The form asks for the repository, homepage and download page, a one-line tagline, a short description, links showing the project is used ("reputation"), the build system (GitHub Actions), and your name and email, which become your SignPath account. You fill it in and send it yourself, behind a reCAPTCHA. Once the project is accepted, SignPath sets up an organisation and a project on [app.signpath.io](https://app.signpath.io), with GitHub.com as the trusted build system for this repository. Install the SignPath GitHub App if they ask you to.
4. **In SignPath**, add two artifact configurations to the project:
   - slug `app`, with the contents of [`.github/signpath/app.xml`](../.github/signpath/app.xml)
   - slug `installers`, with the contents of [`.github/signpath/installers.xml`](../.github/signpath/installers.xml)

   Both check that each file's product name is Pigmento and that its product version matches the release (Pigmento.exe gives four parts, such as `1.2.0.0`, and the installers give three). If SignPath rejects a file over its version, the signing request's page shows the value it found. Note the slug of the signing policy to use (for example `release-signing`). It's worth limiting that policy to builds of `v*` tags in its origin verification settings.
5. **Create an API token** in SignPath for a CI user that has the Submitter role on that signing policy.
6. **On GitHub**, open Settings → Secrets and variables → Actions:
   - Secret `SIGNPATH_API_TOKEN`: the API token.
   - Variable `SIGNPATH_ORGANIZATION_ID`: the organisation ID (it's in the SignPath URL and on the organisation's settings page).
   - Variable `SIGNPATH_PROJECT_SLUG`: the project's slug, for example `pigmento`.
   - Variable `SIGNPATH_SIGNING_POLICY_SLUG`: the signing policy's slug.
7. Push the next tag. The run pauses at **Sign the app and uninstaller**, then at **Sign the installers**, until an approver approves each request on SignPath (each one waits up to 2 hours). The artifact is then called `Pigmento-<version>-signed`.

Once signed releases are out, change the README's install section, which says the builds aren't signed.

### How the signed build works

The order matters, because signing a file must be the last change made to it:

1. `electron-builder --dir` packs the app: it writes `app.asar`, adds the asar's hash to `Pigmento.exe` (checked at start-up by the integrity fuse), flips the Electron fuses and sets the icon and version details. electron-builder flips the fuses just before it would sign, so nothing changes `Pigmento.exe` after that.
2. An installer is built only for its uninstaller. electron-builder builds the uninstaller part-way through building the installer and passes it to a sign hook. [`scripts/signing-hook.mjs`](../scripts/signing-hook.mjs) copies it out (`PIGMENTO_SIGNING=collect`), and that installer is deleted.
3. SignPath signs `Pigmento.exe` and the uninstaller together (configuration `app`).
4. The signed `Pigmento.exe` goes back into the app folder, and the installer and portable exe are built with `--prepackaged`, which packs and changes nothing in the app folder. When the uninstaller comes round again, the hook checks that it's byte for byte the one that was signed and swaps in the signed copy (`PIGMENTO_SIGNING=apply`). The uninstaller doesn't depend on the app's files, and NSIS builds it the same way each time, so this check holds.
5. SignPath signs the installer and the portable exe (configuration `installers`).
6. The workflow checks every signature with `Get-AuthenticodeSignature` and only then writes the checksums, so they're the checksums of the signed files.

## Code signing policy text

Add this to the README before you apply (step 2 above). Replace the team links with the real ones.

```markdown
## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- Committers and reviewers: [members](https://github.com/brazucakenzie-ux/pigmento/graphs/contributors)
- Approvers: [owners](https://github.com/brazucakenzie-ux)

Every release is built from this repository by GitHub Actions and approved by hand before it is signed.

Privacy: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.
```
