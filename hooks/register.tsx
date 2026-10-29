import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Snapshot, StatusJson, StatusMilestone, StatusStep, StatusTask } from '../types'
import {
  ago, barCells, barLayout, clip, elapsed, fold, goalLine, hhmm, idleMinutes, isRunning, isStale, lastActivity, mdLite,
  overallTail, scopeLabel, shimmer, sortByAttention, stateColor, stepsTail, stripMarks,
} from './lib'
import type { ItemState, MdLine } from './lib'

const PANE = 'orch-pane'
const TITLE = 'Orchestration'
const POLL_MS = 8000
const RUN_TIMEOUT_MS = 10000

// Change the shape tag when Snapshot's fields change: a value an earlier version stored is then read as EMPTY.
const EMPTY: Snapshot = { data: null, error: null, fetchedAt: null, okAt: null }
const snapshot = atom({ plugin: 'orch-pane', key: 'snapshot' } as const, EMPTY, { shape: 'snap-2' })
const showAll = atom({ plugin: 'orch-pane', key: 'showAll' } as const, false)
const expanded = atom({ plugin: 'orch-pane', key: 'expanded' } as const, {} as Record<string, boolean>)
const dismissed = atom({ plugin: 'orch-pane', key: 'dismissed' } as const, false)
// Animation frame: ticks only while the pane is drawn and a shown task has a role running. It drives the
// spinner (frame % 10) and the running Steps bar's shimmer.
const frame = atom({ plugin: 'orch-pane', key: 'frame' } as const, 0)

const SPIN_MS = 120
const FRAME_WRAP = 3600
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

let inFlight = false

const firstLine = (text: string) => (text.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 200)
const errorText = (err: unknown) => firstLine(err instanceof Error ? err.message : String(err))

async function setError($: EngineInterface, error: string) {
  const fetchedAt = await $.clock.now()
  // okAt, the last good fetch, stays.
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
    await update($, snapshot, () => ({ data, error: null, fetchedAt, okAt: fetchedAt }))
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

async function spinIfRunning($: EngineInterface) {
  const [snap, all] = [await read($, snapshot), await read($, showAll)]
  const busy = (snap.data?.tasks ?? []).some(t => (all || t.in_cwd) && isRunning(t))
  if (busy && (await isOpen($))) await update($, frame, n => ((n ?? 0) + 1) % FRAME_WRAP)
}

// -- drawing helpers -----------------------------------------------------------------------------

const markerColor = (state: ItemState) => (state === 'done' ? 'success' : state === 'current' ? 'claude' : undefined)

const marker = (state: ItemState) => (state === 'done' ? '✓' : state === 'current' ? '▶' : '·')

const stepState = (s: StatusStep): ItemState => (s.done ? 'done' : s.current ? 'current' : 'pending')

const percentText = (t: StatusTask) => (t.overall.percent === null ? '' : `${t.overall.percent}%`)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

type Bar = { label: string; percent: number; tail: string; kind: 'steps' | 'overall'; estimate: boolean }

function bars(t: StatusTask): Bar[] {
  const out: Bar[] = []
  const { done, total, percent } = t.steps
  if (total !== null && done !== null && percent !== null) {
    const label = t.program && t.milestone_no !== null ? `M${t.milestone_no} steps` : 'Steps'
    out.push({ label, percent, tail: stepsTail(percent, done, total), kind: 'steps', estimate: false })
  }
  const p = t.overall.percent
  if (p !== null) {
    out.push({ label: 'Overall', percent: p, tail: overallTail(p, t.overall.estimate), kind: 'overall', estimate: t.overall.estimate })
  }
  return out
}

// Adjacent cells of one colour drawn as one run.
function colourRuns(colours: string[]) {
  const runs: { color: string; n: number }[] = []
  for (const c of colours) {
    const last = runs[runs.length - 1]
    if (last && last.color === c) last.n += 1
    else runs.push({ color: c, n: 1 })
  }
  return runs
}

// Minutes as elapsed() writes them ("12m", "2h 5m", "3d").
const minutesText = (min: number, now: number) => elapsed(new Date(now - min * 60000).toISOString(), now)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orch-pane',
      description: 'Show the orchestration tasks of this repo in a pane',
    })
    $.clock.every(POLL_MS, () => void refreshIfOpen($))
    $.clock.every(SPIN_MS, () => void spinIfRunning($))
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
    const tick = await read($, frame)
    const spin = SPINNER[tick % SPINNER.length]
    const now = snap.fetchedAt
    const width = Math.max(16, e.props.bodyColumns)
    // Task content sits 2 in and a section's rows 2 more; an item's summary is 2 in from its row.
    const room = width - 4
    const everyTask = snap.data?.tasks ?? []
    const tasks = sortByAttention(everyTask.filter(t => all || t.in_cwd), now)
    const elsewhere = everyTask.filter(t => t.in_cwd !== true).length
    const isExpanded = (key: string, fallback = false) => open[key] ?? fallback
    const toggle = (key: string, fallback = false) => () =>
      update($, expanded, m => ({ ...m, [key]: !((m ?? {})[key] ?? fallback) }))

    const mdRow = (l: MdLine) => (
      <Text>
        {l.lead}
        {l.runs.map(r => (
          <Text color={r.code ? 'permission' : undefined} bold={r.bold || r.key ? true : undefined}>{r.text}</Text>
        ))}
      </Text>
    )

    const summaryBlock = (text: string | null, cols: number) =>
      text ? <Box flexDirection="column" paddingLeft={2}>{mdLite(text, cols - 2).map(mdRow)}</Box> : null

    const section = (title: string, rows: RenderChildren[], extra?: string) => {
      const shown = rows.filter(Boolean)
      if (shown.length === 0) return null
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold color="suggestion">{title}</Text>
            {extra ? <Text dimColor>{`  ${extra}`}</Text> : null}
          </Text>
          <Box flexDirection="column" paddingLeft={2}>
            {shown}
          </Box>
        </Box>
      )
    }

    const barRow = (t: StatusTask, b: Bar, layout: { labelW: number; barW: number }) => {
      const filled = barCells(b.percent, layout.barW)
      const cells =
        b.kind === 'overall'
          ? [<Text color="claude">{'█'.repeat(filled)}</Text>]
          : isRunning(t)
            ? colourRuns(shimmer(filled, tick)).map(r => <Text color={r.color}>{'█'.repeat(r.n)}</Text>)
            : [<Text color="success">{'█'.repeat(filled)}</Text>]
      return (
        <Text>
          <Text bold>{b.label.padEnd(layout.labelW)}</Text>
          {filled > 0 ? cells : null}
          <Text dimColor>{'░'.repeat(layout.barW - filled)}</Text>
          <Text color={b.estimate ? undefined : b.kind === 'overall' ? 'claude' : 'success'} dimColor={b.estimate}>
            {`  ${b.tail}`}
          </Text>
        </Text>
      )
    }

    const markerText = (state: ItemState, running: boolean) => (
      <Text color={markerColor(state)} dimColor={state === 'pending'}>
        {state === 'current' && running ? spin : marker(state)}
      </Text>
    )

    const milestoneRow = (t: StatusTask, m: StatusMilestone) => {
      const key = `ms:${t.id}:${m.n}`
      const size = m.size && m.size !== '-' ? m.size : ''
      const label = clip(`M${m.n} ${stripMarks(m.goal ?? '')}`, room - 4 - size.length)
      return (
        <Box flexDirection="column">
          <Button key={key} plain onPress={toggle(key)}>
            {markerText(m.state, false)} <Text dimColor={m.state === 'pending'} bold={m.state === 'current'}>{label}</Text>{' '}
            <Text color="subtle">{size}</Text>
          </Button>
          {isExpanded(key) && summaryBlock(m.summary, room)}
        </Box>
      )
    }

    const stepRow = (t: StatusTask, s: StatusStep) => {
      const key = `step:${t.id}:${s.id}`
      const state = stepState(s)
      return (
        <Box flexDirection="column">
          <Button key={key} plain onPress={toggle(key)}>
            {markerText(state, isRunning(t))}{' '}
            <Text dimColor={state === 'pending'} bold={state === 'current'}>{clip(`${s.id} ${stripMarks(s.title ?? '')}`, room - 2)}</Text>
          </Button>
          {isExpanded(key) && summaryBlock(s.summary, room)}
        </Box>
      )
    }

    // A list folded around its current item. Every fold row and the `▴ fold` row flip one switch; the first
    // fold row carries the switch's own key, the others that key plus their first index (keys stay unique).
    function foldedList<T>(t: StatusTask, list: 'ms' | 'steps', items: T[], stateOf: (x: T) => ItemState,
      idOf: (x: T) => string, row: (x: T) => RenderChildren): RenderChildren[] {
      const key = `fold:${t.id}:${list}`
      const rows = fold(items, stateOf)
      if (!rows.some(r => r.kind !== 'item')) return items.map(row)
      if (isExpanded(key)) {
        return [...items.map(row), <Button key={key} plain onPress={toggle(key)}><Text dimColor>▴ fold</Text></Button>]
      }
      let first = true
      return rows.map(r => {
        if (r.kind === 'item') {
          const item = items[r.index]
          return item === undefined ? null : row(item)
        }
        const k = first ? key : `${key}:${r.from}`
        first = false
        const [a, b] = [items[r.from], items[r.to]]
        if (r.kind === 'done') {
          const range = a === undefined || b === undefined ? '' : `${idOf(a)}–${idOf(b)} `
          return (
            <Button key={k} plain onPress={toggle(key)}>
              <Text color="success">{`✓ ${range}done`}</Text>
            </Button>
          )
        }
        return (
          <Button key={k} plain onPress={toggle(key)}>
            <Text dimColor>{`· ${r.to - r.from + 1} more`}</Text>
          </Button>
        )
      })
    }

    const runningRows = (t: StatusTask) => {
      const spawn = t.running.last_spawn
      const rows = t.running.roles.map(r => {
        const mine = spawn && spawn.role === r.role ? spawn : null
        const since = mine && !mine.returned ? elapsed(mine.ts, now) : null
        // The spawn's own step list is current; a status file's `step` may be an older one.
        const last = r.step && !mine?.steps?.length ? `last: ${r.step}` : null
        const tail = [since ? `running ${since}` : null, last].filter(Boolean)
        return (
          <Box flexDirection="column">
            <Text>
              <Text color="claude">{`${spin} `}</Text>
              <Text bold color="claude">{r.role ?? '?'}</Text>
              {mine?.tier ? <Text color="permission">{`  ${mine.tier}`}</Text> : null}
              {mine?.steps?.length ? <Text color="suggestion">{`  steps ${mine.steps.join(',')}`}</Text> : null}
            </Text>
            {tail.length > 0 && <Text dimColor>{`  ${tail.join(' · ')}`}</Text>}
          </Box>
        )
      })
      if (rows.length === 0 && spawn) {
        const parts = [`last spawn: ${spawn.role ?? '?'}`, spawn.tier, spawn.steps?.length ? `steps ${spawn.steps.join(',')}` : null,
          spawn.returned ? 'returned' : `running ${elapsed(spawn.ts, now) ?? ''}`.trim()]
        rows.push(
          <Text>
            {spawn.returned ? null : <Text color="claude">{`${spin} `}</Text>}
            <Text dimColor>{parts.filter(Boolean).join('  ')}</Text>
          </Text>,
        )
      }
      return rows
    }

    const nowRows = (t: StatusTask) => {
      const act = lastActivity(t)
      const when = act ? ago(act.at, now) : null
      const actText = act ? [act.who, act.text].filter(Boolean).join(' ') + (when ? ` · ${when}` : '') : null
      const idle = now !== null && isStale(t, now) ? idleMinutes(t, now) : null
      return [
        ...runningRows(t),
        actText ? <Text dimColor>{clip(actText, room)}</Text> : null,
        idle !== null && now !== null ? <Text color="warning">{`idle ${minutesText(idle, now)} · nothing running`}</Text> : null,
        t.error ? <Text color="error">{t.error}</Text> : null,
      ]
    }

    // Folded: one clipped line. Open: the summary's markdown-lite lines, the first one on the button.
    const goalRows = (t: StatusTask) => {
      const line = goalLine(t.summary)
      if (!line || !t.summary) return []
      const key = `goal:${t.id}`
      if (!isExpanded(key)) {
        return [
          <Button key={key} plain onPress={toggle(key)}>
            <Text color="subtle">▸ </Text>
            <Text>{clip(line, room - 2)}</Text>
          </Button>,
        ]
      }
      const [head, ...rest] = mdLite(t.summary, room - 2)
      return [
        <Button key={key} plain onPress={toggle(key)}>
          <Text color="subtle">▾ </Text>
          {head ? mdRow(head) : null}
        </Button>,
        rest.length > 0 ? <Box flexDirection="column" paddingLeft={2}>{rest.map(mdRow)}</Box> : null,
      ]
    }

    const taskBlock = (t: StatusTask, index: number) => {
      const key = `task:${t.id}`
      const isOpenTask = isExpanded(key, t.in_cwd === true)
      const color = stateColor(t.state)
      const facts = [t.mode, t.shape, t.milestone].filter(Boolean).join(' · ')
      const name = all ? t.id : (t.slug ?? t.id)
      const questions = t.questions_open ?? 0
      const progress = bars(t)
      const layout = barLayout(room, progress)
      const milestones = t.milestones?.items ?? []
      const steps = t.steps.items
      const msDone = t.milestones?.total ? `${t.milestones.done}/${t.milestones.total} done` : undefined
      return (
        <Box flexDirection="column" marginTop={index === 0 ? 1 : 2}>
          <Button key={key} plain onPress={toggle(key, t.in_cwd === true)}>
            <Text color={color}>{isOpenTask ? '▾' : '▸'}</Text>{' '}
            <Text bold>{clip(name, Math.max(8, width - 30))}</Text>
            {'  '}
            <Text color={color}>{t.state_words ?? t.state}</Text>
            {questions > 0 ? <Text color="warning">{`  ? ${plural(questions, 'question')}`}</Text> : null}
            <Text dimColor>{percentText(t) ? `  ${percentText(t)}` : ''}</Text>
          </Button>
          {isOpenTask && (
            <Box flexDirection="column" paddingLeft={2}>
              {facts ? <Text color="subtle">{facts}</Text> : null}
              {section('Goal', goalRows(t))}
              {section('Now', nowRows(t))}
              {section('Progress', progress.map(b => barRow(t, b, layout)))}
              {milestones.length > 0
                ? section('Milestones', foldedList(t, 'ms', milestones, m => m.state, m => `M${m.n}`, m => milestoneRow(t, m)), msDone)
                : null}
              {steps.length > 0
                ? section(t.program && t.milestone_no !== null ? `Steps (M${t.milestone_no})` : 'Steps',
                  foldedList(t, 'steps', steps, stepState, s => s.id, s => stepRow(t, s)))
                : null}
            </Box>
          )}
        </Box>
      )
    }

    const empty = snap.data && tasks.length === 0
      ? all ? 'No active tasks.' : 'No orchestration task for this folder.'
      : null
    const staleSince = snap.error && snap.data ? (snap.okAt ?? snap.fetchedAt) : null

    return (
      <Box flexDirection="column">
        <Button key="scope" plain onPress={() => update($, showAll, v => !v)}>
          <Text color="suggestion">{scopeLabel(all, elsewhere)}</Text>
        </Button>
        {staleSince !== null && <Text color="warning">{`stale since ${hhmm(staleSince)}`}</Text>}
        {snap.error && <Text color="error">{snap.error}</Text>}
        {!snap.data && !snap.error && <Text dimColor>Loading…</Text>}
        {empty && <Text dimColor>{empty}</Text>}
        {tasks.map(taskBlock)}
      </Box>
    )
  })
}
