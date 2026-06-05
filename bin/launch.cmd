@echo off
rem bin/launch.cmd - slim-plugin MCP launcher (Windows target).
rem
rem The plugin manifest spawns this via the always-present cmd.exe (Node/Bun
rem spawn cannot run a .cmd/.ps1 directly, so cmd.exe is the command):
rem   "command": "cmd.exe",
rem   "args": ["/c", "${CLAUDE_PLUGIN_ROOT}\\bin\\launch.cmd"]
rem
rem 1. ensure-bun.ps1 provisions the pinned bun.exe synchronously (its stdout/
rem    stderr go to stderr; 1>&2 guards stdout for the MCP JSON-RPC stream).
rem 2. Launch bun.exe dist\server.js - its stdio is inherited through cmd.
rem
rem FLAGGED: cmd.exe has no exec-replace, so bun.exe runs as a child of this
rem cmd. If Claude Code does not tree-kill the MCP process on shutdown, bun may
rem orphan and hold runtime\scholar.lock. Validate tree-kill on Windows hardware;
rem mitigate with a Job Object on the cmd side if orphaning is observed.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%CLAUDE_PLUGIN_ROOT%\bin\ensure-bun.ps1" 1>&2
if errorlevel 1 exit /b 1
"%CLAUDE_PLUGIN_DATA%\bun\bun.exe" "%CLAUDE_PLUGIN_ROOT%\dist\server.js" %*
