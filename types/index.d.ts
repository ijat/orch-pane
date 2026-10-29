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
  in_cwd: boolean | null
  state: string
  mode: string | null
  shape: string | null
  program: boolean | null
  milestone: string | null
  milestone_no: number | null
  summary: string | null
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

export type Snapshot = { data: StatusJson | null; error: string | null; fetchedAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    'orch-pane': {
      snapshot: Shaped<Snapshot>
      showAll: boolean
      expanded: Record<string, boolean>
      dismissed: boolean
    }
  }
}
