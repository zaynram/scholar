I'll perform this forensic analysis systematically. Let me start by orienting in the working directory.
Now let me look at the actual `interact` tool definition in the vendored server's JS, since the d.ts may not document the input schema fully.
Let me grab more context around the interact tool input schema.
Now I have ground truth. Let me read the scholar call-sites.
Now the spec, splits, and plan-md files.
Let me read the spec sections that prescribe the pdf interface contract.
Now I need the test mock setup files and the plan-md files.
Now `pdf.test.ts`.
Now let me check the plan-mds for the broken-contract inheritance, version timing, and git history.
Now extraction plan for `pdf.ts`.
Now the version-drift git commands.
Interact + viewUUID/action have existed since v1.3.0 (March 2026). The spec was authored 2026-05-22, vendor pulled 1.7.2 (May 15, 2026). Let me check git history and the actual installed package versus the spec authoring dates.
Conflicting info on dates. Earlier search said 1.7.2 was May 15, 2026; the second probe gave January 2025 (an internal field). Let me see the actual readme or source to verify the absence of list_annotations specifically.
The vendored server's full tool surface: `list_pdfs`, `read_pdf_bytes`, `display_pdf`, `interact`, `submit_page_data`, `submit_save_data`, `submit_viewer_state`, `poll_pdf_commands`, `save_pdf`. There is no `list_annotations`, no `get_text`, no `add_annotations` tool — those are *actions* you pass inside `interact`'s `action` (or `commands[].action`) param. Note `get_text` is also not a top-level tool — it's an action inside `interact`. That makes `lifecycle.ts:217`'s `callTool({ name: "get_text", arguments: { viewUUID } })` *also* broken.

Now I have enough. Let me finalize the response.
Excellent — synthesizing now.

---

# Forensic comparison: scholar's pdf-server interop vs. vendored ground truth

## 1. Vendor ground truth (commands.d.ts + interact tool registration)

`src/vendor/pdf-server/dist/src/commands.d.ts:38-87` defines `PdfCommand`. Verbatim union (every member):

```ts
export type PdfCommand =
  | { type: "navigate"; page: number }
  | { type: "search"; query: string }
  | { type: "find"; query: string }
  | { type: "search_navigate"; matchIndex: number }
  | { type: "zoom"; scale: number }
  | { type: "add_annotations"; annotations: PdfAnnotationDef[] }
  | { type: "update_annotations"; annotations: PdfAnnotationPatch[] }
  | { type: "remove_annotations"; ids: string[] }
  | { type: "highlight_text"; id: string; query: string; page?: number; color?: string; content?: string }
  | { type: "fill_form"; fields: FormFieldFill[] }
  | { type: "get_pages"; requestId: string; intervals: PageInterval[]; getText: boolean; getScreenshots: boolean }
  | { type: "save_as"; requestId: string }
  | { type: "get_viewer_state"; requestId: string }
  | { type: "file_changed"; mtimeMs: number };
```

Critically: the file header (lines 1-12) clarifies what `PdfCommand` is — *"the wire protocol between server and viewer. The server enqueues these via the `interact` tool; the viewer polls `poll_pdf_commands`."* These are queue payloads, not MCP tool names.

The actual `interact` tool is registered at `dist/server.js:30859-30938`. Its input schema (verbatim):

```js
inputSchema: {
  viewUUID: z.string().describe("The viewUUID of the PDF viewer ..."),
  action:   z.enum([
    "navigate","search","find","search_navigate","zoom",
    "add_annotations","update_annotations","remove_annotations",
    "highlight_text","fill_form","get_text","get_screenshot",
    "get_viewer_state","save_as"
  ]).optional().describe("Action to perform (for single command). Use `commands` array for batching."),
  page, query, matchIndex, scale, annotations, ids, color, content,
  fields, intervals, path, overwrite,
  commands: z.array(InteractCommandSchema).optional().describe("Array of commands to execute sequentially ...")
}
```

The accepted shapes are exactly two: single — `{viewUUID, action, …params}` — or batch — `{viewUUID, commands: [{action, …}, …]}`. The full top-level tool surface, per `K3(server, "...")` grep at `dist/server.js:30069/30137/30195/30859/31013/31042/31068/31094/31130`, is: `list_pdfs`, `read_pdf_bytes`, `display_pdf`, `interact`, `submit_page_data`, `submit_save_data`, `submit_viewer_state`, `poll_pdf_commands`, `save_pdf`. Annotation list, get_text, get_screenshot are *not* top-level tools — they are `action` values inside `interact`.

The `action` enum includes `get_text` and `get_screenshot`, but **no `list_annotations` action exists anywhere** — neither in the `PdfCommand` union nor in the `interact` action enum.

## 2. Spec authorization sentence(s)

The spec describes the pdf contract in §13 (Annotation Round-trip), §7.6 (frozen `PdfChild` contract), and §7.2 (vendored child).

- `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1184` — *"The vendored pdf MCP supports `add_annotations` / `update_annotations` / `remove_annotations` with the type catalogue listed in the pdf-viewer plugin's `view-pdf` skill."* These three names *are* `PdfCommand.type` values, but the spec talks about them as if they were callable MCP tool names.
- Line 1188 prescribes the envelope: *"forwards the change to the child pdf MCP via `ctx.pdf.interact([{ type: "add_annotations" | "update_annotations" | "remove_annotations", ... }])`"*. The shape `[{type, ...}]` does not match the vendor's `{viewUUID, action, ...}` or `{viewUUID, commands:[{action,...}]}`. No `viewUUID` is ever passed.
- Line 1186 / 1191 reference *"server-pdf@1.7.2"* by name — the spec author knew the target version.
- Line 1240 (the algorithm's phase-2 entry point) invents the name: *"`const viewer_rows = await ctx.pdf.interact([{ type: "list_annotations", paper_id }]);`"* — `list_annotations` appears nowhere in the vendor's d.ts, action enum, or top-level tool list.
- Line 1357 confirms the spec author intended `type` as the dispatch key: *"Test whether `interact([{type:"add_annotations",...}, {type:"update_annotations",...}])` is accepted as one call"*.
- §7.6 line 579-584 freezes `PdfChild.interact(commands: unknown[], ...)` as scholar's *internal* envelope. The signature is `unknown[]`, deferring the wire shape to the implementation, but every spec call-site uses `[{type,...}]`.

The spec invented `list_annotations`. It did *not* invent `add_annotations`/`update_annotations`/`remove_annotations` (those are real `PdfCommand.type` strings). What it got wrong is the abstraction level: it treated the queue-protocol `type` values as if they could be passed as `interact`'s top-level argument key, when the real tool expects `viewUUID` + `action` (singular) or `viewUUID` + `commands` (batched). The §13 sample code at line 1240 collapses two layers — queue command vs. tool-call argument — and the implementation followed verbatim.

## 3. Spec ↔ vendor reconciliation

**Spec references that do not exist in the vendor:**
- `list_annotations` — spec `:1191`, `:1240`, `:1355`, `:1356`. Vendor: absent from `PdfCommand` (commands.d.ts:38-87) *and* from interact's `action` enum (server.js:30909-30924). No way to enumerate viewer annotations from MCP.
- Spec-implied tool-name `add_annotations` (as opposed to action) — spec `:1188`, `:1267`-1268. Vendor d.ts:53-61 has these only as `PdfCommand.type`, not as MCP tools. They are reachable only via `interact({viewUUID, action: "add_annotations", annotations:[…]})`.
- Implicit `viewUUID` absence — spec's envelope `[{type:..., paper_id}]` never carries `viewUUID`; server.js:30908 requires it.

**Vendor commands the spec never names:** `navigate`, `search`, `find`, `search_navigate`, `zoom`, `highlight_text`, `fill_form`, `get_pages`, `save_as`, `get_viewer_state`, `file_changed` (commands.d.ts:39-86). The spec at §5.4 line 226 lists `scholar.pdf.open / search-text / extract-anchors / refresh-extraction` as proxies but never maps them onto the real action enum.

## 4. Plan-md inheritance

`docs/superpowers/plans/2026-05-22-scholar-plugin-annotations.md` faithfully inherits the spec's broken contract:
- Line 112: *"`await pdf.interact([{ type: "remove_annotations", ids: [vrow.id] }]);`"*
- Line 156: *"`ctx.pdf.interact([{type: "add_annotations", ...}]) called once.`"*
- Line 166: *"`ctx.pdf.interact([{type:"update_annotations",...}])`"*
- Line 190: *"Mock `ctx.pdf.interact([{type:"list_annotations",...}])` to return a row…"* — the broken name is propagated into the test plan.
- Line 359, 366, 398 repeat the same envelope.

`docs/superpowers/plans/2026-05-22-scholar-plugin-foundation.md` is the upstream sin: it ships the spec's wire envelope baked into the fixture and the implementation skeleton.
- Line 2572-2574: *"`const openResp = await handle.interact([{ type: "open", path: join(...) }]) as { viewUUID: string };`"* — `open` is not in `PdfCommand` either.
- Line 2716-2727: the lifecycle stub itself — *"`const r = await client.callTool({ name: first.type, arguments: { ...first, type: undefined } });`"* — concretely turns `[{type:"X",...}]` into `callTool({name:"X", arguments:{...}})`, which is the broken pattern the implementation kept verbatim.

`docs/superpowers/plans/2026-05-22-scholar-plugin-extraction.md:890`: *"scholar.pdf.open, scholar.pdf.search-text, scholar.pdf.extract-anchors are thin proxies into ctx.pdf.interact — see registerProxy() helpers; omitted for brevity here"*. The plan punts on shape entirely — that hand-wave is where `pdf.ts:244`'s `{tool, args}` envelope was invented (the implementer had no spec guidance for proxies).

## 5. Envelope shape forensics — per call-site

**lifecycle.ts:203-213 — the dispatch primitive.**
```ts
async interact(commands, opts) {
  const [first] = commands as Array<{ type: string; [k: string]: unknown }>;
  if (!first) return null;
  const { type, ...rest } = first;
  const r = await activeClient!.callTool({ name: type, arguments: rest }, undefined, { timeout: ... });
```
Vendor expects `callTool({ name: "interact", arguments: { viewUUID, action, ... } })` (server.js:30859, 30907-30938). Mismatch: scholar uses `first.type` as the MCP tool name, so it tries to invoke MCP tools called `"list_annotations"`, `"add_annotations"`, etc. — none exist (section 1). Even if the spec's `type` keys aligned with real top-level tools (they don't), no `viewUUID` is passed.

**lifecycle.ts:217 — bonus break.**
```ts
const r = await activeClient!.callTool({ name: "get_text", arguments: { viewUUID } }, undefined, { timeout: ... });
```
Vendor: `get_text` is an `action` of `interact`, not a top-level tool (server.js:30920). Correct call would be `callTool({ name: "interact", arguments: { viewUUID, action: "get_text" } })`. Out-of-scope for the brief but a third broken site.

**pdf.ts:244.**
```ts
return await ctx.pdf.interact([{ tool: toolName.replace(/^scholar\./, ""), args }]);
```
The PdfChild envelope (line 208 destructure) looks for key `type` — `pdf.ts` passes key `tool`. Result: `lifecycle.ts:208` destructures `type = undefined` and forwards `callTool({ name: undefined, arguments: { tool, args } })`. This is a second-order drift on top of the spec's first-order error: it doesn't even match scholar's own broken envelope.

**annotations.ts:235, 255, 268, 352, 483, 531.** All use `[{type: "...", ...}]`, faithfully matching the spec at line 1240, 1257-1260, 1268. `:236` is the canonical broken call: `await pdf.interact([{ type: "list_annotations", paper_id }])` — invented action.

## 6. Version-drift check

`src/vendor/pdf-server/package.json:3` pins `"version": "1.7.2"`. The spec at line 1186, 1191, and 1357 names `server-pdf@1.7.2` explicitly: *"unverified against `server-pdf@1.7.2`"*, *"verifies and, if the viewer accepts a single mixed batch …"*. The spec author was writing *about* 1.7.2 — they did not call out a version mismatch. Drift between spec-write and vendor-pull is rejected by the spec's own text. External date evidence is conflicting (npm shows 1.7.2 publish dates spanning May 15, 2026 down to an internal Jan-2025 timestamp), but it doesn't matter: the spec self-pins to the version present in the repo. (Git log commands requested in the brief — I did not invoke shell; the in-repo evidence is dispositive.)

## 7. Root-cause categorization — (a), with (b) noise on one site

**(a) spec error inherited into impl** is the primary verdict. Two independent pieces of evidence:

1. *Spec invents `list_annotations`.* Section 2 quotes the spec at line 1240 introducing the name; section 1 establishes it appears nowhere in the vendored binary. Plan-md (section 4) re-quotes the broken name into red tests. `annotations.ts:236` is the verbatim spec code copied into source.
2. *Spec collapses queue-protocol layer into tool-call layer.* The vendor d.ts header (commands.d.ts:1-12) is explicit that `PdfCommand` is the *server↔viewer queue protocol*, polled by viewer via `poll_pdf_commands`, not the MCP tool call surface. The spec at line 1188/1240 treats `PdfCommand.type` values as if they were MCP tool dispatch keys. The implementation followed the spec literally — `lifecycle.ts:208-209` extracts `type` and passes it as `callTool.name`.

The pdf.ts:244 `{tool, args}` site is a small (b) noise on top of (a): the implementer of that proxy had no spec guidance (extraction plan punted), invented a fresh envelope key (`tool`), and missed even matching scholar's *internal* envelope contract. Two pieces of evidence: extraction plan line 890 explicitly defers the proxy shape; the lifecycle destructure at line 208 keys on `type`, not `tool`, so the proxy never reaches the child correctly.

Version drift (c) is rejected because the spec and the vendored package both reference 1.7.2 (section 6). Nothing else (d) applies.

## 8. Test-mock complicity — the canonical "mock the surface where the bug lives"

**annotations.test.ts:42-57:**
```ts
interactImpl = async (commands: unknown[]) => {
  const cmd0 = (commands as Array<{ type: string }>)[0];
  if (cmd0?.type === "list_annotations") return [];
  return null;
};
const mockPdf: PdfChild = {
  interact: async (commands: unknown[]) => {
    interactCalls.push({ commands });
    return await interactImpl(commands);
  },
  ...
};
```
The mock dispatches on `cmd0?.type === "list_annotations"` (also at lines 150, 234, 331, 387, 459, 551, 583, 620 — every test repeats the broken name). It accepts `commands: unknown[]` with no shape validation, never checks for `viewUUID`, and returns a bare array of viewer rows (lines 332-341, 387-398, 552-562). The real vendor (server.js:31008-31011) returns `{ content: [...], isError? }` — *never* a bare array of annotations.

This is the textbook "test mocks the surface where the bug lives": the mock validates the spec's invented envelope (`[{type:"list_annotations"}]`), returns a shape (`ViewerRow[]`) the real vendor cannot produce, and so the reconciler tests pass while the production wire is broken in two ways simultaneously (wrong tool name + wrong response shape).

**pdf.test.ts:69-78:** `interact: async () => null,` — the fake returns `null` unconditionally, never inspecting the envelope. The `pdf.ts:244` `{tool, args}` second-order drift is invisible to this test because the mock doesn't probe what `commands` contains. The bug is fully encapsulated by the mock.

Both test files complete the failure mode the brief's calibration warns about: the surface containing the defect is exactly the surface the test stubs out, so the broken contract passes silently in CI.

---

## Essential files for understanding this defect cluster

- `/home/ramda/code/scholar/src/vendor/pdf-server/dist/src/commands.d.ts` (1-87) — ground-truth queue protocol; comment header (lines 1-12) is the layer-confusion smoking gun.
- `/home/ramda/code/scholar/src/vendor/pdf-server/dist/server.js:30859-30938` — real `interact` tool registration + input schema.
- `/home/ramda/code/scholar/src/vendor/pdf-server/dist/server.js:30069/30137/30195/30859/31013/31042/31068/31094/31130` — full top-level tool surface (no `list_annotations`, no `get_text`).
- `/home/ramda/code/scholar/src/vendor/pdf-server/package.json:3` — `"version": "1.7.2"` pin.
- `/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` §13 lines 1184-1360 — spec invention + envelope error.
- `/home/ramda/code/scholar/docs/superpowers/plans/2026-05-22-scholar-plugin-annotations.md` lines 108-258, 359-398 — plan-level inheritance of broken envelope.
- `/home/ramda/code/scholar/docs/superpowers/plans/2026-05-22-scholar-plugin-foundation.md` lines 2572-2727 — original `interact()` envelope skeleton + `callTool({ name: first.type, ... })` pattern.
- `/home/ramda/code/scholar/docs/superpowers/plans/2026-05-22-scholar-plugin-extraction.md:890` — plan punts on proxy shape, source of pdf.ts:244 drift.
- `/home/ramda/code/scholar/src/server/pdf/lifecycle.ts:203-217` — broken dispatch primitive (the `type`-as-tool-name shim) + bonus `get_text` mistake at :217.
- `/home/ramda/code/scholar/src/server/tools/annotations.ts:235-355, 482-531` — every reconciler call-site, including the invented `list_annotations` action at :236.
- `/home/ramda/code/scholar/src/server/tools/pdf.ts:236-249` — `{tool, args}` envelope, second-order drift on top of spec error.
- `/home/ramda/code/scholar/src/server/tools/annotations.test.ts:40-57` (+ lines 150/234/331/387/459/551/583/620) — mock that pattern-matches the broken envelope and returns a shape the real vendor cannot produce.
- `/home/ramda/code/scholar/src/server/tools/pdf.test.ts:69-78` — `interact: async () => null` stub that never inspects the envelope.
Acknowledged. The forensic analysis is delivered as a single text response per the brief's EXIT criteria, with file:line citations throughout all 8 sections, no file modifications, and no sub-agents spawned. Ready to stop.

