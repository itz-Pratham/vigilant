#!/bin/sh
# Railway start script — shell expands env vars before passing to node
set -e

: "${VIGILANT_REPO:?VIGILANT_REPO env var is required (e.g. owner/repo)}"
: "${VIGILANT_DOMAIN:=payments}"

exec node dist/bin.js start \
  -r "$VIGILANT_REPO" \
  --domain "$VIGILANT_DOMAIN" \
  --interval "${VIGILANT_INTERVAL:-120}"
