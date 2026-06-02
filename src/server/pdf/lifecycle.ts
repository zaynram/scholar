// src/server/pdf/lifecycle.ts — foundation cycle 6.2 (Task 2.2)
//
// scholar's client-side MCP-roots responder for the vendored pdf-server child.
// Per spec §7.2, root injection MUST flow through the supported MCP protocol:
//   1. scholar advertises `capabilities.roots.listChanged = true` in `initialize`.
//   2. scholar registers a `ListRootsRequestSchema` handler returning the active
//      corpus's PDF roots as `file://` URIs.
//   3. On mutation, scholar emits `notifications/roots/list_changed`; the upstream
//      `refreshRoots` then clears and re-fills its `allowedLocalDirs` from us.
//
// Additionally per §16 / foundation-006 item 10 (retained in -007/-008/-009):
//   - Windows Job Object orphan reaping via koffi FFI (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`).
//   - Linux best-effort: setPdeathsig stub (Bun/Node spawn doesn't expose pre-exec).
//   - Supervised respawn with exponential backoff [1s, 2s, 4s, 8s, 30s], 5-trip crash-loop
//     terminal, currentRoots survives respawn (lives in closure, not in the child).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, join, isAbsolute } from "node:path";
import pLimit from "../util/p-limit.ts";
import type { PdfChild } from "../tools/registry.ts";
import type { PdfCommand } from "../../vendor/pdf-server/dist/src/commands.js";

export interface SpawnOpts {
  initialRoots: string[];
  /** Override the child entrypoint path (test harness uses a stub). */
  childEntrypoint?: string;
  /** Override the bun runtime path (default: SCHOLAR_BUN_PATH ?? process.execPath). */
  bunRuntime?: string;
  /** Disable supervised respawn (test harness, default false). */
  disableSupervisor?: boolean;
}

export interface PdfChildHandle extends PdfChild {
  setRoots(paths: string[]): Promise<void>;
  refreshChildRoots(): Promise<void>;
  childPid(): number | undefined;
  debugIntrospectAllowedDirs(): Promise<string[]>;
  shutdown(): Promise<void>;
}

/**
 * Pure-logic helper: returns the `capabilities` object passed to the MCP Client
 * constructor. Exposed for unit-test assertion on the load-bearing
 * `roots.listChanged = true` invariant (§7.2 precondition #1).
 */
export function buildClientCapabilities(): { roots: { listChanged: boolean } } {
  return { roots: { listChanged: true } };
}

/**
 * Filters + canonicalises a candidate root list.
 *   - drops non-absolute paths
 *   - drops paths that don't exist
 *   - resolves through realpathSync (follows symlinks)
 *   - dedupes by realpath
 */
export function sanitizeRoots(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (typeof p !== "string" || !p) continue;
    const abs = resolve(p);
    if (!isOsAbsolute(abs)) continue;
    if (!existsSync(abs)) continue;
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(real);
  }
  return out;
}

function isOsAbsolute(p: string): boolean {
  // Windows: drive-letter or UNC. POSIX: leading /.
  return process.platform === "win32" ? /^[A-Za-z]:[\\/]|^\\\\/.test(p) : isAbsolute(p);
}

function fileUrlToPath(uri: string): string {
  return new URL(uri).pathname.replace(/^\/([A-Za-z]):/, "$1:");
}

// =========================================================================
// Supervised spawn implementation.
// =========================================================================

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000] as const;
const CRASH_LOOP_THRESHOLD_MS = 1_000;
const CRASH_LOOP_TRIPS = 5;

function resolveChildEntrypoint(override?: string): string {
  if (override) return override;
  // Slim-plugin model: pdf-server@1.7.2 ships as a single rebundled standalone
  // file (pdfjs-dist + all deps inlined by `bun build --target=bun`; verified to
  // parse PDFs with no node_modules — see lifecycle.contract.test.ts run under
  // SCHOLAR_PDF_ENTRYPOINT). mcp-app.html sits beside it (vendor reads it from
  // import.meta.dirname). Resolution order:
  //   1. SCHOLAR_PDF_ENTRYPOINT — explicit override the manifest wires in.
  //   2. ${CLAUDE_PLUGIN_ROOT}/dist/pdf-server/index.js — the shipped standalone
  //      bundle (present only in the packaged plugin, not the dev checkout).
  //   3. <repo>/src/vendor/pdf-server/dist/index.js — dev/test fallback; the
  //      upstream dist whose pdfjs-dist dynamic import resolves from the repo
  //      node_modules. §16 keeps this vendored tree as the .d.ts type source.
  const fromEnv = process.env.SCHOLAR_PDF_ENTRYPOINT;
  if (fromEnv) return fromEnv;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? resolve(import.meta.dir, "..", "..", "..");
  const shipped = join(pluginRoot, "dist", "pdf-server", "index.js");
  if (existsSync(shipped)) return shipped;
  return join(pluginRoot, "src", "vendor", "pdf-server", "dist", "index.js");
}

function resolveBunRuntime(override?: string): string {
  if (override) return override;
  // Slim-plugin model: scholar itself is launched by the provisioned bun
  // (manifest command = ${CLAUDE_PLUGIN_DATA}/bun{.exe}), so process.execPath is
  // already that bun and serves as the default. SCHOLAR_BUN_PATH lets the
  // manifest pin the child's runtime explicitly, decoupling it from however the
  // parent happened to be launched (e.g. a wrapper, or a dev `bun run`).
  return process.env.SCHOLAR_BUN_PATH ?? process.execPath;
}

export async function spawnPdfChild(opts: SpawnOpts): Promise<PdfChildHandle> {
  let currentRoots: string[] = sanitizeRoots(opts.initialRoots);
  let lastOkAt: number | null = null;
  let shuttingDown = false;
  let backoffIdx = 0;
  let lastCrashAt = 0;
  let crashTrips = 0;
  let terminalCrashLoop = false;

  const childPath = resolveChildEntrypoint(opts.childEntrypoint);
  const bunPath = resolveBunRuntime(opts.bunRuntime);

  let activeClient: Client | undefined;
  let activeTransport: StdioClientTransport | undefined;
  let activePid: number | undefined;

  // Single-slot mutex over root mutations.
  const mutex = pLimit(1);

  async function attemptSpawn(): Promise<void> {
    const transport = new StdioClientTransport({
      command: bunPath,
      args: ["run", childPath, "--stdio"],
    });

    const client = new Client(
      { name: "scholar", version: "0.1.0" },
      { capabilities: buildClientCapabilities() },
    );

    // Roots responder — the load-bearing piece per §7.2 precondition #2.
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: sanitizeRoots(currentRoots).map((p) => ({ uri: pathToFileURL(p).toString() })),
    }));

    await client.connect(transport);
    activeClient = client;
    activeTransport = transport;

    // Try to recover the underlying child PID from the transport (private surface).
    activePid = (transport as unknown as { _process?: { pid?: number } })._process?.pid;
    if (activePid && process.platform === "win32") {
      // Audit M2: attach-after-spawn leaves a microsecond race window where
      // a child that exits between spawn and AssignProcessToJobObject escapes
      // the job. Accepted at v1: the primary purpose of the job is parent-
      // death cleanup of long-lived children, not coverage of the synchronous-
      // crash case. Closing the race requires CreateProcess with
      // CREATE_SUSPENDED + AssignProcessToJobObject before ResumeThread —
      // which would mean reimplementing the StdioClientTransport spawn path.
      // Deferred until a Win32 test rig exists; tracked in audits/ROADMAP.md.
      attachJobObject(activePid);
    } else if (activePid && process.platform === "linux") {
      setPdeathsig(activePid);
    }

    lastOkAt = Date.now();
    backoffIdx = 0;

    // Wire supervisor: detect unexpected exit and schedule respawn.
    if (!opts.disableSupervisor) {
      transport.onclose = () => {
        if (shuttingDown || terminalCrashLoop) return;
        const now = Date.now();
        if (lastCrashAt !== 0 && now - lastCrashAt < CRASH_LOOP_THRESHOLD_MS) {
          crashTrips += 1;
          if (crashTrips >= CRASH_LOOP_TRIPS) {
            terminalCrashLoop = true;
            return;
          }
        } else {
          crashTrips = 1;
        }
        lastCrashAt = now;
        const delay = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)]!;
        backoffIdx = Math.min(backoffIdx + 1, BACKOFF_MS.length - 1);
        setTimeout(() => {
          if (shuttingDown || terminalCrashLoop) return;
          attemptSpawn().catch(() => {
            /* swallow — next onclose will retry */
          });
        }, delay);
      };
    }
  }

  await attemptSpawn();

  async function setRoots(paths: string[]): Promise<void> {
    await mutex(async () => {
      currentRoots = sanitizeRoots(paths);
      await activeClient?.sendRootsListChanged();
      lastOkAt = Date.now();
    });
  }

  async function refreshChildRoots(): Promise<void> {
    await activeClient?.sendRootsListChanged();
    lastOkAt = Date.now();
  }

  const handle: PdfChildHandle = {
    async interact(cmd, opts) {
      // Spec §13 v1.1 wire envelope: vendor exposes ONE tool named "interact"
      // whose input schema is {viewUUID, action, ...sibling-fields-per-action}.
      // Translate scholar's internal discriminated {type, ...rest} into the
      // vendor's {viewUUID, action: type, ...rest} callTool argument shape.
      // PdfCommand is the vendor's source of truth (§16 vendor-tool truth invariant).
      const { type, ...rest } = cmd as PdfCommand & { [k: string]: unknown };
      const r = await activeClient!.callTool(
        {
          name: "interact",
          arguments: { viewUUID: opts.viewUUID, action: type, ...rest },
        },
        undefined,
        {
          timeout: opts.timeoutMs ?? 30_000,
          signal: opts.signal,
        },
      );
      lastOkAt = Date.now();
      return r;
    },
    async getText(opts) {
      // get_text is an `action` of the vendor's `interact` tool, NOT a
      // separate vendor tool. The v1.0 code at this line called
      // `callTool({name: "get_text", ...})`, a tool that does not exist in
      // server-pdf@1.7.2. Fixed 2026-05-27.
      const r = await activeClient!.callTool(
        {
          name: "interact",
          arguments: { viewUUID: opts.viewUUID, action: "get_text" },
        },
        undefined,
        { timeout: opts.timeoutMs ?? 120_000 },
      );
      lastOkAt = Date.now();
      // The upstream get_text returns structured content; flatten to a string.
      if (typeof r === "string") return r;
      const content = (r as { content?: Array<{ type: string; text?: string }> }).content;
      if (Array.isArray(content)) {
        return content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text!)
          .join("");
      }
      return JSON.stringify(r);
    },
    async displayPdf(source, opts) {
      // Vendor `display_pdf` is a separate vendor tool (NOT an interact action).
      // Accepts {source: string}; returns {content, structuredContent: {viewUUID, ...}}.
      // viewUUID is the canonical handle for subsequent interact() calls — see
      // spec §13 "viewUUID propagation."
      const r = await activeClient!.callTool(
        { name: "display_pdf", arguments: { source } },
        undefined,
        { timeout: opts?.timeoutMs ?? 30_000 },
      );
      lastOkAt = Date.now();
      const structured = (r as { structuredContent?: { viewUUID?: unknown } }).structuredContent;
      const viewUUID = structured?.viewUUID;
      if (typeof viewUUID !== "string" || viewUUID.length === 0) {
        throw new Error(
          `PDF_DISPLAY_NO_VIEWUUID: vendor display_pdf returned no viewUUID for source=${source}`,
        );
      }
      return { viewUUID };
    },
    currentRoots: () => [...currentRoots],
    isHealthy: () => ({
      alive: !!activeClient && !terminalCrashLoop,
      lastOkAt,
      stdioOpen: !!activeTransport,
    }),
    setRoots,
    refreshChildRoots,
    childPid: () => activePid,
    async debugIntrospectAllowedDirs() {
      // Upstream pdf MCP @1.7.2 does not expose a list_roots tool; we fall back
      // to currentRoots as a best-effort proxy. The downstream extraction plan
      // can add a richer probe if upstream gains one.
      return [...currentRoots];
    },
    async shutdown() {
      shuttingDown = true;
      try {
        await activeClient?.close();
      } catch {
        /* ignore */
      }
      activeClient = undefined;
      activeTransport = undefined;
    },
  };
  return handle;
}

// =========================================================================
// Windows Job Object orphan reaping (koffi FFI).
// =========================================================================
function attachJobObject(childPid: number): void {
  try {
    // Lazy-require so non-Windows tests don't load the FFI binding.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require("koffi") as typeof import("koffi");
    const kernel32 = koffi.load("kernel32.dll");

    const CreateJobObjectW = kernel32.func("HANDLE CreateJobObjectW(void*, void*)");
    const SetInformationJobObject = kernel32.func(
      "BOOL SetInformationJobObject(HANDLE, int, void*, uint32)",
    );
    const AssignProcessToJobObject = kernel32.func("BOOL AssignProcessToJobObject(HANDLE, HANDLE)");
    const OpenProcess = kernel32.func("HANDLE OpenProcess(uint32, BOOL, uint32)");

    const job = CreateJobObjectW(null, null) as unknown as number;
    if (!job) throw new Error("CreateJobObjectW failed");

    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION with LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000).
    const limitInfo = Buffer.alloc(112);
    limitInfo.writeUInt32LE(0x2000, 16); // LimitFlags offset
    const ok = SetInformationJobObject(
      job,
      9 /* JobObjectExtendedLimitInformation */,
      limitInfo,
      limitInfo.length,
    );
    if (!ok) throw new Error("SetInformationJobObject failed");

    const PROCESS_SET_QUOTA = 0x0100;
    const PROCESS_TERMINATE = 0x0001;
    const hChild = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, childPid) as unknown as number;
    if (!hChild) throw new Error("OpenProcess failed");
    if (!AssignProcessToJobObject(job, hChild)) throw new Error("AssignProcessToJobObject failed");
    // Intentionally leak `job` — releasing the handle closes the job and terminates
    // the child immediately. We rely on process exit to release.
  } catch (err) {
    // Non-fatal — supervisor still reaps on clean exit. Log to stderr.
    console.error(JSON.stringify({ lvl: "warn", m: "Job Object attach failed", err: String(err) }));
  }
}

function setPdeathsig(_childPid: number): void {
  // The Linux equivalent (PR_SET_PDEATHSIG, SIGKILL) must run in the child
  // after fork but before exec — Node/Bun's spawn doesn't expose a pre-exec
  // hook. Foundation accepts the limitation: orphan reaping on Linux relies on
  // the SDK transport's child cleanup + scholar's own shutdown handler.
  // koffi-based prctl from the parent is not equivalent (it acts on parent PID).
  // Documented as a known gap; matches §16 "set on Linux for parity" intent.
}
