I'll execute this governance review systematically. Let me start by inventorying the spec-pipeline gates on unstable.
Now let me read the references and the dev-marketplace shipped version.
Now let me check the dev-marketplace shipped version.
So at the time of scholar planning (2026-05-22 01:14), the XSD-validation hook was committed (2026-05-21 02:19) and the inline XSD-validation gate (2026-05-21 01:27) were in place. The scope-maintenance protocol finalization (97d9260) was 2026-05-21 03:13. Let me check what the dev-marketplace shipped at scholar planning time. Let me check whether the spec-pipeline was shipped from src/ at that time or already a subrepo.
The dev-marketplace subrepo didn't exist before 2026-05-22, so scholar's planning was driven by the src/development/spec-pipeline/ tree directly (or via some marketplace mechanism). Let me confirm by checking the .mcp.json on scholar's planning state.
Now let me check the key plan-execution agents and look at the scholar codebase for the bug-class concrete instances.
Now let me briefly inspect the scholar bugs to ground claims about each bug class.
Confirmed: spec says `list_annotations` exists; vendored package has `add_annotations`/`remove_annotations` but NOT `list_annotations`. Now let me look at the bug-class evidence and consolidate.
Confirmed Bug Class 1: spec mentions `list_annotations` 6+ times; vendored package's `dist/server.js` does not contain that string at all. The tools listed are `add_annotations`, `update_annotations`, `remove_annotations`, `highlight_text` — no `list_annotations`. Now let me check for Class 3 (transaction await) and Class 4 (primitives) evidence.
Primitives ARE used in some places but no structural enforcement gate. Now I have enough orientation. Let me call the advisor before drafting.
Excellent advice. Let me draft and produce the final report.

# Spec-Pipeline Governance Review — Bug-Class Coverage Against Scholar's Defect Surface

## 1. Inventory of current spec-pipeline gates on `unstable`

Gate locations: `/home/ramda/code/claude-lib/src/development/spec-pipeline/{skills,hooks,scripts,agents}/`.

| Gate | Stage | Mechanism | What it catches | Citation |
|---|---|---|---|---|
| XSD inline gate (plans.xml) | ingest-spec / spec-to-plan / exec-plan / exec-multi-plan / scope-maintenance | `xmllint --noout --schema` invoked from procedure step | Malformed plans.xml registry edits | `ingest-spec.xml:45`; `exec-plan.xml:37`; `exec-multi-plan.xml:23,70,73`; `scope-maintenance.xml:158-167` |
| XSD inline gate (splits.xml) | ingest-spec (grouped); spec-to-multi-plan | `xmllint --noout --schema splits.xsd` | Malformed splits.xml on commit | `ingest-spec.xml:45`; `spec-to-multi-plan.xml:9` |
| XSD inline gate (chores.xml) | scope-maintenance / exec-code-chore | `xmllint --noout --schema chores.xsd` | Malformed chore entries | `scope-maintenance.xml:158`; `exec-code-chore.xml:15` |
| Registry-XSD PostToolUse hook (backstop) | always-on (every Edit/Write/MultiEdit) | Bash hook `validate-registry-xml.sh`, `PostToolUse` matcher in `hooks/hooks.json` | Hand edits to registries outside any workflow; warn-loud, never block | `hooks/hooks.json:4-13`; `hooks/validate-registry-xml.sh:25-99` |
| Threshold check | ingest-spec step 5 | Python `threshold_check.py` parsing §5/§6 counts | Monolithic spec → forces grouped plan | `ingest-spec.xml:12-18` |
| Overlap analysis | ingest-spec step 7 | Python `overlap_analysis.py` on declared blast radii | Concurrent-edit collision; assigns `worktree="required"` deterministically | `ingest-spec.xml:22-30` |
| Bare-slug resolver | router | Python `resolve_slug.py` (JSON contract) | Direct routing to plan-group children; status of registry entry | `SKILL.md:33-57` |
| Structural validation (always-on) | spec-to-multi-plan step 6 | Lead inspects plan-md against splits.xml: cycle range, blast-radius, H2 heading format, sibling-suffix exactness | Plan-md/splits.xml drift; format that defeats `sequence_helpers` edge extraction | `spec-to-multi-plan.xml:23` |
| Stage A self-review | spec-to-plan step 5 / spec-to-multi-plan step 4 | `Agent({subagent_type: "reasoning-protocols:plan-review"})` (LLM) with severity-gate convergence | Logic gaps, missing edge cases (textual LLM review) | `spec-to-plan.xml:12-13`; `spec-to-multi-plan.xml:16-18` |
| Stage B cross-plan review | spec-to-multi-plan step 6 (conditional) | `Agent({subagent_type: "reasoning-protocols:plan-review"})` over splits.xml + all plan-mds | Cross-plan integration issues (LLM) | `spec-to-multi-plan.xml:24` |
| Plan-review-non-convergence detection | spec-to-plan + spec-to-multi-plan | Identity-tuple equality across iterations; MAX_STAGE_A_ITERATIONS=5 cap | Stuck self-review loops | `spec-to-plan.xml:12-13`; `spec-to-multi-plan.xml:17-18` |
| Per-cycle code-review | exec-plan / exec-multi-plan | `code-review:code-review` Skill invocation BASE=`<green-sha>~2`, HEAD=`<green-sha>`; three-way `halt`/`refactor`/`defer-chore` | Critical findings in each Green commit (LLM) | `per-cycle-code-review.xml:31-95`; `exec-plan.xml:11`; `exec-multi-plan.xml:122-124` |
| Branch-discipline + commit-discipline | exec-plan / exec-multi-plan / scope-maintenance | Textual abort on `main`; "never --amend / --no-verify" prose | Bypassing hooks/force-push | `exec-plan.xml:9`; `exec-multi-plan.xml:9`; `scope-maintenance.xml:390` |
| Scope-maintenance write-ownership | shared protocol | DISPATCHER-WRITES textual model; executor scope-whitelist enumerates `must-not-edit` | Executor silently absorbing scope or hand-writing registry | `scope-maintenance.xml:51-77`; `SKILL.md:105-118` |
| Misclassification abort | invariant #7 | Textual: chore-executor aborts on code↔simple boundary crossing | Wrong dispatch vehicle | `SKILL.md:75` |
| Team-name equality preflight | exec-multi-plan step 3 | Textual halt-report category `team-name-mismatch` | Mismatched `team_name` vs plan-group id | `exec-multi-plan.xml:11-17` |

## 2. Shipped-vs-`unstable` delta

`/home/ramda/code/claude-lib/dev-marketplace/spec-pipeline/` is a subdirectory of a subrepo whose pointer is `dev-marketplace/.gitrepo:9` → `commit = 1d03f206a5507816c62d65088b762afb6f5ca855` on `git@github.com:zaynram/dev-marketplace.git`. The subrepo was first cloned into `claude-lib` at commit `d9adf59` (`git log --all -- dev-marketplace/spec-pipeline/`), which post-dates the entire scholar planning + execution timeline.

Scholar's earliest commit is `58122af scaffold` and its plan-group registration is `470f212 chore(context/plans): open plan-group 2026-05-22-scholar-plugin` dated **2026-05-22 01:14:57 -0500**. Therefore scholar's planning consumed `src/development/spec-pipeline/` directly, NOT a shipped subrepo. The honest delta is "src/development/ then vs now":

Gates already landed before scholar ingest (`<= 2026-05-22 01:14`):
- `1b61179 add XSD-validation gate to chore/plan-authoring workflows` (2026-05-21 01:27).
- `abf2434 add registry-XSD validation hook backstop` (2026-05-21 02:19).
- `97d9260 finalize scope-maintenance protocol and wire call-sites` (2026-05-21 03:13).

Gates landed after scholar ingest that scholar's flow did NOT exercise:
- `94e4f1f refactor(plugins): split chore-runner out of spec-pipeline` — structural separation but no new gate semantics.
- `144f12d feat(ingest-spec): step-3 descriptive-slug convention` — slug-shape validation only; orthogonal to bug class.
- `b9214bf fix(spec-pipeline): register scope-maintenance in WORKFLOW_SLUGS` — resolver fix; orthogonal.

Net result: every gate listed in §1 above (modulo `<step n="3a-d">` descriptive-slug sub-steps in `dev-marketplace/spec-pipeline/.../ingest-spec.xml:10-24`) was available at scholar's planning time. The bugs are not explainable as "shipped lag behind unstable"; they are explainable as "the gate set on unstable does not catch this defect class."

## 3. Bug-class-to-gate map

| # | Bug class | Gate type needed | Exists on unstable? | If yes, file:section | If no, gap |
|---|---|---|---|---|---|
| 1 | Spec cites pdf-server tools not in the vendored package (`list_annotations`) | **External-reality check**: grep vendor artifact tool manifest from spec | **no** | — | `ingest-spec.xml:11` step 4 reads spec internally; no step reads vendor packages declared by the spec. Stage A `reasoning-protocols:plan-review` is a textual LLM that cannot see `src/vendor/pdf-server/dist/server.js` unless told to. |
| 2 | Tests mock the surface where the bug lives (compile-fallback, sibling-copy, posture-B-on-ctx.pdf) | **Consumer-test-rigor audit** (e.g., mutation testing, "no-mock-on-symbol-X" lint) | **no** | — | spec-pipeline emits no test-quality requirement on plan-mds; `code-review:code-review` reviews diffs not test fidelity. Out-of-scope structurally. |
| 3 | §13 "no awaits inside transaction" not structurally verified | **AST/regex lint as a plan-md acceptance criterion + spec-pipeline-enforced citation** | **partial** | `spec-to-multi-plan.xml:23` structural-validation enforces blast-radius/cycle-range/H2 format only | No load-bearing-invariant-citation rule. Plan-author may name §13 in prose without naming the test or lint that enforces it; `<structural-validation>` (a)-(e) does not check for "every cited invariant has a named gate." |
| 4 | §12.0 primitives mandate ("all untrusted input through 7 helpers") not structurally verified | same as Class 3 | **partial** | same | same — primitives.ts is mentioned in some scholar files (`grep` finds 12 hits across 6 files) but spec-pipeline never required the plan-md to declare an enforcement gate. |
| 5 | Build orchestration cascaded bugs (noop wiring, `void` suppressing real execution, env-var rename drift, comma typo) | **Smoke build at exec-plan close** + **pre-commit gate** beyond `pixi run check` | **no** | — | `exec-plan.xml:55` completion-criterion is "project gate (e.g., pixi run check) passes"; no full-build / smoke / artifact-execution requirement. The `code-review:code-review` skill reviews diff per cycle, not orchestration scripts in aggregate. |
| 6 | Plan-mds inherit spec errors (no spec-internal contradiction detection at plan-authoring time) | **Spec-internal-consistency lint** at `ingest-spec` (cross-reference §X claims, vendor-tool citations, contract-pin coherence) | **no** | — | `ingest-spec.xml:11` step 4 enumerates target files + cycle count + complexity; does not lint the spec for self-contradiction or external-reference soundness. Stage A operates on the *drafted plan-md*, not the spec. |

## 4. Failure-mode taxonomy

The five gate types from the task prompt mapped against each class. "Catches" means the gate type, applied to the appropriate artifact at the appropriate stage, would have intercepted the defect.

| Gate type | Class 1 | Class 2 | Class 3 | Class 4 | Class 5 | Class 6 |
|---|---|---|---|---|---|---|
| (a) schema/XSD | no — schema validates registry shape, not vendor-tool truth | no | no | no | no | no |
| (b) textual protocol | weak — plan-author could be told to grep vendor; same override risk as chore #89 | no | weak — citation rule could be added; depends on plan-author compliance | weak | weak | weak |
| (c) hook | possible — PreToolUse on `Edit` of plan-md that runs a vendor-tool-citation linter | no | possible — pre-commit lint on src/ for `await` inside `db.transaction` blocks | possible — lint for "untrusted input → primitives.ts only" | possible — PostToolUse on build scripts | no |
| (d) consumer-test | no — tests mocking the buggy surface IS Class 2 itself | no — recursive | partial — only if scholar wrote the lint as a `bun test` | partial | partial — smoke test as a cycle | no |
| (e) human review | Stage A LLM did not catch this | Stage A LLM did not catch this | Stage A is textual, exactly the override-vulnerable shape | same | same | same |

**Spec-pipeline-resident mechanisms on unstable per category:**
- (a) **yes**: XSD inline gates + PostToolUse backstop hook. *No coverage of any scholar bug class* — these gates validate registry XML, not spec content, plan-md content, or src/ content.
- (b) **yes**: SKILL.md invariants, scope-whitelists, scope-maintenance protocol, halt-report enumerations, channel-asymmetry directives. *Vulnerable to the chore #89 override pattern* — textual procedures readable by LLM agents but not enforced at tool-call boundary.
- (c) **partial**: ONE PostToolUse hook (`validate-registry-xml.sh`). Warn-only, never blocks (`exit 0` on validation failure per `validate-registry-xml.sh:81,99`). No PreToolUse hook. No hook touching src/, tests/, or plan-mds.
- (d) **none**: spec-pipeline emits no test-quality requirement.
- (e) **yes**: Stage A self-review (`reasoning-protocols:plan-review`), Stage B cross-plan review, user-confirm steps. *LLM-textual, structurally identical to the gate chore #89 documented as bypass-prone.*

The pattern that emerges: spec-pipeline's hardened gates (XSD) only protect the registry layer. Its plan-md and execution layers rely on textual protocols + LLM review — exactly the gate shape that chore #89 documented as silently override-able. Scholar's bug class is the broader-surface symptom of the same root cause.

## 5. Concrete fix proposals (max 5; strict one-sentence-each format)

**Proposal 1 (Class 1 — vendor-tool citation reality check).**
Add a `vendor_tool_reference_check.py` script that greps every `*-design.md` for tool-name patterns (regex: backtick-quoted `[a-z][a-z_]+`-shaped identifiers in proximity to `mcp` / `pdf` / vendored-package mentions) and verifies each appears in `src/vendor/*/dist/*.js` (or a consumer-declared `vendor-manifest.txt`).
File: `/home/ramda/code/claude-lib/src/development/spec-pipeline/scripts/vendor_tool_reference_check.py`, wired into `ingest-spec.xml` step 4 as a halt-on-mismatch gate.
Acceptance: `python3 vendor_tool_reference_check.py --spec /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` exits non-zero citing `list_annotations` as an unresolved reference.

**Proposal 2 (Class 3 + Class 4 — load-bearing-invariant-citation rule).**
Extend `<structural-validation>` in `spec-to-multi-plan.xml` step 6 with rule (f) "every spec-cited load-bearing invariant referenced in the plan-md must name the enforcement gate (test path or lint command); plan-mds citing invariants without enforcement bindings are rejected with feedback enumerating the unbound citations."
File: `/home/ramda/code/claude-lib/src/development/spec-pipeline/skills/spec-pipeline/references/spec-to-multi-plan.xml` (extend the existing `<structural-validation always-on="true">` element).
Acceptance: a synthetic plan-md mentioning "§13 no-await-in-tx" without a `tests/*.test.ts` path or `scripts/*lint*.py` reference triggers structural-validation rejection with feedback citing rule (f).

**Proposal 3 (Class 5 — smoke-build completion criterion in exec-plan).**
Add a `<criterion>` to `exec-plan.xml` / `exec-multi-plan.xml` completion blocks requiring "a smoke invocation of the project's primary build artifact (consumer-declared via a `smoke-build` field in plan-md `## Acceptance` section) exits 0 and produces the declared artifact path."
File: `/home/ramda/code/claude-lib/src/development/spec-pipeline/skills/spec-pipeline/references/exec-plan.xml` (and `exec-multi-plan.xml` `<completion-criteria>` symmetrically).
Acceptance: an exec-plan run on a plan with `smoke-build: bun build --compile src/server/index.ts -o runtime/server` that emits the binary but the binary segfaults on `--version` fails the completion check.

**Proposal 4 (Class 6 — spec-internal-consistency lint at ingest-spec).**
Add a `spec_consistency_check.py` that flags self-contradictions in `*-design.md`: vendor-tool citations vs declared vendor package, contract pins (e.g., "§7.6 frozen contracts") vs their downstream restatements, and section-cross-references whose targets do not exist.
File: `/home/ramda/code/claude-lib/src/development/spec-pipeline/scripts/spec_consistency_check.py`, wired into `ingest-spec.xml` step 2 as a non-blocking warn-loud + step 4 as a blocking halt on critical mismatches.
Acceptance: running the script on a spec that says "§7.6 freezes the `Logger` contract" while §7.6 lists `ServerContext` but not `Logger` exits with a non-zero status and prints the mismatched citation.

**Proposal 5 (Class 2 — test-rigor audit) — NEEDS FOLLOW-UP DISPATCH.**
A test-rigor audit gate (forbid-mock-on-symbol-X / mutation-testing acceptance threshold) is multi-component: it requires a mock-surface-detection script, a plan-md schema extension to declare "no-mock symbols," and a consumer-side test-runner integration; this exceeds the one-sentence constraint and should be dispatched as a separate plan-review or chore.

---

**Pattern summary.** Proposals 1, 3, 4 are hook/script gates (chore #89's preferred shape). Proposal 2 is a textual rule added inside an existing structural gate (`<structural-validation>`) — load-bearing because that gate is already always-on and lead-enforced rather than LLM-delegated, so adding a mechanical rule (f) inherits the always-on enforcement rather than the override-prone Stage A surface. None propose "add a bullet to plan-author instructions" or "add a hard invariant in SKILL.md" — those are exactly the textual protocols chore #89 documented as bypass-prone, and scholar's bug class shows the same vulnerability extending past HAG-on-irreversible-ops to defect detection generally.
approve

