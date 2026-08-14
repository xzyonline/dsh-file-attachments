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
