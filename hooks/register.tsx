import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot, StatusJson, StatusMilestone, StatusStep, StatusTask } from '../types'

const PANE = 'orch-pane'
const TITLE = 'Orchestration'
const POLL_MS = 8000
const RUN_TIMEOUT_MS = 10000

// Change the shape tag when Snapshot's fields change: a value an earlier version stored is then read as EMPTY.
const EMPTY: Snapshot = { data: null, error: null, fetchedAt: null }
const snapshot = atom({ plugin: 'orch-pane', key: 'snapshot' } as const, EMPTY, { shape: 'snap-1' })
const showAll = atom({ plugin: 'orch-pane', key: 'showAll' } as const, false)
const expanded = atom({ plugin: 'orch-pane', key: 'expanded' } as const, {} as Record<string, boolean>)
const dismissed = atom({ plugin: 'orch-pane', key: 'dismissed' } as const, false)

let inFlight = false

const firstLine = (text: string) => (text.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 200)
const errorText = (err: unknown) => firstLine(err instanceof Error ? err.message : String(err))

async function setError($: EngineInterface, error: string) {
  const fetchedAt = await $.clock.now()
  await update($, snapshot, s => ({ ...(s ?? EMPTY), error, fetchedAt }))
}

// Runs `orch status --json` once; the last good data stays when it fails. One run at a time.
async function fetchStatus($: EngineInterface): Promise<StatusJson | null> {
  if (inFlight) return null
  inFlight = true
  try {
    const home = await $.env.get('HOME')
    if (!home) {
      await setError($, 'orch status could not run: HOME is not set')
      return null
    }
    const cwd = await $.session.cwd()
    let ran
    try {
      ran = await $.process.run([`${home}/.claude/bin/orch`, 'status', '--json', '--cwd', cwd], {
        timeoutMs: RUN_TIMEOUT_MS,
      })
    } catch (err) {
      await setError($, `orch status could not run: ${errorText(err)}`)
      return null
    }
    if (ran.exitCode !== 0) {
      await setError($, `orch status failed: ${firstLine(ran.stderr) || `exit ${ran.exitCode}`}`)
      return null
    }
    let data: StatusJson
    try {
      data = JSON.parse(ran.stdout) as StatusJson
    } catch {
      await setError($, 'orch status printed something that is not JSON')
      return null
    }
    if (!data || data.schema !== 1 || !Array.isArray(data.tasks)) {
      await setError($, 'orch status: unsupported output (expected schema 1)')
      return null
    }
    const fetchedAt = await $.clock.now()
    await update($, snapshot, () => ({ data, error: null, fetchedAt }))
    return data
  } finally {
    inFlight = false
  }
}

async function isOpen($: EngineInterface) {
  // Open and drawn: an unasked open below the surface's width waits undrawn (isPlaced false), and is not polled.
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
}

async function refreshIfOpen($: EngineInterface) {
  if (await isOpen($)) await fetchStatus($)
}

// -- drawing helpers -----------------------------------------------------------------------------

function bar(percent: number) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

function elapsed(fromIso: string | null, now: number | null) {
  if (!fromIso || now === null) return null
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return null
  const min = Math.max(0, Math.floor((now - from) / 60000))
  if (min < 60) return `${min}m`
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${min % 60}m`
  return `${Math.floor(min / 1440)}d`
}

const clip = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`

const marker = (state: 'done' | 'current' | 'pending') =>
  state === 'done' ? '✓' : state === 'current' ? '▶' : '·'

const stepState = (s: StatusStep): 'done' | 'current' | 'pending' =>
  s.done ? 'done' : s.current ? 'current' : 'pending'

function overallText(t: StatusTask) {
  const p = t.overall.percent
  if (p === null) return null
  return t.overall.estimate ? `Overall  ~${bar(p)}  ~${p}% estimate` : `Overall  ${bar(p)}  ${p}%`
}

function stepsText(t: StatusTask) {
  const { done, total, percent } = t.steps
  if (total === null || done === null || percent === null) return null
  const label = t.program && t.milestone_no !== null ? `M${t.milestone_no} steps` : 'Steps'
  return `${label}  ${bar(percent)}  ${done}/${total}  ${percent}%`
}

const headPercent = (t: StatusTask) =>
  t.overall.percent === null ? '' : t.overall.estimate ? `~${t.overall.percent}%` : `${t.overall.percent}%`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orch-pane',
      description: 'Show the orchestration tasks of this repo in a pane',
    })
    $.clock.every(POLL_MS, () => void refreshIfOpen($))
    void (async () => {
      const data = await fetchStatus($)
      if (data?.tasks.some(t => t.in_cwd) && !(await read($, dismissed))) {
        await $.ui.open({ id: PANE, title: TITLE })
      }
    })()

    return next(e)
  })

  on('command.run', { command: 'orch-pane' }, async $ => {
    await update($, dismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE })
    await fetchStatus($)

    return { text: 'Orchestration pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refreshIfOpen($)

    return done
  })

  // The pane's only close is the engine's own mark or key (origin `person`): remember it, so a reload's
  // session.start does not open the pane again; /orch-pane still does.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await update($, dismissed, () => true)

    return closed
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const all = await read($, showAll)
    const open = await read($, expanded)
    const width = Math.max(16, e.props.bodyColumns)
    const tasks = (snap.data?.tasks ?? []).filter(t => all || t.in_cwd)
    const isExpanded = (key: string, fallback: boolean) => open[key] ?? fallback
    const toggle = (key: string, fallback: boolean) => () =>
      update($, expanded, m => ({ ...m, [key]: !((m ?? {})[key] ?? fallback) }))

    const summaryBlock = (text: string | null, indent: number) => {
      if (!text) return null
      const [first = '', ...rest] = text.split('\n')
      return (
        <Box flexDirection="column" paddingLeft={indent}>
          <Text dimColor>{`╰ ${first}`}</Text>
          {rest.map(line => (
            <Text dimColor>{`  ${line}`}</Text>
          ))}
        </Box>
      )
    }

    const milestoneRow = (t: StatusTask, m: StatusMilestone) => {
      const key = `ms:${t.id}:${m.n}`
      const size = m.size && m.size !== '-' ? m.size : ''
      const label = clip(`${marker(m.state)} M${m.n} ${m.goal ?? ''}`, width - 6 - size.length)
      return (
        <Box flexDirection="column">
          <Button key={key} plain onPress={toggle(key, false)}>
            {label} <Text dimColor>{size}</Text>
          </Button>
          {isExpanded(key, false) && summaryBlock(m.summary, 2)}
        </Box>
      )
    }

    const stepRow = (t: StatusTask, s: StatusStep) => {
      const key = `step:${t.id}:${s.id}`
      return (
        <Box flexDirection="column">
          <Button key={key} plain onPress={toggle(key, false)}>
            {clip(`${marker(stepState(s))} ${s.id} ${s.title ?? ''}`, width - 4)}
          </Button>
          {isExpanded(key, false) && summaryBlock(s.summary, 2)}
        </Box>
      )
    }

    const runningRows = (t: StatusTask) => {
      const spawn = t.running.last_spawn
      const rows = t.running.roles.map(r => {
        const mine = spawn && spawn.role === r.role ? spawn : null
        const head = [`▶ ${r.role ?? '?'}`, mine?.tier, mine?.steps?.length ? `steps ${mine.steps.join(',')}` : null]
        const since = mine && !mine.returned ? elapsed(mine.ts, snap.fetchedAt) : null
        const tail = [since ? `running ${since}` : null, r.step ? `last: ${r.step}` : null].filter(Boolean)
        return (
          <Box flexDirection="column">
            <Text>{head.filter(Boolean).join('  ')}</Text>
            {tail.length > 0 && <Text dimColor>{`  ${tail.join(' · ')}`}</Text>}
          </Box>
        )
      })
      if (rows.length === 0 && spawn) {
        const parts = [`last spawn: ${spawn.role ?? '?'}`, spawn.tier, spawn.steps?.length ? `steps ${spawn.steps.join(',')}` : null,
          spawn.returned ? 'returned' : `running ${elapsed(spawn.ts, snap.fetchedAt) ?? ''}`.trim()]
        rows.push(<Text dimColor>{parts.filter(Boolean).join('  ')}</Text>)
      }
      return rows
    }

    const taskBlock = (t: StatusTask) => {
      const key = `task:${t.id}`
      const isOpenTask = isExpanded(key, t.in_cwd === true)
      const facts = [t.mode, t.shape, t.milestone].filter(Boolean).join(' · ')
      const steps = stepsText(t)
      const overall = overallText(t)
      const milestones = t.milestones?.items ?? []
      return (
        <Box flexDirection="column" marginTop={1}>
          <Button key={key} plain onPress={toggle(key, t.in_cwd === true)}>
            {clip(`${isOpenTask ? '▾' : '▸'} ${t.id}`, width - 24)} <Text dimColor>{`${t.state}  ${headPercent(t)}`}</Text>
          </Button>
          {isOpenTask && (
            <Box flexDirection="column" paddingLeft={2}>
              {facts ? <Text dimColor>{facts}</Text> : null}
              {t.summary && <Text>{t.summary}</Text>}
              {t.error && <Text color="error">{t.error}</Text>}
              {runningRows(t)}
              {steps && <Text>{steps}</Text>}
              {overall && <Text>{overall}</Text>}
              {milestones.length > 0 && <Text bold>Milestones</Text>}
              {milestones.map(m => milestoneRow(t, m))}
              {t.steps.items.length > 0 && (
                <Text bold>{t.program && t.milestone_no !== null ? `Steps (M${t.milestone_no})` : 'Steps'}</Text>
              )}
              {t.steps.items.map(s => stepRow(t, s))}
            </Box>
          )}
        </Box>
      )
    }

    const empty = snap.data && tasks.length === 0
      ? all ? 'No active tasks.' : 'No orchestration task for this folder.'
      : null

    return (
      <Box flexDirection="column">
        <Button key="scope" plain onPress={() => update($, showAll, v => !v)}>
          {all ? '[all tasks]' : '[this repo]'}
        </Button>
        {snap.error && <Text color="error">{snap.error}</Text>}
        {!snap.data && !snap.error && <Text dimColor>Loading…</Text>}
        {empty && <Text dimColor>{empty}</Text>}
        {tasks.map(taskBlock)}
      </Box>
    )
  })
}
