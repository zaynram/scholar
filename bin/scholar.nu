#!/usr/bin/env -S nu --stdin
# usage: nu scholar.nu

const DIR = path self .

## --- HELPERS --- ##

# Retrieval method with respect to the type of the input value.
#
# String input will return the input directly.
# Table and record input will access the provided columns via `--mode` and return the result.
def --wrapped extract [
  ...rest: string
  --default: any = null # Value to substitute for empty or null input data
  --mode: string = get # 'get' | 'select'
]: [
  string -> string
  oneof<list, table> -> oneof<list, table>
  record -> oneof<any, record>
] {
  let base = $in | default --empty $default
  if ($base | describe) == string { $base } else if $mode == select {
    $base | select --optional ...$rest
  } else {
    $base | get --optional $rest.0 ...($rest | skip 1)
  }
}

# Wrap data retrieved using `extract` in a record with `tool` as the key.
def wrap [
  tool: string
  ...keys: string
]: oneof<string, table, record> -> record {
  let value = if ($keys | is-empty) { $in } else { $in | extract ...$keys }
  return {($tool | split row . | last): $value}
}

# The pinned bun whose bun:sqlite ABI matches the vendored vec0 build.
# Parses the package.json `scholar.bundledBunVersion` to ensure synchronization.
def "resolve bun" [--bun: path = bun ...roots: string]: nothing -> list<string> {
  let file: string = [
    ($DIR | path basename --replace package.json)
    ($DIR | path dirname | path basename --replace package.json)
    ...($roots | each { path join package.json })
  ] | where ($it | path type) == file | first
  let version: string = try {
    open $file | get scholar.bundledBunVersion
  } | default 1.3.11
  let current = run-external $bun `--version` out+err>|
    | to text
    | str trim
  if $current =~ $version { [$bun] } else { [bunx $'bun@($version)'] }
}

# Resolve the build directory and return the absolute path to `server.js`.
def "resolve js" [...roots: string]: nothing -> string {
  let dist: string = [
    ($DIR | path basename --replace dist)
    ($DIR | path dirname | path basename --replace dist)
    ...($roots | each { path join dist })
  ] | where ($it | path type) == dir | first
  if $dist != null { $dist | path join server.js } else {
    error make --unspanned 'unable to resolve build output directory'
  }
}

## --- COMMANDS --- ##

# Run a `tool` from the `scholar` MCP server.
# Parameters may be provided as the `json` argument or by piping in a string or record.
def main [
  tool: string # Name of the MCP server tool
  json: string = '{}' # Argument payload as a JSON string
]: oneof<nothing, string, record> -> oneof<table, record> {
  let json: string = match ($in | describe) {
    string => $in
    record => { $in | to json --raw }
  } | default $json

  let args: list<string> = match $env {
    {SCHOLAR_SERVER_CMD: $c} => { $c | split row ' ' | compact --empty }
    {
      CLAUDE_PLUGIN_DATA: $d
      CLAUDE_PLUGIN_ROOT: $r
    } => { resolve bun --bun ($d | path join bun bun) $r | append [run (resolve js $r)] }
    _ => { resolve bun | append [run (resolve js)] }
  } | append [--call $tool $json]

  let output = run-external ...$args | complete | default 0 exit_code

  # Streams stay isolated: the server writes its JSON result to stdout and its
  # structured logs + error payload to stderr. Take the LAST non-empty line of
  # the relevant stream and deserialize once (deduplicated). On stdout this also
  # defends against a bunx provisioning preamble ("Saved lockfile") prepended to
  # the result; on stderr the error record trails the log lines.
  let raw: string = (if $output.exit_code == 0 { $output.stdout? } else { $output.stderr? })
    | default ''
    | lines
    | where ($it | str trim | is-not-empty)
    | last
    | default '{}'

  let parsed = try {
    $raw | from json
  } catch {
    error make --unspanned {
      msg: "unable to parse tool output as JSON"
      code: `scholar::main::json_decode_error`
    }
  }

  if $output.exit_code == 0 { return $parsed } else {
    let info: string = if $parsed.tool? != null {
      $"tool '($parsed.tool)' exited with errors"
    } else {
      $'tool call exited with code ($output.exit_code)'
    }
    let code: string = $'scholar::main::($parsed.error? | default unknown_tool_error)'
    error make --unspanned {msg: $info code: $code}
  }
}

# List papers in the active corpus.
def "main list" [
  --limit: int = 50 # Maximum number of results to return
  --query: string = '' # Filter string to query results with
]: nothing -> oneof<table, string> {
  let res = {q: $query limit: $limit}
    | main scholar.papers.search
    | extract --mode select hits still_indexing
  if ($res | describe) == string { return $res }
  if ($res.still_indexing | default --empty false) {
    print --stderr "note: semantic index still building; results are lexical only"
  }
  $res.hits | extract --mode select --default [] id title score
}

# Show the status for a corpus.
def "main status" [
  corpus?: string # The identifier of a corpus to target (defaults to active)
]: nothing -> oneof<table, string> {
  {corpus_id: $corpus}
  | compact
  | default --empty null
  | main scholar.corpus.status
}

# Ingest papers from BibTeX/DOI/arXiv.
# Routes to scholar.ingest.{bibtex,doi,arxiv}.
def "main ingest" [
  --bibtex: string # Path to a BibTeX paper to ingest
  --doi: string # Direct DOI of a paper to ingest
  --arxiv: string # arXiv identifier of a paper to ingest
]: nothing -> record {
  let queue: table = [
    [tool args keys];
    [scholar.ingest.bibtex {filePath: $bibtex} [imported]]
    [scholar.ingest.doi {doi: $doi} []]
    [scholar.ingest.arxiv {id: $arxiv} []]
  ] | where ($it.args | compact | is-not-empty)

  if ($queue | is-empty) { error make "one of `--bibtex`, `--doi`, `--arxiv` is required" }

  $queue
  | each {|row| get args | main $row.tool | wrap $row.tool ...$row.keys }
  | into record
  | compact --empty
}

# Search papers (hybrid lexical + semantic via RRF — mode always-on, no mode arg).
# still_indexing=true signals semantic is building; lexical results are returned in the interim.
def "main query" [
  q: string # The query string to match results to
  --limit: int = 50 # Maximum number of entries to return
]: nothing -> oneof<table, string> { main list --limit $limit --query $q }

# Generate digest on a scoped set of papers.
# By default, all papers are included.
def "main digest" [
  --stale # Include only stale papers
  --label: string # Include papers by section label
  --hash: string # Include papers by selection hash
  --claude # Use Claude for running the inference instead of Ollama
]: nothing -> string {
  {use_claude: $claude}
  | insert scope_key {
    match {label: $label hash: $hash stale: $stale} {
      {stale: true} => 'stale'
      {label: null hash: null} => 'all'
      {label: $l hash: null} => $'section:($l)'
      {label: null hash: $h} => $'selection:($h)'
    }
  } | main scholar.digest.generate
  | extract --default '(empty)' body_md
}
