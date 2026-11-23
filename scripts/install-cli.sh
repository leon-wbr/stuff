#!/bin/sh
# Builds the `stuff` CLI and links it into ~/.local/bin. Needs Node 22.5 or newer (node:sqlite).
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
pnpm --dir "$root" --filter @stuff/cli build
chmod +x "$root/packages/cli/dist/stuff.mjs"
mkdir -p "$HOME/.local/bin"
ln -sf "$root/packages/cli/dist/stuff.mjs" "$HOME/.local/bin/stuff"
echo "Linked $HOME/.local/bin/stuff -> $root/packages/cli/dist/stuff.mjs"
