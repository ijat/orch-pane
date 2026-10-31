// The part of `orch status --json` (schema 1) this mod reads. Missing data is null.
export type StatusRole = { role: string | null; state: string | null; step: string | null; note: string | null }

export type StatusSpawn = {
  ts: string | null
  role: string | null
  agent: string | null
  tier: string | null
  steps: string[] | null
  milestone: number | null
  returned: boolean
}

export type StatusStep = { id: string; title: string | null; done: boolean; current: boolean; summary: string | null }

export type StatusMilestone = {
  n: number
  goal: string | null
  size: string | null
  state: 'done' | 'current' | 'pending'
  summary: string | null
}

export type StatusTask = {
  id: string
  repo: string | null
  slug: string | null
  task_dir: string | null
  repo_path: string | null
  worktree: string | null
  in_cwd: boolean | null
  state: string
  state_words: string | null
  mode: string | null
  shape: string | null
  program: boolean | null
  milestone: string | null
  milestone_no: number | null
  summary: string | null
  updated: string | null
  last_log: string | null
  questions_open: number | null
  running: { roles: StatusRole[]; last_spawn: StatusSpawn | null }
  steps: {
    total: number | null
    done: number | null
    percent: number | null
    current: string[] | null
    items: StatusStep[]
  }
  milestones: { done: number; total: number | null; items: StatusMilestone[] } | null
  overall: { percent: number | null; estimate: boolean; basis: string }
  error: string | null
}

export type StatusJson = { schema: 1; generated: string; cwd: string | null; tasks: StatusTask[] }

// The part of `orch-index status --json` (schema 1) this mod reads. Missing data is null or absent.
export type IndexStatus = {
  schema: 1
  state: 'none' | 'current' | 'stale' | 'outdated'
  indexing: boolean
  indexed_commit: string | null
  head_commit: string | null
  commits_behind: number | null
  indexed_at: string | null
  db_bytes: number | null
  counts: { files: number; symbols: number; refs: number; includes: number; bases: number; names: number } | null
  parse_error_files: number | null
  parse_error_structural: number | null
  extractor_version?: string | null
  binary_extractor_version?: string | null
  languages?: Record<string, number>
  last_index?: {
    kind: string
    seconds: number
    files_total?: number
    extracted: number
    reused?: number
    files_per_sec?: number
  } | null
  history?: { at: string; kind: string; seconds: number; extracted: number }[]
  usage?: {
    window_days: number
    queries: number
    by_command: Record<string, { n: number; p50_ms: number; p95_ms: number }>
    zero_hit_pct: number
    stale_answer_pct: number
    label_mix: Record<string, number>
    last_query_at: string | null
  } | null
}

// okAt: when the last good fetch landed (an error keeps it). index: the code index of the session folder;
// indexNote says why there is none (orch-index missing, or it failed).
export type Snapshot = {
  data: StatusJson | null
  error: string | null
  fetchedAt: number | null
  okAt: number | null
  index: IndexStatus | null
  indexNote: string | null
}

// A plain-language summary, by the cache key of the text it summarises.
export type PlainEntry = { state: 'pending'; at: number } | { state: 'done'; text: string } | { state: 'error'; reason: string }

// The Ask box's one question and its answer.
export type AskState =
  | { state: 'idle' }
  | { state: 'busy'; question: string; at: number }
  | { state: 'done'; question: string; answer: string }
  | { state: 'error'; question: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'orch-pane': {
      snapshot: Shaped<Snapshot>
      showAll: boolean
      expanded: Record<string, boolean>
      dismissed: boolean
      frame: number
      plain: Record<string, PlainEntry>
      ask: AskState
    }
  }
}
