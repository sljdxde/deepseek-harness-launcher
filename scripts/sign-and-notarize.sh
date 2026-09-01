#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then echo "No CODESIGN_IDENTITY supplied; leaving build unsigned."; exit 0; fi
codesign --deep --force --options runtime --sign "$CODESIGN_IDENTITY" "$ROOT/build/Deepseek Harness Launcher.app"
if [[ -n "${APPLE_ID:-}" && -n "${TEAM_ID:-}" && -n "${APP_PASSWORD:-}" ]]; then xcrun notarytool submit "$ROOT/dist/Deepseek Harness Launcher.dmg" --apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PASSWORD" --wait; fi
