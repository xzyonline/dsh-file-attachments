# DSH Generic File Attachments

This plugin adds session-bound generic file attachments to DSH Web. It recognizes content before trusting an extension, stores immutable content-addressed blobs, and exposes bounded reads through `attachment_info`, `read_attachment`, and `list_archive`.

Supported readers include text/config/source files, PDF, DOCX, XLSX, PPTX, ZIP/7z/RAR/EPUB directory entries, and safe single-entry extraction. Images stay on the native image path. Text output redacts values under keys such as `password`, `token`, `api_key`, `authorization`, `cookie`, and `private_key`; redaction is line-bounded and also covers multiline JSON objects and YAML block scalars.

Limits are 25 MB for ordinary files, 100 MB for archives, 10 files per message, 50 MB per message, 256 KiB and 2,000 lines per read, 10,000 archive entries, 15 seconds per parser, and 10 seconds per archive operation.

## Build and install

```sh
./scripts/build.sh
node ./scripts/install-local.mjs
```

The installer creates `~/.dsh/cordis.patch.yml.bak` once, appends one `dsh-file-attachments` row, and is idempotent. Set `DSH_HOME` for an isolated profile test. It never rewrites the existing prefix or prints existing configuration values.

## HTTP smoke test

With DSH Web running, execute:

```sh
node ./scripts/smoke.mjs http://127.0.0.1:3080
```

The smoke test uploads one disposable fixture, checks content-based type detection, verifies that a second session cannot read its metadata, and removes only the disposable draft. Pass a fixture path as the third argument, or set `DSH_SMOKE_FILE`; the script never prints fixture contents. Tool-level reads are intentionally reported as skipped because they require a real DSH session log containing the uploaded `<dsh-file ref="..."/>` marker; use the Web UI or a disposable DSH session for that final check.

## Upgrade and uninstall

After upgrading DSH, rebuild this plugin, run `pnpm typecheck`, `pnpm test`, `pnpm build`, filter `dsh --profile web --dump-config` for the one plugin row, then run the smoke script against Web. To uninstall, remove only the appended `dsh-file-attachments` row after comparing the backup, then remove the package from the Web profile. Keeping `~/.dsh/file-attachments` preserves historical reads; deleting that blob store permanently breaks them.


## 开源声明（Open Source Disclosure）

- **DSH 标签**：DeepSeek Harness（`dsh`）生态插件；`dsh.plugin.json` 声明贡献 `attachment_info` / `read_attachment` / `list_archive` 三个工具。
- **AI 辅助开发**：代码由人类与 AI 编程助手（DeepSeek Harness / OpenAI Codex）协作完成；安全关键路径（文件解析限额、会话鉴权、行级脱敏、解压炸弹防护）为人工设计并复核。测试 134 项，`pnpm audit` 0 已知漏洞。
- **第三方归因**：见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)（pdfjs-dist、SheetJS 安全补丁 fork、word-extractor、fflate、file-type、fast-xml-parser 等，MIT / Apache-2.0）。
- **许可证**：MIT，见 [LICENSE](./LICENSE)。
- **构建**：本仓库 `.gitignore` 排除 `lib/`，克隆后需 `npm install && npm run build` 生成产物。
- **安全报告**：见 [SECURITY.md](./SECURITY.md)。
