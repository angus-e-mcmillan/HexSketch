#!/bin/bash
# HexSketch for Claude Desktop (Mac): copies the server to ~/.hexsketch-mcp,
# adds it to Claude Desktop's config file and restarts Claude.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.hexsketch-mcp"
CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

# Claude starts the server itself and doesn't see Terminal's PATH, so record node's full path.
NODE="$(command -v node || true)"
for p in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -z "$NODE" ] && [ -x "$p" ]; then NODE="$p"; fi
done
if [ -z "$NODE" ]; then
  echo "HexSketch needs Node.js. The download page is opening: install the LTS version, then run this command again."
  open "https://nodejs.org/en/download"
  exit 1
fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node.js $MAJOR is too old (HexSketch needs 20 or later). The download page is opening: install the LTS version, then run this command again."
  open "https://nodejs.org/en/download"
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$HERE/server/." "$DEST/"
"$NODE" "$HERE/configure.mjs" "$CONFIG" "$NODE" "$DEST/dist/cli.js"

echo "Restarting Claude..."
osascript -e 'quit app "Claude"' >/dev/null 2>&1 || true
sleep 3
open -a Claude || echo "Open Claude again yourself."
echo
echo "Done. In Claude, start a new chat and ask: Open the HexSketch sketcher with ibuprofen"
