#!/bin/sh
# Signs with "Stuff Local Dev" when it exists, so the keychain keeps trusting rebuilds.
set -eu

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ] && security find-identity -v -p codesigning 2>/dev/null | grep -q '"Stuff Local Dev"'; then
  export APPLE_SIGNING_IDENTITY="Stuff Local Dev"
fi

exec pnpm --filter @stuff/desktop tauri build "$@"
