#!/usr/bin/env bash
# Builds pado-<commit>.zip from the committed source (no node_modules, .env or uploads).
# Upload it to the server, unzip, then follow deploy/vps/README.md.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
OUT="${1:-pado-$(git rev-parse --short HEAD).zip}"
git archive --format=zip --prefix=pado/ -o "$OUT" HEAD
echo "$OUT ($(du -h "$OUT" | cut -f1))"
