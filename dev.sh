#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/web"

if [ ! -d node_modules ]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo "Starting Tauri dev (cwd: src-tauri, CLI from web)..."
npm run tauri:dev
