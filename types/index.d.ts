// The part of `orch status --json` (schema 1) this mod reads. Missing data is null.
export type StatusRole = {
  role: string | null
  state: string | null
  step: string | null
  note: string | null
  pct?: number | null
}

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

// One parked question of `orch status --json`. An orch from before the questions block has none of this.
export type StatusOption = { label: string; text: string | null; kind: string | null; recommended: boolean }

export type StatusQuestion = {
  id: string
  n: number
  status: string
  text: string
  topic: string | null
  group: string | null
  reversible: string | null
  // Several options may be picked; the answer is the chosen labels joined by `|`. Absent in an orch from before multi-select.
  multi?: boolean
  blocks: string | null
  asked_by: string | null
  asked: string | null
  options: StatusOption[]
  answer: string | null
  answered: string | null
  // `full`, or `compact` / `minimal` once the list's byte budget is spent: those two carry no options. An answered
  // question past the newest few of the history is `history`: no options, but its answer, time and topic.
  detail?: 'full' | 'compact' | 'minimal' | 'history'
}

export type StatusQuestions = {
  counts: { open: number; answered: number; assumed: number; withdrawn: number }
  groups: { group: string | null; label: string; counts: { open: number; answered: number; assumed: number; withdrawn: number } }[]
  open_group: string | null
  open: StatusQuestion[]
  history: StatusQuestion[]
  history_total: number
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
  // Absent on an orch older than the questions block.
  questions?: StatusQuestions | null
  running: { roles: StatusRole[]; last_spawn: StatusSpawn | null; spawns?: StatusSpawn[] }
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
    by_command: Record<string, { n: number; p50_ms: number; p95_ms: number }> | null
    zero_hit_pct: number
    stale_answer_pct: number
    // null until a query carries a trust label (orch-index reports it so after a fresh index).
    label_mix: Record<string, number> | null
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
  about?: About | null
}

// One installed part: version and commit, or `installed: false`. commit is null when the part does not record one.
export type AboutPart = { name: string; installed: boolean; version: string | null; commit: string | null }
export type About = AboutPart[]

// A plain-language summary, by the cache key of the text it summarises.
export type PlainEntry = { state: 'pending'; at: number } | { state: 'done'; text: string } | { state: 'error'; reason: string }

// The Ask box's one question and its answer.
export type AskState =
  | { state: 'idle' }
  | { state: 'busy'; question: string; at: number }
  | { state: 'done'; question: string; answer: string }
  | { state: 'error'; question: string; reason: string }

// The folded bottom panel's open tab; null is all folded.
export type Tab = 'history' | 'ask' | 'more'

// An unsent answer, per task and question id (kept in $.store, D5). `answer` is what Next recorded: the option's
// label or the typed text. Only a confirmed draft is sent.
export type Draft = {
  pick: string | null
  custom: string | null
  confirmed: boolean
  skipped: boolean
  group: string | null
  answer: string | null
}
export type Drafts = Record<string, Record<string, Draft>>

// What the answering panel remembers between draws: the open question and the open group of each task, the order
// the questions joined the queue, other groups' questions fetched on demand, and what a Send said.
export type QState = {
  current: Record<string, string | null>
  group: Record<string, string | null>
  order: Record<string, string[]>
  fetched: Record<string, StatusQuestion[]>
  // Full entries (options and all) fetched with `--question-skip` for questions the status block drew without them.
  full: Record<string, StatusQuestion>
  sending: Record<string, boolean>
  error: Record<string, string | null>
}

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
      tab: Tab | null
      ai: boolean
      notify: boolean
      compactSend: boolean
      auto: boolean
      drafts: Shaped<{ loaded: boolean; byTask: Drafts }>
      qstate: QState
      hist: { query: string; page: number }
    }
  }
}
