# Runbook — End-to-End Smoke Test (first real literature-review pass)

**Purpose:** prove the full workflow works against a *live* server before relying
on scholar day-to-day. Everything to date is unit / contract / headless-e2e; this
is the first time the plugin loads, spawns, and runs a real corpus end-to-end.

**Owner:** human (requires a live Claude Code session and, for the last leg, a
real PDF viewer). Allow ~30 min.

---

## 0. Prerequisites (gates — do not skip)

- [x] **Ollama models present.** ✅ `nomic-embed-text:v1.5` (embed, 768-dim) and
  `qwen3:8b` (chat) pulled into the GPU-accelerated **ipex-llm-ollama** service
  and verified through scholar's `client.ts` (2026-06-03). See `HUMAN.md` §1.
- [x] **Ollama reachable** at `http://127.0.0.1:11434` — `ipex-llm-ollama.service`
  is enabled + active and binds the manifest default. (`sudo systemctl status
  ipex-llm-ollama` to check.)
- [ ] **Build is fresh.** `bun run build` → `out/scholar.plugin` (~2.8–2.9 MB).
- [ ] **Suite green.** `bun test src tests` → 0 fail.

Two ways to drive the tools below:
- **In a Claude Code session** with the plugin installed — call the `scholar.*`
  MCP tools directly (this also exercises G3: real install + spawn).
- **From the shell** via the nu CLI — `nu bin/scholar.nu <tool> --json '{...}'`,
  with convenience subcommands `list | status | ingest | query | digest`.

---

## G3 — Install + spawn (do this first, in a real session)

1. Install the built plugin (`out/scholar.plugin`) into Claude Code, or run from
   source. On first launch `bin/launch.sh` calls `ensure-bun.sh`, which provisions
   the pinned bun 1.3.11 into `${CLAUDE_PLUGIN_DATA}/bun` (one-time download).
2. Confirm the `scholar` MCP server appears connected and tools are listed.
   - *Already proven on Linux at pivot time:* manifest → `launch.sh` → ensure-bun →
     clean MCP `initialize` (slim-pivot spec §"linux"). The **un**proven part is
     everything below — a real corpus workflow — plus the Windows launch path.

**If the server doesn't spawn:** check `${CLAUDE_PLUGIN_DATA}` is set (ensure-bun
hard-fails without it) and that `curl`/`unzip` are available for the bun download.

---

## G2 — Full workflow

### 1. Corpus
- [ ] `scholar.corpus.create` `{ "slug": "smoke", "display_name": "Smoke Test" }`
- [ ] `scholar.corpus.activate` `{ "slug": "smoke" }`
- [ ] `scholar.roots.add` `{ "path": "<dir with PDFs>" }` (where downloaded/your PDFs live)
- [ ] `scholar.corpus.status` → expect the new corpus, 0 papers.
  - nu: `nu bin/scholar.nu status smoke`

### 2. Ingest (exercises Ollama embed indirectly + adapters)
- [ ] arXiv: `scholar.ingest.arxiv` `{ "arxiv_id": "2401.00001", "corpus_id": "smoke" }`
- [ ] DOI: `scholar.ingest.doi` `{ "doi": "10.1038/s41586-021-03819-2", "corpus_id": "smoke" }`
- [ ] Re-run one of the above → confirm it **UPSERTs** (no duplicate row).
  - nu: `nu bin/scholar.nu ingest smoke --arxiv 2401.00001`

### 3. Extraction + embeddings (the real Ollama embed leg)
- [ ] `scholar.pdf.refresh-extraction` on an ingested paper → chunks + embeds.
  - Watch for `still_indexing` clearing. **This is where a missing/again-wrong
    embed model fails first** — expect a clear `OllamaUnavailableError`, not a hang
    (S3 timeout fix). If it hangs > ~60s, the model/daemon is the problem.

### 4. Search (vec0 + RRF)
- [ ] `scholar.papers.search` `{ "q": "<a phrase from the paper>", "limit": 10 }`
  → expect hits ranked by RRF; `still_indexing:true` means lexical-only interim.
  - nu: `nu bin/scholar.nu query "<phrase>"`

### 5. Digest (the real Ollama chat leg)
- [ ] `scholar.digest.generate` `{ "scope_key": "all" }` → expect a synthesis body.
  - nu: `nu bin/scholar.nu digest --all`
  - **Fails first if the chat model is missing** — same clean-error expectation.
  - Confirm Ollama is the default path (no `--claude` / askClaude unless opted in).

### 6. Reading prompts
- [ ] `scholar.prompts.generate` `{ "scope_key": "all" }` → expect prompt set.

### 7. Annotations + PDF viewer  ⚠️ HIGHEST RISK — never exercised, anywhere
This leg has **zero automated coverage**: the test suite deliberately skips the
browser-viewer path because `display_pdf`/`get_text` hang headless (see
`src/server/pdf/lifecycle.test.ts` FIXTURE 4 and the contract test's
"Why no C3 for get_text?"). A live viewer is the only way to prove it.

- [ ] `scholar.pdf.open` on an ingested paper → returns a `viewUUID`; a real PDF
  viewer window should display the document.
- [ ] `scholar.annotations.upsert` a note `{ page, x, y, content }` → confirm the
  sticky note appears in the viewer (the §13 v1.1 one-way push path).
- [ ] `scholar.annotations.list` → the note round-trips back.
- [ ] `scholar.annotations.delete` → it disappears from the viewer.
- [ ] Mutate roots (activate/add) while a view is open → the open `viewUUID`
  survives (FIXTURE 4 asserts this headlessly; confirm it visually here).

**If this leg fails or hangs:** that is the expected weak point. Capture the
exact tool, args, and viewer behavior — this is the one surface with no prior
evidence, so a failure here is new information, not a regression.

---

## Done when
All of §1–§6 pass and §7 is at least partially exercised against a real viewer.
At that point scholar is genuinely usable for day-to-day reviews; record any §7
findings (it's the untested frontier) back into `docs/audits/`.
