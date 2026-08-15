# dsh-file-attachments

Session-bound file attachments for the DeepSeek Harness Web GUI. Add files by drag-and-drop, paste, or the attach button; storage is content-addressed and immutable; reads are bounded, session-authorized, and run in isolated worker threads.

[![CI](https://github.com/xzyonline/dsh-file-attachments/actions/workflows/ci.yml/badge.svg)](https://github.com/xzyonline/dsh-file-attachments/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/xzyonline/dsh-file-attachments)](https://github.com/xzyonline/dsh-file-attachments/releases)

## Features

- **Intake** — drop a file onto the composer, paste it from the clipboard, or use the attach button. Images continue on the native image path.
- **Typed cards** — attachment cards show a distinct icon and colour per detected type (spreadsheet, PDF, archive, config, source code, …).
- **Delivery receipt** — a quiet line under the user's message bubble reports the file's state against real events: `Agent received` → `Agent reading…` → `Agent read`. The final stage appears only after the model actually calls the read tools for that file; nothing is faked.
- **Readers** — text/config/source files, PDF, DOCX, XLSX (shared strings, A1 ranges), PPTX, legacy .doc/.xls, RTF, ODF, EPUB, and ZIP/7z/RAR/EPUB directory listing with safe single-entry extraction.
- **Model tools** — `attachment_info`, `read_attachment`, `list_archive`, with offset/page/range/cursor pagination.

## Safety

- Session ownership is enforced on every read; HTTP endpoints validate Origin; session existence is verified (fail-closed).
- Parsing runs in worker threads under a memory cap and a hard timeout that terminates hung parsers.
- Archive paths are whitelisted and normalised; extraction writes to stdout only (no zip-slip surface); decompressed output is capped.
- Output is redacted line-wise for credential keys and private-key blocks before it reaches the model.
- Limits: 25 MB per file (100 MB archives), 10 files / 50 MB per message, 256 KB / 2 000 lines per read.

## Install

### Download the prebuilt bundle (recommended)

1. Get `dsh-file-attachments-0.1.0.zip` from [Releases](https://github.com/xzyonline/dsh-file-attachments/releases) and verify it against `SHA256SUMS.txt`.
2. Extract anywhere.
3. Double-click the installer for your OS:
   - Windows: `install.bat`
   - macOS / Linux: `install.command`
4. Restart the dsh web process, hard-refresh the browser, and confirm the attach button appears in the composer.

No git, build step, or package manager is required for the prebuilt bundle. Uninstall with `uninstall.bat` / `uninstall.command`.

### From source

Requires Node.js ≥ 20.

```sh
git clone https://github.com/xzyonline/dsh-file-attachments.git
cd dsh-file-attachments
npm install
node scripts/install.mjs
```

The installer builds the artifacts, links the package into the shared profile directory (`$DSH_HOME/profiles/node_modules`, so every profile resolves it), and appends one row to `$DSH_HOME/cordis.patch.yml` (backed up first). It is idempotent; running it again is safe. See [docs/DEPLOY.md](./docs/DEPLOY.md) for per-platform details and troubleshooting.

## Compatibility

| | macOS | Windows | Linux |
|---|---|---|---|
| Symlink / junction | symlink | symlink, junction fallback | symlink |
| Archive reader | system bsdtar | built-in `tar.exe` (Windows 10+) | system tar |
| CI | ubuntu / macos / windows × Node 22 / 24, build + typecheck + 147 tests + installer smoke | | |

## Development

```sh
npm install
npm run build        # host + client bundles
npm run typecheck
npm test             # 147 tests
node scripts/smoke.mjs http://127.0.0.1:3080   # live smoke test
```

## Attribution and license

- MIT. See [LICENSE](./LICENSE).
- Dependency attributions: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
- The user-message renderer ported for the receipt is derived from DeepSeek Harness's own `dsh-client-ui-conversation` package (MIT); the installer's junction-fallback strategy follows `@linxin666/dsh-client-ui-skin-center` (Apache-2.0). Both are credited in the respective source files and notices.
