#!/bin/sh
# bin/launch.sh — slim-plugin MCP launcher (Linux/macOS).
#
# The plugin manifest spawns this via an always-present shell:
#   "command": "/bin/sh", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/launch.sh"]
# Using /bin/sh (not the script directly) sidesteps the zip executable-bit
# problem, and `exec` below REPLACES this shell with bun — so the PID Claude
# Code spawned BECOMES the server (no orphaned wrapper, lock released on kill).
#
# 1. ensure-bun provisions the pinned runtime synchronously (correctness gate).
# 2. exec bun dist/server.js — scholar then runs UNDER the provisioned bun, so
#    process.execPath is that bun (the pdf child inherits it) and
#    CLAUDE_PLUGIN_ROOT resolves dist/pdf-server + vec0 with no extra env.
set -eu
# Invoke ensure-bun via `sh` (not directly) — the zip does not preserve the
# executable bit, so neither launch.sh nor ensure-bun.sh can rely on +x.
sh "${CLAUDE_PLUGIN_ROOT}/bin/ensure-bun.sh"
exec "${CLAUDE_PLUGIN_DATA}/bun/bun" "${CLAUDE_PLUGIN_ROOT}/dist/server.js" "$@"
