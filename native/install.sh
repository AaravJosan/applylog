#!/bin/bash
# Registers the ApplyLog drafting helper with Chrome (macOS).
#
#   ./native/install.sh                 # uses the extension folder next to this script
#   ./native/install.sh <extension-id>  # if chrome://extensions shows a different ID
#
# Re-run it after updating ApplyLog, if you move the folder, or if node or claude move.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
NAME="com.applylog.claude"

NODE="$(command -v node || true)"
CLAUDE="$(command -v claude || true)"
[ -n "$NODE" ] || { echo "Can't find node. Install Node.js (https://nodejs.org) and run this again."; exit 1; }
[ -n "$CLAUDE" ] || { echo "Can't find the claude CLI. Install Claude Code (https://claude.com/claude-code) and run this again."; exit 1; }

# An unpacked extension's ID is derived from its folder path
id_for() {
  printf '%s' "$1" | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p'
}
if [ $# -ge 1 ]; then
  IDS=("$1")
else
  IDS=("$(id_for "$ROOT/extension")" "$(id_for "$ROOT")")
fi
ORIGINS=""
for id in "${IDS[@]}"; do ORIGINS="$ORIGINS\"chrome-extension://$id/\", "; done
ORIGINS="${ORIGINS%, }"

# Install outside Downloads/Documents so macOS privacy prompts never block Chrome from starting it
DEST="$HOME/Library/Application Support/ApplyLog"
mkdir -p "$DEST"
cp "$HERE/host.js" "$DEST/host.js"

# Chrome starts the helper with a bare PATH, so pin absolute paths in a launcher
LAUNCHER="$DEST/applylog-host"
cat > "$LAUNCHER" <<EOF
#!/bin/bash
export PATH="$(dirname "$CLAUDE"):$(dirname "$NODE"):/usr/bin:/bin"
export APPLYLOG_CLAUDE="$CLAUDE"
exec "$NODE" "$DEST/host.js" "\$@"
EOF
chmod +x "$LAUNCHER"

for dir in "$HOME/Library/Application Support/Google/Chrome" \
           "$HOME/Library/Application Support/Google/Chrome Beta" \
           "$HOME/Library/Application Support/Chromium" \
           "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"; do
  [ -d "$dir" ] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  cat > "$dir/NativeMessagingHosts/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "ApplyLog: drafts application answers with your Claude subscription",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": [$ORIGINS]
}
EOF
  echo "Registered with ${dir##*/}"
done

echo "Allowed extension ID(s): ${IDS[*]}"
echo "If chrome://extensions shows a different ID for ApplyLog, run: $0 <that-id>"
if "$CLAUDE" auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  echo "claude CLI is logged in. You're set."
else
  echo "Next: run 'claude' in Terminal and log in with your Claude account."
fi
