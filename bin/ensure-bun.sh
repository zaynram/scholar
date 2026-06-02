#!/bin/sh
# bin/ensure-bun.sh — slim-plugin runtime provisioner (Linux/macOS dev + parity).
#
# Idempotently provisions the PINNED bun runtime into ${CLAUDE_PLUGIN_DATA}/bun.
# ${CLAUDE_PLUGIN_DATA} persists across plugin updates (unlike CLAUDE_PLUGIN_ROOT,
# which is replaced each version), so bun is downloaded at most once per machine.
#
# Called synchronously by launch.sh BEFORE it execs the server — this is the
# correctness guarantee that bun exists before the MCP server needs it (Claude
# Code's SessionStart hooks do NOT block MCP spawn, so provisioning cannot live
# there alone). May also be pre-warmed by a SessionStart hook; the flock below
# serializes concurrent invocations.
#
# ALL diagnostic output goes to stderr — stdout is reserved for the MCP server's
# JSON-RPC stream once launch.sh execs into it.
set -eu

PIN="1.3.11"   # keep in sync with package.json scholar.bundledBunVersion (vec0 ABI)
: "${CLAUDE_PLUGIN_DATA:?CLAUDE_PLUGIN_DATA is unset}"
BUN_DIR="${CLAUDE_PLUGIN_DATA}/bun"
BUN_BIN="${BUN_DIR}/bun"

ok() { [ -x "$BUN_BIN" ] && [ "$("$BUN_BIN" --version 2>/dev/null || true)" = "$PIN" ]; }

ok && exit 0

mkdir -p "$BUN_DIR"
# Serialize SessionStart-prewarm vs launcher invocations (avoid double-download).
LOCK="${BUN_DIR}/.provision.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock 9
fi
ok && exit 0   # another invocation finished while we waited on the lock

case "$(uname -m)" in
  x86_64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="aarch64" ;;
  *) echo "ensure-bun: unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
URL="https://github.com/oven-sh/bun/releases/download/bun-v${PIN}/bun-linux-${ARCH}.zip"

echo "ensure-bun: provisioning bun ${PIN} (${ARCH}) into ${BUN_DIR}" >&2
TMP="${BUN_DIR}/.dl"
rm -rf "$TMP"; mkdir -p "$TMP"
curl -fsSL "$URL" -o "${TMP}/bun.zip"
unzip -q -o "${TMP}/bun.zip" -d "$TMP"
mv "${TMP}/bun-linux-${ARCH}/bun" "$BUN_BIN"
chmod +x "$BUN_BIN"
rm -rf "$TMP"
echo "ensure-bun: provisioned $("$BUN_BIN" --version)" >&2
