#!/bin/bash
# Installs the Gaze native messaging host manifest for Chrome.
# Run once after cloning: bash scripts/install-host.sh YOUR_EXTENSION_ID

set -e

EXTENSION_ID=$1
if [ -z "$EXTENSION_ID" ]; then
  echo "Usage: bash scripts/install-host.sh <extension-id>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PATH="$(cd "$SCRIPT_DIR/.." && pwd)/host/src/index.ts"
MANIFEST_SRC="$SCRIPT_DIR/com.gaze.host.json"

# Determine Chrome native messaging host directory
if [[ "$OSTYPE" == "darwin"* ]]; then
  HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  HOST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
else
  echo "Windows: manually place the manifest in %APPDATA%\\Google\\Chrome\\NativeMessagingHosts"
  exit 0
fi

mkdir -p "$HOST_DIR"

# Write manifest with correct path and extension ID
cat > "$HOST_DIR/com.gaze.host.json" << JSON
{
  "name": "com.gaze.host",
  "description": "Gaze native messaging host",
  "path": "$(which node) $HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
JSON

echo "Host manifest installed to $HOST_DIR/com.gaze.host.json"
echo "Extension ID: $EXTENSION_ID"
