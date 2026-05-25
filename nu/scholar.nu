# nu/scholar.nu — Scholar CLI module. Usage: use nu/scholar.nu *
# Transport: ^scholar --call <tool> <json> (foundation-007, cycle 6.1 dual-mode)
# Prereq: scholar binary on PATH (packaging cycle 6.13)
#
# Contract sources (cross-plan):
#   - extraction-003 lines 1167-1169, 1237 — papers.search args {q, limit?} and result {hits, still_indexing}
#   - extraction-003 lines 1485-1486, 1496 — digest.generate args {scope_key, use_claude?} and result {body_md, askClaude?}
#   - CLAUDE.md load-bearing invariants — SA4 use_claude defaults to false (Ollama default)

# Transport wrapper — exported as `main` so calling the module name
# (`scholar "tool" {args}`) invokes it. Nu forbids exporting a command with
# the same name as the module; `main` is the canonical workaround per nu docs.
# Uses `| complete` to capture stdout/stderr/exit_code as a record.
# Foundation-009 contract: exit_code=0 → stdout=JSON+\n; exit_code!=0 → stderr=structured-error JSON.
# Naïve `^scholar --call ... | from json` loses the error shape on failure.
export def main [
  tool: string       # MCP tool name e.g. "scholar.corpus.activate"
  args: record = {}  # tool arguments as a record
] {
  let payload = ($args | to json)
  let result = (^scholar --call $tool $payload | complete)
  if $result.exit_code != 0 {
    # Reverse-walk stderr to find the first line that is a JSON object with an `error` key.
    # Foundation warn logs may interleave; `lines | last` would grab the wrong line.
    let err_line = (
      $result.stderr
      | lines
      | reverse
      | where { |line| ($line | str trim | str starts-with "{") }
      | first
    )
    let err = (if ($err_line | is-empty) {
      { error: "non_json_stderr", message: $result.stderr }
    } else {
      $err_line | from json
    })
    error make {
      msg: $err.message,
      label: { text: $err.error, span: (metadata $tool).span }
    }
  }
  $result.stdout | from json
}

# List papers in the active corpus (uses ctx.db snapshot — no corpus_id arg).
# Contract (extraction-003 lines 1167-1169, 1237):
#   args: { q: string; limit?: number }  — corpus_id/mode DROPPED
#   result: { hits: SearchHit[]; still_indexing: boolean }
# --status is applied client-side in v1 (search result lacks status field).
export def "scholar list" [
  --status: string   # filter: pending|reading|reviewed|skip (client-side post-filter in v1)
  --limit: int = 50
] {
  let args = {q: "" limit: $limit}
  let res = main "scholar.papers.search" $args
  let hits = ($res | get hits)
  let still_indexing = ($res | get still_indexing)
  if $still_indexing {
    print "Note: semantic index still building — results are lexical only (still indexing)"
  }
  $hits | select id title score
}

# Show corpus status.
export def "scholar status" [--corpus: string] {
  let args = if ($corpus | is-empty) { {} } else { {corpus_id: $corpus} }
  main "scholar.corpus.status" $args
}

# Ingest papers from BibTeX/RIS/DOI/arXiv.
# Routes to scholar.ingest.{bibtex,ris,doi,arxiv}.
export def "scholar ingest" [
  --corpus: string  --bibtex: string  --ris: string
  --doi: string     --arxiv: string
] {
  if not ($bibtex | is-empty) {
    main "scholar.ingest.bibtex" {file_path: $bibtex corpus_id: $corpus} | get imported
  } else if not ($ris | is-empty) {
    main "scholar.ingest.ris" {file_path: $ris corpus_id: $corpus} | get imported
  } else if not ($doi | is-empty) {
    main "scholar.ingest.doi" {doi: $doi corpus_id: $corpus}
  } else if not ($arxiv | is-empty) {
    main "scholar.ingest.arxiv" {arxiv_id: $arxiv corpus_id: $corpus}
  } else {
    error make { msg: "Specify one of: --bibtex, --ris, --doi, --arxiv" }
  }
}

# Search papers (hybrid lexical + semantic via RRF — mode always-on, no mode arg).
# still_indexing=true signals semantic is building; lexical results are returned in the interim.
export def "scholar query" [
  q: string       # search query
  --limit: int = 20
] {
  # args: { q: string; limit?: number } — corpus_id and mode DROPPED per extraction-003 contract
  let res = main "scholar.papers.search" {q: $q limit: $limit}
  if ($res | get still_indexing) {
    print "Note: semantic index still building — results are lexical only (still indexing)"
  }
  $res | get hits | select id title score
}

# Generate digest. scope: "all" | "section:<label>" | "stale" | "selection:<hash>"
# SA4 (CLAUDE.md load-bearing invariant): --claude is opt-in only; default is Ollama
# ("Mechanical LLM → local Ollama … cowork.askClaude is an explicit per-request opt-in
# only — never the default path"). Result field: body_md (extraction-003 line 1496).
export def "scholar digest" [
  --scope: string = "all"  --claude
] {
  # args: { scope_key, use_claude? } — corpus_id DROPPED (per-corpus ctx.db snapshot)
  let res = main "scholar.digest.generate" {scope_key: $scope use_claude: $claude}
  if ($res | get -o askClaude | is-empty) {
    $res | get body_md
  } else {
    "Digest requires Claude opt-in — run with --claude or use the UI in a Cowork host."
  }
}
