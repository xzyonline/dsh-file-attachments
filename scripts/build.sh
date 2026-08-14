#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
pnpm install --ignore-scripts --frozen-lockfile --trust-lockfile --config.auto-install-peers=false
pnpm typecheck
pnpm test
pnpm build
