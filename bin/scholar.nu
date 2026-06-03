#!/usr/bin/env -S nu --stdin
# Usage: nu scholar.nu
const SELF = path self

def --wrapped "safe extract" [
  ...rest: string
  --select # Use `select` over `get`, i.e. to return a table instead of a list
]: oneof<table, string> -> oneof<table, list, string> {
  let value = $in
  if ($value | describe) == string {
    $value
  } else if $select {
    $value | select --optional ...$rest
  } else {
    $value | get --optional $rest.0 ...($rest | skip 1)
  }
}

# The pinned bun whose bun:sqlite ABI matches the vendored vec0 build. Keep in
# sync with package.json `scholar.bundledBunVersion` and bin/ensure-bun.sh PIN.
const BUN_PIN = '1.3.11'

# Resolve the bun runtime that runs dist/server.js. Mirrors the server-side seam
# in src/server/pdf/lifecycle.ts `resolveBunRuntime` (SCHOLAR_BUN_PATH) plus the
# provisioned-runtime path the shell launcher uses. Order:
#   1. SCHOLAR_BUN_PATH — explicit operator override (parity with lifecycle.ts).
#   2. ${CLAUDE_PLUGIN_DATA}/bun/bun — the PINNED runtime bin/ensure-bun.sh lays
#      down; the only ABI guaranteed to load the vendored vec0 extension.
#   3. PATH `bun` — dev fallback. UNPINNED, so it warns: a host bun whose
#      bun:sqlite version differs from the pin can fail to load vec0. This is the
#      item-4 edge — a nu repoint with CLAUDE_PLUGIN_DATA unset previously fell
#      through here silently, giving no signal that the ABI was unpinned.
def resolve-bun []: nothing -> string {
  if ('SCHOLAR_BUN_PATH' in $env) and ($env.SCHOLAR_BUN_PATH | is-not-empty) {
    return $env.SCHOLAR_BUN_PATH
  }
  let provisioned = ($env.CLAUDE_PLUGIN_DATA? | default '' | path join 'bun' 'bun')
  if ($provisioned | path exists) { return $provisioned }
  let ver = (try { ^bun --version | str trim } catch { 'absent' })
  if $ver != $BUN_PIN {
    print --stderr $"scholar: using PATH bun ($ver), not pinned ($BUN_PIN) — vec0 may fail to load. Set CLAUDE_PLUGIN_DATA / SCHOLAR_BUN_PATH / SCHOLAR_SERVER_CMD to pin the runtime."
  }
  'bun'
}

# Resolve the M2 server invocation. The slim-plugin pivot (2026-06-01) dropped
# the compiled `mcp-scholar` binary; scholar now runs as `bun dist/server.js`,
# dispatched in CLI mode via `--call <tool> <json>` (see src/server/index.ts).
# SCHOLAR_SERVER_CMD short-circuits the whole resolution (test/operator escape
# hatch); otherwise the bundle is located relative to this module
# (bin/scholar.nu → plugin root) and run under `resolve-bun`.
def server-cmd []: nothing -> list<string> {
  if 'SCHOLAR_SERVER_CMD' in $env {
    return ($env.SCHOLAR_SERVER_CMD | split row ' ' | where {|t| $t | is-not-empty })
  }
  let root = ($SELF | path dirname | path dirname)
  [(resolve-bun) ($root | path join 'dist' 'server.js')]
}

# Wrapper for the scholar MCP server (M2: `bun dist/server.js --call`).
def main [
  tool?: string # The name of the tool to call on the server
  --json: oneof<record, string> # Parameters to pass through to the tool call
]: oneof<record, string, nothing> -> oneof<string, record, table, nothing> {
  if $tool == null { print --stderr 'tool name is required' | return }
  let args = $in | default $json | default {}
  let payload = if ($args | describe) == 'string' { $args } else { $args | to json --raw }
  let cmd = (server-cmd)
  let output = run-external ($cmd | first) ...($cmd | skip 1) '--call' $tool $payload
    | complete
    | default 0 exit_code
    | default '{}' stdout stderr
  let text = if ($output.exit_code) == 0 { $output.stdout } else { $output.stderr }
  try { $text | str trim | to json --raw } catch { $text }
}

# List papers in the active corpus (uses ctx.db snapshot — no corpus_id arg).
def "main list" [
  --limit: int = 50 # Maximum number of results to return
  --query: string = '' # Filter string to query results with
]: nothing -> oneof<table, string> {
  let res = {q: $query limit: $limit} | main papers.search
  if ($res | describe) == string { return $res }
  if ($res.still_indexing? | default false) {
    print "note: semantic index still building; results are lexical only"
  }
  $res.hits? | default [] | select id title score
}

# Show corpus status.
def "main status" [
  corpus?: string # The identifier of a corpus to target (defaults to active )
]: nothing -> oneof<table, string> {
  if ($corpus | is-empty) { {} } else { {corpus_id: $corpus} }
  | main scholar.corpus.status
}

# Ingest papers from BibTeX/RIS/DOI/arXiv.
# Routes to scholar.ingest.{bibtex,ris,doi,arxiv}.
def "main ingest" [
  corpus: string # The identifier of the corpus to ingest papers into
  --bibtex: string # Path to a BibTeX paper to ingest
  --ris: string # Path to a RIS paper to ingest
  --doi: string # Direct DOI of a paper to ingest
  --arxiv: string # arXiv identifier of a paper to ingest
]: nothing -> oneof<table, string> {
  if ($bibtex | is-not-empty) {
    {file_path: $bibtex corpus_id: $corpus}
    | main scholar.ingest.bibtex
    | safe extract imported
  } else if ($ris | is-not-empty) {
    {file_path: $ris corpus_id: $corpus}
    | main scholar.ingest.ris
    | safe extract imported
  } else if ($doi | is-not-empty) {
    {doi: $doi corpus_id: $corpus}
    | main scholar.ingest.doi
  } else if ($arxiv | is-not-empty) {
    {arxiv_id: $arxiv corpus_id: $corpus}
    | main scholar.ingest.arxiv
  } else {
    error make "one of `--bibtex`, `--ris`, `--doi`, `--arxiv` is required"
  }
}

# Search papers (hybrid lexical + semantic via RRF — mode always-on, no mode arg).
# still_indexing=true signals semantic is building; lexical results are returned in the interim.
def "main query" [
  q: string # The query string to match results to
  --limit: int = 50 # Maximum number of entries to return
]: nothing -> oneof<table, string> {
  # args: { q: string; limit?: number } — corpus_id and mode DROPPED per extraction-003 contract
  main list --limit $limit --query $q
}

# Generate digest on a scoped set of papers.
def "main digest" [
  --all # Include all papers (default)
  --stale # Include only stale papers
  --label: string # Include papers by section label
  --hash: string # Include papers by selection hash
  --claude # Use Claude for running the inference instead of Ollama
]: nothing -> string {
  let scope = match {all: $all stale: $stale section: $label selection: $hash} {
    {all: true} => 'all'
    {stale: true} => 'stale'
    {section: $s} if $s != null => $'section:($s)'
    {selection: $h} if $h != null => $'selection:($h)'
  } | default all
  let res = {scope_key: $scope use_claude: $claude} | main scholar.digest.generate
  if ($res | describe) =~ table and $res.askClaude? == null {
    $res | get --optional body_md | default "(empty body)"
  } else {
    "digest requires claude opt-in; run with `--claude` or use the Cowork host UI."
  }
}
