#!/bin/bash
# Double-click this file to start Kings Studio. Close the Terminal window to stop it.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get it from https://nodejs.org (the LTS version), then double-click this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing (takes a few seconds)..."
  npm install --silent || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }
fi

(sleep 1.5 && open "http://localhost:3737") &
node server.js
