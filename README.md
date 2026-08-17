# dsh-chat-files — 文件直读

> 把文件拖进对话，AI 自动读懂。内部包名保持 `@dsh-external/dsh-file-attachments`（安装链契约，勿改）。

给 DeepSeek Harness 装上「文件直读」：把文件拖进对话、粘贴、或点按钮选择，AI 在下一步就会自动读到它。支持 PDF、Word、Excel、PPT、压缩包、纯文本等常见格式，中文 GBK 编码不乱码，文件里的密码和密钥会在送进模型前自动打码，压缩包炸弹会被拦截。

File attachments for DeepSeek Harness: drop, paste, or pick any file into the chat, and the agent reads it on its very next step. PDF, Office documents, archives, and plain text all work — with GB18030/GBK decoding, automatic secret redaction, and zip-bomb protection.

[![CI](https://github.com/xzyonline/dsh-chat-files/actions/workflows/ci.yml/badge.svg)](https://github.com/xzyonline/dsh-chat-files/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/xzyonline/dsh-chat-files)](https://github.com/xzyonline/dsh-chat-files/releases)

---

## Features

| Capability | Details |
|---|---|
| **Intake** | Drop a file **anywhere in the window**, paste it, or use the attach button. Raster images continue on DSH's native image path; everything else enters this plugin. A lightweight "release to attach" overlay replaces the official "images only" blocker toast. |
| **Auto-announcement** | The official wire carries no visible file marker, so a text-only model can silently ignore uploads. Right before the loop enters a step we append one `plugin`-source line announcing every unannounced file **with its detected type**, so the model knows to call `attachment_info` → `read_attachment` / `list_archive` and can combine the file content with the user's words. Injected through the official `agent/pre-step` waterfall (the only serial chain before request derivation — no race, no loss) and rendered by the official UI as an inject line, never a fake user bubble. |
| **Typed cards** | Composer cards show a distinct icon and colour per detected family (text / document / spreadsheet / presentation / archive / …). |
| **Delivery receipt** | A quiet line under the user's bubble reports real events: `Agent received → Agent reading… → Agent read`. The final stage appears only after the model actually calls the read tools; nothing is faked. |
| **Readers** | Text/config/source files, Markdown, **HTML/XML/SVG markup** (detected and read as text), PDF, DOCX, XLSX (sheet + A1-range reads), PPTX, legacy `.doc`/`.xls`, RTF, ODF, EPUB, and ZIP/7z/RAR/EPUB listing with safe single-entry extraction (CJK entry names fully supported). |
| **Model tools** | `attachment_info`, `read_attachment`, `list_archive` — bounded page/range/cursor/paragraph pagination, archives listed before extraction. |
| **Redaction** | Credential keys, private-key PEM blocks, and YAML block scalars are redacted line-wise before any byte reaches the model (`aws_secret_access_key`, `apiKey`, `set-cookie` included; `public_key`, `monkey` untouched). |

## Architecture

```
composer drop / paste / button (client)
   │  full-window takeover, generic files only — images stay native
   ▼
POST /api/dsh-file-attachments/v1/files   (Origin + session-existence verified, fail-closed)
   ▼
content-addressed store  (sha256 blob, atomic rename publish, immutable)
   ├─ detection (magic bytes + ZIP metadata, worker-isolated)
   ├─ refs + batch indexes (durable metadata, path-injection-validated)
   └─ read path: session ownership check → bounded worker parse → redaction
   ▼
model view:
   ├─ agent/pre-step announcement line (plugin source, type-tagged)
   └─ attachment_info / read_attachment / list_archive tools
```

## Install

### One-command install

```sh
# macOS / Linux (from the repository root)
node scripts/install.mjs
# or double-click: install.command        (Windows: install.bat)
```

The installer builds host + client bundles, symlinks the package into the **shared** profile directory (`$DSH_HOME/profiles/node_modules`, so *every* profile — web, CLI, headless — resolves it), and appends one row to `$DSH_HOME/cordis.patch.yml` (a backup is written first). It is idempotent: running it again is safe. Uninstall: `node scripts/install.mjs --uninstall` or `uninstall.bat` / `uninstall.command`.

Prebuilt bundle: download `dsh-file-attachments-<version>.zip` from [Releases](https://github.com/xzyonline/dsh-chat-files/releases), verify it against `SHA256SUMS.txt`, extract, and double-click the installer. No git, build step, or package manager required.

**Windows users**: see [docs/WINDOWS-INSTALL.zh.md](./docs/WINDOWS-INSTALL.zh.md) for the full walkthrough (prerequisites, `install.ps1`, manual steps, macOS comparison table, and FAQ). Requires [Node.js](https://nodejs.org/) ≥ 20, [PowerShell](https://learn.microsoft.com/powershell/) 5.1+, and for archives either the built-in `tar.exe` (Windows 10 1803+, [`bsdtar`](https://www.libarchive.org/)) or [Git for Windows](https://git-scm.com/download/win); dependencies via `npm` or [`pnpm`](https://pnpm.io/installation).

### Per-end deployment

| End | Steps | What you get |
|---|---|---|
| **Web (`dsh web`)** | run the installer → restart `dsh web` → hard-refresh (Cmd+Shift+R / Ctrl+Shift+R) | attach button, full-window drop, typed cards, delivery receipt, auto-announcement |
| **CLI / headless** | nothing further — the host half mounts through the shared profile | `attachment_info` / `read_attachment` / `list_archive` tools; attachments uploaded through the API (or by a Web session) are readable, and announcements fire on the same official events |

Configuration: the storage root defaults to `$DSH_HOME/file-attachments`; override with `config.root` on the plugin row in `cordis.patch.yml`.

## Safety model

- **Session ownership** — every read verifies `ownerSessionId` and that the session still exists (`sessionQuery.readSession`, fail-closed, 10 s TTL cache).
- **Origin** — uploads require a trusted `Origin` (exact match or loopback-equivalent `127.0.0.1`/`localhost`/`[::1]` on the same port); cross-site reads and deletes are rejected while origin-less local clients stay allowed.
- **Parsing isolation** — every parse runs in a worker thread under `maxOldGenerationSizeMb: 512` and a hard timeout that terminates hung parsers (`word-extractor`/`xlsx` cannot be aborted otherwise).
- **Archive safety** — paths are normalized and whitelisted; extraction writes to stdout only (no zip-slip surface); hostile entries are skipped during listing and rejected during extraction; decompressed output is capped at 256 MB.
- **Redaction** — line-wise credential/private-key redaction before the model (see Features).
- **Limits** — 25 MB per file (100 MB archives), 10 files / 50 MB per message, 256 KB / 2 000 lines per read, 15 s parser timeout, 10 s archive timeout.
- **Announcement degradation** — the pre-step listener never throws into the loop; any failure falls through unchanged, and a strengthened `systemPrompt` section (`order: 70`) remains as the fallback trigger.

## Official API conformance

Every seam this plugin uses is a public DeepSeek Harness contract — no monkey-patching, no core changes, harness upgrades unaffected:

| Used | Purpose | Official reference |
|---|---|---|
| `agent/pre-step` waterfall | append the announcement to the authoritative `enter` batch | [`docs/subsystems/core.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md) ("the only serial listener chain before request derivation") |
| `MessageSourceMap.plugin` | announcement source (`kind: 'plugin'`), rendered by the official UI as an inject line | `@deepseek-ai/dsh-llm` type declarations |
| `systemPrompt.section` | fallback trigger instructions | `@deepseek-ai/dsh-system-prompt` |
| `tools.register` / `defineTool` | the three model tools | `@deepseek-ai/dsh-tools` |
| `webServer.register` | HTTP upload/metadata/delete routes | `@deepseek-ai/dsh-host-webserver` |
| `sessionQuery.readSession` | session existence verification | `@deepseek-ai/dsh-session-query` |
| Content-addressed attachment design | storage philosophy (immutable sha256 objects) | `@deepseek-ai/dsh-attachment` |

## Compatibility

| | macOS | Windows | Linux |
|---|---|---|---|
| Symlink / junction | symlink | symlink, junction fallback | symlink |
| Archive reader | system `bsdtar` | built-in `tar.exe` (Windows 10+) | system `tar` |
| CI | ubuntu / macos / windows × Node 22 / 24 — build + typecheck + **168 tests** + installer smoke | | |

## Development

```sh
npm install
npm run build        # host + client bundles
npm run typecheck
npm test             # 168 tests (vitest)
node scripts/smoke.mjs http://127.0.0.1:3080 <file>   # live smoke against a running web
```

## Attribution and license

- **MIT** — see [LICENSE](./LICENSE).
- **Dependency attributions** — [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) (`@keep-lts/xlsx`, `cfb`, `fflate`, `file-type`, `pdfjs-dist`, `word-extractor`, `react`, build/test tooling).
- **Derived code** — the user-message renderer used by the delivery receipt is ported from DeepSeek Harness's own `dsh-client-ui-conversation` (MIT); the installer's junction-fallback strategy follows `@linxin666/dsh-client-ui-skin-center` (Apache-2.0). Both are credited in the respective source files and notices.
- **Design reference** — the content-addressed storage model follows the official `@deepseek-ai/dsh-attachment` package (see conformance table above).
