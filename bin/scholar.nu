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

# Resolve the M2 server invocation. The slim-plugin pivot (2026-06-01) dropped
# the compiled `mcp-scholar` binary; scholar now runs as `bun dist/server.js`,
# dispatched in CLI mode via `--call <tool> <json>` (see src/server/index.ts).
# Resolution order:
#   1. SCHOLAR_SERVER_CMD — space-separated override (test/operator escape hatch,
#      mirrors SCHOLAR_PDF_ENTRYPOINT / SCHOLAR_BUN_PATH / SCHOLAR_VEC0_PATH).
#   2. the provisioned bun (${CLAUDE_PLUGIN_DATA}/bun/bun) running
#      ${CLAUDE_PLUGIN_ROOT}/dist/server.js, located relative to this module
#      (nu/scholar.nu → plugin root); falls back to a PATH `bun` for dev.
def server-cmd []: nothing -> list<string> {
  if 'SCHOLAR_SERVER_CMD' in $env {
    return ($env.SCHOLAR_SERVER_CMD | split row ' ' | where {|t| $t | is-not-empty })
  }
  let root = ($SELF | path dirname | path dirname)
  let provisioned = ($env.CLAUDE_PLUGIN_DATA? | default '' | path join 'bun' 'bun')
  let bun = if ($provisioned | path exists) { $provisioned } else { 'bun' }
  [$bun ($root | path join 'dist' 'server.js')]
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
