import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import {
  askContext, barCells, barLayout, fold, goalLine, hhmm, idleMinutes, isStale, lastActivity, lineText, mdLite,
  bytesText, indexDetails, indexHeadline, indexLook, overallTail, parseIndex, plainInput, scopeLabel, shimmer,
  sortByAttention, sparkline, stepsTail, textKey,
} from '../hooks/lib'
import type { ItemState, MdLine } from '../hooks/lib'
import type { IndexStatus, StatusTask } from '../types'

const NOW = Date.parse('2026-10-29T10:30Z')

const PANE = {
  plugin: 'orch-pane',
  component: 'Pane',
  requestId: 'orch-pane',
  props: {
    title: 'Orchestration',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const PROGRAM = {
  id: 'app/build', repo: 'app', slug: 'build', task_dir: '~/x', repo_path: '/proj', worktree: null,
  in_cwd: true, state: 'implementing', state_words: 'Building', mode: 'standard', shape: 'roadmap', program: true,
  milestone: 'M2 (two)', milestone_no: 2, summary: '- goal: build the app', updated: null, last_log: null,
  questions_open: 0,
  running: {
    roles: [{ role: 'implementer', state: 'in_progress', step: '1', note: 'working on step(s) 2' }],
    last_spawn: { ts: '2026-10-29T10:18Z', role: 'implementer', agent: 'orch-implementer', tier: 'sonnet/high',
                  steps: ['2'], milestone: 2, returned: false },
  },
  steps: {
    plan: '~/x/m02-two/plan.md', total: 2, done: 1, percent: 50, current: ['2'],
    items: [
      { id: '1', title: 'first step', done: true, current: false, summary: 'change thing 1' },
      { id: '2', title: 'second step', done: false, current: true, summary: 'change thing 2\nand more' },
    ],
  },
  milestones: {
    done: 1, total: 3,
    items: [
      { n: 1, goal: 'first', size: 'S', state: 'done', summary: 'first' },
      { n: 2, goal: 'second', size: 'L', state: 'current', summary: 'second\nreview: code · size: L' },
      { n: 3, goal: 'third', size: 'M', state: 'pending', summary: 'third' },
    ],
  },
  overall: { percent: 43, estimate: true, basis: 'milestone size (S=1 M=2 L=4)' },
  error: null,
}

const OTHER = {
  ...PROGRAM, id: 'other/fix', repo: 'other', slug: 'fix', in_cwd: false, program: false, shape: 'single',
  milestone: null, milestone_no: null, milestones: null, summary: 'fix other',
  running: { roles: [], last_spawn: null },
  steps: { plan: null, total: null, done: null, percent: null, current: null, items: [] },
  overall: { percent: null, estimate: false, basis: 'steps' },
}

const OUTPUT = JSON.stringify({ schema: 1, generated: '2026-10-29T10:30Z', cwd: '/proj', tasks: [PROGRAM, OTHER] })

type Ran = { exitCode: number; stdout: string; stderr: string }
type World = { runs: string[][]; indexRuns: string[][]; opens: number; paneOpen: boolean; placed: boolean; result: Ran; index: Ran }

const INDEX: IndexStatus = {
  schema: 1, state: 'stale', indexing: false, indexed_commit: '2a465daf7c7c8793', head_commit: 'd5eb5b06fbd77be7',
  commits_behind: 3, indexed_at: '2026-10-29T10:27:00Z', db_bytes: 1503238554,
  counts: { files: 485942, symbols: 1200000, refs: 9000000, includes: 800000, bases: 5000, names: 70000 },
  parse_error_files: 12, parse_error_structural: 2, languages: { cpp: 400000, rust: 85942 },
  last_index: { kind: 'incremental', seconds: 0.9, extracted: 200, reused: 485742, files_per_sec: 222.2 },
  history: [
    { at: '2026-10-29T10:27:00Z', kind: 'incremental', seconds: 0.9, extracted: 200 },
    { at: '2026-10-29T09:00:00Z', kind: 'full', seconds: 9, extracted: 1000 },
  ],
  usage: {
    window_days: 7, queries: 412, by_command: { def: { n: 200, p50_ms: 4, p95_ms: 31 } }, zero_hit_pct: 8,
    stale_answer_pct: 12.5, label_mix: { resolved: 0.31, syntactic: 0.69 }, last_query_at: '2026-10-29T10:20:00Z',
  },
}
const INDEX_RAN: Ran = { exitCode: 0, stdout: JSON.stringify(INDEX), stderr: '' }

// The engine beneath the plugin: env, cwd, the command, panes, and `orch status` itself.
// `env` replaces the environment.
function world(on: On, result: Ran = { exitCode: 0, stdout: OUTPUT, stderr: '' },
               env: Record<string, string> = { HOME: '/home/u' }): World {
  const w: World = { runs: [], indexRuns: [], opens: 0, paneOpen: true, placed: true, result, index: INDEX_RAN }
  mock.env(on, env)
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'orch-pane' } }))
  on('ui.open', () => {
    w.opens += 1
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: w.paneOpen
      ? [{ id: 'orch-pane', title: 'Orchestration', isShown: w.placed, isFocused: false, isPlaced: w.placed }]
      : [],
  }))
  on('process.run', (_, e) => {
    const isIndex = e.argv.some(a => /orch-index(\.exe)?$/.test(a))
    ;(isIndex ? w.indexRuns : w.runs).push([...e.argv])
    const ran = isIndex ? w.index : w.result
    return { value: { ...ran, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.complete', () => ({ text: '' }))
  return w
}

async function start($: Engine, clock: MockClock) {
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await clock.settle()
}

test('shows the repo task with bars, markers and the running line, on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($, clock)
  expect(w.runs).toEqual([['/home/u/.claude/bin/orch', 'status', '--json', '--cwd', '/proj']])
  expect(w.indexRuns).toEqual([['/home/u/.claude/bin/orch-index', 'status', '--json', '--repo', '/proj']])
  expect(w.opens).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /M2 steps/ }))?.text).toBe('M2 steps  ████████████░░░░░░░░░░░░   50%  1/2')
    expect((await ui.find({ type: 'Text', text: /Overall/ }))?.text).toBe('Overall   ██████████░░░░░░░░░░░░░░   43%  estimate')
    expect((await ui.find({ type: 'Text', text: /implementer/ }))?.text).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] implementer  sonnet\/high  steps 2$/)
    // The spawn lists its steps, so the status file's older `last: 1` is left out.
    expect((await ui.find({ type: 'Text', text: /running/ }))?.text).toBe('  running 12m')
    expect((await ui.find({ type: 'Button', key: 'ms:app/build:1' }))?.text).toMatch(/^✓ M1 first/)
    expect((await ui.find({ type: 'Button', key: 'ms:app/build:2' }))?.text).toMatch(/^▶ M2 second.*L/)
    expect((await ui.find({ type: 'Button', key: 'ms:app/build:3' }))?.text).toMatch(/^· M3 third/)
    expect((await ui.find({ type: 'Button', key: 'step:app/build:2' }))?.text).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2 second step/)
    expect(await ui.find({ type: 'Button', key: 'task:other/fix' })).toBeUndefined()
    await ui.unmount()
  }
})

test('on Windows it runs orch through python from USERPROFILE, not HOME', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, undefined, { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\u', HOME: '/c/Users/u' })
  await start($, clock)
  expect(w.runs).toEqual([['python', 'C:/Users/u/.claude/bin/orch', 'status', '--json', '--cwd', '/proj']])
  expect(w.indexRuns).toEqual([['C:/Users/u/.claude/bin/orch-index.exe', 'status', '--json', '--repo', '/proj']])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /could not run/ })).toBeUndefined()
  await ui.unmount()
})

test('the scope button shows and hides the other tasks', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'scope' })
    expect((await ui.find({ type: 'Button', key: 'task:other/fix' }))?.text).toMatch(/other\/fix/)
    await ui.press({ key: 'scope' })
    expect(await ui.find({ type: 'Button', key: 'task:other/fix' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a step row expands to its summary and folds again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /change thing 2/ })).toBeUndefined()
    await ui.press({ key: 'step:app/build:2' })
    expect((await ui.find({ type: 'Text', text: /change thing 2/ }))?.text).toBe('change thing 2')
    expect((await ui.find({ type: 'Text', text: /and more/ }))?.text).toBe('and more')
    await ui.press({ key: 'step:app/build:2' })
    expect(await ui.find({ type: 'Text', text: /change thing 2/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a failing orch status shows its error line', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, { exitCode: 1, stdout: '', stderr: "orch: invalid choice: 'status'\nusage: …" })
  await start($, clock)
  expect(w.opens).toBe(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /orch status failed/ }))?.text).toBe(
      "orch status failed: orch: invalid choice: 'status'",
    )
    await ui.unmount()
  }
})

test('polls every 8 s only while the pane is open', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($, clock)
  expect(w.runs.length).toBe(1)
  await clock.advance(8000)
  expect(w.runs.length).toBe(2)
  w.paneOpen = false
  await clock.advance(8000)
  expect(w.runs.length).toBe(2)
})

test('the running spinner turns while open and a role runs, and stops when idle or closed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const glyph = async () => (await ui.find({ type: 'Text', text: /implementer/ }))?.text?.[0]
  const first = await glyph()
  await clock.advance(120)
  const second = await glyph()
  expect(second).not.toBe(first)
  w.paneOpen = false
  await clock.advance(360)
  expect(await glyph()).toBe(second)
})

test('an idle task does not spin', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const idle = JSON.stringify({ schema: 1, generated: '2026-10-29T10:30Z', cwd: '/proj', tasks: [{ ...OTHER, in_cwd: true }] })
  world(on, { exitCode: 0, stdout: idle, stderr: '' })
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = (await ui.find({ type: 'Button', key: 'task:other/fix' }))?.text
  await clock.advance(1200)
  expect((await ui.find({ type: 'Button', key: 'task:other/fix' }))?.text).toBe(before)
})

test('an open pane that waits undrawn is not polled', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.placed = false
  await start($, clock)
  expect(w.runs.length).toBe(1)
  await clock.advance(16000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(w.runs.length).toBe(1)
  w.placed = true
  await clock.advance(8000)
  expect(w.runs.length).toBe(2)
})

test('a finished turn refreshes the open pane', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($, clock)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(w.runs.length).toBe(2)
  w.paneOpen = false
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.settle()
  expect(w.runs.length).toBe(2)
})

test('a snapshot an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: { tasks: [] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Loading/ }))?.text).toBe('Loading…')
  await ui.unmount()
})

// -- pure logic (hooks/lib.ts) --------------------------------------------------------------------

const REAL_STEP = 'workspace (edition 2024, `resolver = "3"`, `members = ["crates/*", "services/*"]`, `[workspace.dependencies]` with exact versions, `[workspace.lints]` with `unsafe_code = "forbid"`, clippy pedantic off, `unwrap_used = "deny"` outside tests); toolchain `1.99.1` with rustfmt and clippy; `.gitignore` (`/target`, `/.testkit/`, `.DS_Store`); justfile recipes `ci`, `fmt`, `lint`, `test`, `test-unit`,…'
const REAL_GOAL = "- goal: Chrome extensions run in Luneium on a complete chrome.* API that Luneium builds itself, and LastPass, uBlock\n  Origin and uBO Lite work end to end. Page context menus (ROADMAP Next) come first, with room for extension items.\n- changed:\n  - rev 1: the user's D1 (own layer, complete API) and the acceptance tests;\n  - rev 2: the gate answers and the plan review, including the `LUNEIUM_EXTENSIONS` gate (D28);"

const widest = (lines: MdLine[]) => Math.max(...lines.map(l => lineText(l).length))

test('mdLite: bullets, keys, code and bold marks, nesting', () => {
  const [line, ...rest] = mdLite('- goal: build the app', 40)
  expect(rest).toHaveLength(0)
  expect(line?.lead).toBe('• ')
  expect(line?.runs).toEqual([{ text: 'goal:', key: true }, { text: ' build the app' }])

  const nested = mdLite('- a\n  - b\n    - c', 40)
  expect(nested.map(l => l.lead)).toEqual(['• ', '  • ', '    • '])

  const code = mdLite('use `orch status --json` now', 40)
  expect(code[0]?.runs).toEqual([{ text: 'use ' }, { text: 'orch status --json', code: true }, { text: ' now' }])
  expect(code.map(lineText).join('')).not.toContain('`')

  const bold = mdLite('**bold** text', 40)
  expect(bold[0]?.runs).toEqual([{ text: 'bold', bold: true }, { text: ' text' }])

  expect(mdLite('- **goal:** do it', 40)[0]?.runs[0]).toEqual({ text: 'goal:', key: true })
  expect(lineText(mdLite('an `unclosed tick and **open', 40)[0]!)).toBe('an `unclosed tick and **open')
})

test('mdLite: wraps with hanging indents, hard-breaks long tokens, folds blank runs', () => {
  const long = mdLite(`- ${'word '.repeat(40).trim()}`, 40)
  expect(long.length).toBeGreaterThan(1)
  expect(widest(long)).toBeLessThanOrEqual(40)
  expect(long.slice(1).every(l => l.lead === '  ')).toBe(true)

  const path = mdLite(`x ${'/a'.repeat(35)} y`, 30)
  expect(widest(path)).toBeLessThanOrEqual(30)
  expect(path.map(l => l.runs.map(r => r.text).join('')).join('')).toContain('/a/a')

  const blanks = mdLite('one\n\n\n\ntwo\n\n', 40)
  expect(blanks.map(lineText)).toEqual(['one', '', 'two'])

  const real = mdLite(REAL_STEP, 56)
  expect(widest(real)).toBeLessThanOrEqual(56)
  expect(real.some(l => l.runs.some(r => r.text.includes('`')))).toBe(false)
  expect(real.map(lineText).join(' ')).toContain('test-unit,…')

  for (const width of [12, 20, 33, 56, 80]) expect(widest(mdLite(REAL_GOAL, width))).toBeLessThanOrEqual(width)
  // A source line that continues a bullet joins it.
  expect(lineText(mdLite(REAL_GOAL, 400)[0]!)).toContain('uBlock Origin and uBO Lite')
})

test('goalLine takes the goal bullet, else the first line', () => {
  expect(goalLine('- goal: build the app')).toBe('build the app')
  expect(goalLine('- **goal:** turn `x` into y\n- approach: z')).toBe('turn x into y')
  expect(goalLine(REAL_GOAL)).toMatch(/^Chrome extensions .* uBlock Origin and uBO Lite work end to end\./)
  expect(goalLine('Fix the **thing**\nmore')).toBe('Fix the thing')
  expect(goalLine(null)).toBeNull()
  expect(goalLine('  \n')).toBeNull()
})

const st = (spec: string) => [...spec].map(c => (c === 'd' ? 'done' : c === 'c' ? 'current' : 'pending') as ItemState)
const foldOf = (spec: string) => fold(st(spec), s => s)

test('fold keeps the current item and the next two pending in view', () => {
  expect(foldOf('dddddcpppppp')).toEqual([
    { kind: 'done', from: 0, to: 4 }, { kind: 'item', index: 5 }, { kind: 'item', index: 6 },
    { kind: 'item', index: 7 }, { kind: 'more', from: 8, to: 11 },
  ])
  expect(foldOf('ddpdpppp')).toEqual([
    { kind: 'done', from: 0, to: 1 }, { kind: 'item', index: 2 }, { kind: 'item', index: 3 },
    { kind: 'item', index: 4 }, { kind: 'item', index: 5 }, { kind: 'item', index: 6 }, { kind: 'item', index: 7 },
  ])
  expect(foldOf('dddddd')).toEqual([{ kind: 'done', from: 0, to: 5 }])
  expect(foldOf('dcp')).toEqual([{ kind: 'item', index: 0 }, { kind: 'item', index: 1 }, { kind: 'item', index: 2 }])
  expect(foldOf('')).toEqual([])
  const two = foldOf('ddcdcpppp')
  expect(two.filter(r => r.kind === 'item').map(r => (r as { index: number }).index)).toEqual(expect.arrayContaining([2, 4]))
  // Every index exactly once, in order.
  for (const spec of ['dddddcpppppp', 'ddpdpppp', 'pdpdcdpdpp', 'ccc', 'pppppppp']) {
    const covered = foldOf(spec).flatMap(r => (r.kind === 'item' ? [r.index] : Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i)))
    expect(covered).toEqual([...spec].map((_, i) => i))
  }
})

test('bar layout aligns labels and tails, with no tilde', () => {
  const bars = [{ label: 'M2 steps', tail: stepsTail(50, 1, 2) }, { label: 'Overall', tail: overallTail(43, true) }]
  expect(bars.map(b => b.tail)).toEqual([' 50%  1/2', ' 43%  estimate'])
  expect(barLayout(56, bars)).toEqual({ labelW: 10, barW: 24, tailW: 14 })
  expect(barLayout(30, bars).barW).toBe(10)
  expect(barCells(43, 24)).toBe(10)
  expect(barCells(100, 24)).toBe(24)
  expect(barCells(0, 24)).toBe(0)
  expect(overallTail(100, false)).toBe('100%')
})

test('shimmer moves one cell per frame and repeats', () => {
  expect(shimmer(0, 5)).toEqual([])
  const a = shimmer(12, 7)
  expect(a).toHaveLength(12)
  expect(a.every(c => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  expect(shimmer(12, 7)).toEqual(a)
  expect(shimmer(12, 7 + 18)).toEqual(a)
  for (const filled of [3, 5, 12, 24]) {
    for (let f = 0; f < filled + 7; f++) expect(shimmer(filled, f + 1)).not.toEqual(shimmer(filled, f))
  }
})

const T0 = Date.parse('2026-10-29T10:00Z')
const task = (over: Partial<StatusTask>): StatusTask => ({
  id: 'r/t', repo: 'r', slug: 't', task_dir: null, repo_path: null, worktree: null, in_cwd: true,
  state: 'implementing', state_words: 'Building', mode: null, shape: null, program: false, milestone: null,
  milestone_no: null, summary: null, updated: '2026-10-29T10:00Z', last_log: null, questions_open: 0,
  running: { roles: [], last_spawn: null },
  steps: { total: null, done: null, percent: null, current: null, items: [] },
  milestones: null, overall: { percent: null, estimate: false, basis: '' }, error: null, ...over,
})

test('stale means an active task with nothing running for over 30 minutes', () => {
  expect(isStale(task({}), T0 + 31 * 60000)).toBe(true)
  expect(isStale(task({}), T0 + 29 * 60000)).toBe(false)
  expect(isStale(task({ state: 'awaiting_approval' }), T0 + 300 * 60000)).toBe(false)
  const running = { roles: [{ role: 'implementer', state: 'in_progress', step: null, note: null }], last_spawn: null }
  expect(isStale(task({ running }), T0 + 300 * 60000)).toBe(false)
  expect(idleMinutes(task({ last_log: '2026-10-29T10:20:30Z x: y' }), T0 + 30 * 60000)).toBe(9)
  expect(idleMinutes(task({ updated: null }), T0)).toBeNull()
})

test('tasks needing attention sort first, the rest keep their order', () => {
  const a = task({ id: 'a', state: 'awaiting_approval' })
  const b = task({ id: 'b', state: 'awaiting_approval' })
  const q = task({ id: 'q', state: 'awaiting_approval', questions_open: 2 })
  const e = task({ id: 'e', state: 'awaiting_approval', error: 'bad' })
  expect(sortByAttention([a, b, q, e], T0).map(t => t.id)).toEqual(['q', 'e', 'a', 'b'])
  expect(sortByAttention([a, task({ id: 's' })], T0 + 60 * 60000).map(t => t.id)).toEqual(['s', 'a'])
})

test('lastActivity parses the log line', () => {
  expect(lastActivity(task({ last_log: '2026-10-29T15:17Z implementer: started step(s) 6' }))).toEqual({
    who: 'implementer', text: 'started step(s) 6', at: '2026-10-29T15:17Z',
  })
  expect(lastActivity(task({ last_log: '2026-10-27T07:47Z orchestrator: orchestrator: M4 passed' }))?.text).toBe('M4 passed')
  expect(lastActivity(task({ last_log: '2026-09-28T17:23:19Z orchestrator: CI green' }))?.at).toBe('2026-09-28T17:23:19Z')
  expect(lastActivity(task({}))).toEqual({ who: '', text: 'updated', at: '2026-10-29T10:00Z' })
  expect(lastActivity(task({ updated: null }))).toBeNull()
})

test('hhmm is local wall-clock time', () => {
  const d = new Date(T0)
  expect(hhmm(T0)).toBe(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
})

test('textKey is a stable, versioned hash', () => {
  expect(textKey('abc')).toBe(textKey('abc'))
  expect(textKey('abc')).toMatch(/^p1-[0-9a-f]{14}$/)
  expect(textKey('abd')).not.toBe(textKey('abc'))
  expect(textKey('')).toMatch(/^p1-[0-9a-f]{14}$/)
})

test('askContext drops paths and stays within its limit', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), title: `s${i}`, done: false, current: false, summary: 'x'.repeat(400) }))
  const big = task({ task_dir: '~/secret/dir', repo_path: '/p', steps: { total: 30, done: 0, percent: 0, current: null, items } })
  const full = askContext([big])
  expect(full).not.toContain('task_dir')
  expect(full).toContain('x'.repeat(400))
  const small = askContext([big], 6000)
  expect(small).not.toContain('x'.repeat(400))
  expect(small.length <= 6000 || !small.includes('xxx')).toBe(true)
  expect(JSON.parse(small)[0].steps.items).toHaveLength(30)
})

test('scope label counts the tasks elsewhere', () => {
  expect(scopeLabel(false, 3)).toBe('[this repo · 3 elsewhere]')
  expect(scopeLabel(false, 0)).toBe('[this repo]')
  expect(scopeLabel(true, 3)).toBe('[all tasks]')
})

// -- the redesigned pane ---------------------------------------------------------------------------

const output = (...tasks: unknown[]) => JSON.stringify({ schema: 1, generated: '2026-10-29T10:30Z', cwd: '/proj', tasks })
const PANE60 = (surface: 'terminal' | 'desktop') => ({ ...PANE, surface })

test('the bars line up and carry no tilde', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    const steps = (await ui.find({ type: 'Text', text: /M2 steps/ }))?.text ?? ''
    const overall = (await ui.find({ type: 'Text', text: /^Overall/ }))?.text ?? ''
    expect(steps.search(/[█░]/)).toBe(overall.search(/[█░]/))
    expect(steps.search(/[█░]/)).toBeGreaterThan(0)
    const tailAt = (row: string) => row.lastIndexOf('░') + 1
    expect(tailAt(steps)).toBe(tailAt(overall))
    expect(steps + overall).not.toContain('~')
    expect((await ui.find({ type: 'Button', key: 'task:app/build' }))?.text).not.toContain('~')
    await ui.unmount()
  }
})

test('the header shows state words, slug or id, the questions badge, and the scope count', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { exitCode: 0, stdout: output(PROGRAM, { ...OTHER, questions_open: 2, state: 'awaiting_approval', state_words: 'Waiting for your approval' }), stderr: '' })
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    expect((await ui.find({ type: 'Button', key: 'scope' }))?.text).toBe('[this repo · 1 elsewhere]')
    const head = (await ui.find({ type: 'Button', key: 'task:app/build' }))?.text
    expect(head).toMatch(/^▾ build {2}Building {2}43%$/)
    await ui.press({ key: 'scope' })
    expect((await ui.find({ type: 'Button', key: 'scope' }))?.text).toBe('[all tasks]')
    expect((await ui.find({ type: 'Button', key: 'task:app/build' }))?.text).toMatch(/^▾ app\/build {2}Building/)
    const heads = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('task:'))
    expect(heads.map(b => b.key)).toEqual(['task:other/fix', 'task:app/build'])
    expect(heads[0]?.text).toMatch(/Waiting for your approval {2}\? 2 questions/)
    await ui.press({ key: 'scope' })
    await ui.unmount()
  }
})

test('the Now section shows the last activity and warns when a task stalls', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const stalled = { ...OTHER, in_cwd: true, state: 'implementing', updated: '2026-10-29T09:00Z',
    last_log: '2026-10-29T09:00Z orchestrator: orchestrator: round 2 pass' }
  const busy = { ...PROGRAM, last_log: '2026-10-29T10:18Z implementer: started step(s) 2' }
  world(on, { exitCode: 0, stdout: output(busy, stalled), stderr: '' })
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    expect((await ui.find({ type: 'Text', text: /started step/ }))?.text).toBe('implementer started step(s) 2 · 12m ago')
    expect((await ui.find({ type: 'Text', text: /round 2 pass/ }))?.text).toBe('orchestrator round 2 pass · 1h 30m ago')
    expect((await ui.find({ type: 'Text', text: /^idle/ }))?.text).toBe('idle 1h 30m · nothing running')
    // The stalled task needs attention, so it comes first.
    const heads = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('task:'))
    expect(heads.map(b => b.key)).toEqual(['task:other/fix', 'task:app/build'])
    await ui.unmount()
  }
})

test('a failed fetch after a good one keeps the data and says since when', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($, clock)
  w.result = { exitCode: 1, stdout: '', stderr: 'boom' }
  await clock.advance(8000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    const d = new Date(NOW)
    const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    expect((await ui.find({ type: 'Text', text: /stale since/ }))?.text).toBe(`stale since ${at}`)
    expect((await ui.find({ type: 'Text', text: /orch status failed/ }))?.text).toBe('orch status failed: boom')
    expect(await ui.find({ type: 'Button', key: 'task:app/build' })).toBeDefined()
    await ui.unmount()
  }
})

test('sections have headings and the goal is folded to one line until pressed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const long = { ...PROGRAM, summary: '- goal: build the app with `cargo`\n- approach:\n  - first a **thing**\n  - then another' }
  world(on, { exitCode: 0, stdout: output(long), stderr: '' })
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    for (const h of ['Goal', 'Now', 'Progress', 'Milestones  1/3 done', 'Steps (M2)']) {
      expect(await ui.find({ type: 'Text', text: h })).toBeDefined()
    }
    expect((await ui.find({ type: 'Button', key: 'goal:app/build' }))?.text).toBe('▸ build the app with cargo')
    expect(await ui.find({ type: 'Text', text: /then another/ })).toBeUndefined()
    await ui.press({ key: 'goal:app/build' })
    expect((await ui.find({ type: 'Button', key: 'goal:app/build' }))?.text).toBe('▾ build the app with cargo')
    expect((await ui.find({ type: 'Text', text: /• goal:/ }))?.text).toBe('• goal: build the app with cargo')
    expect((await ui.find({ type: 'Text', text: /first a thing/ }))?.text).toBe('  • first a thing')
    expect((await ui.find({ type: 'Text', text: /then another/ }))?.text).toBe('  • then another')
    await ui.press({ key: 'goal:app/build' })
    await ui.unmount()
  }
})

test('a long step list folds around the current step and opens on press', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const items = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), title: `step ${i + 1}`, done: i < 5, current: i === 5, summary: null }))
  const many = { ...PROGRAM, steps: { ...PROGRAM.steps, total: 12, done: 5, percent: 42, current: ['6'], items } }
  world(on, { exitCode: 0, stdout: output(many), stderr: '' })
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    const steps = async () => (await ui.findAll({ type: 'Button' }))
      .filter(b => b.key?.startsWith('step:') || b.key?.startsWith('fold:app/build:steps')).map(b => b.text)
    expect(await steps()).toEqual(['✓ 1–5 done', expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 6 step 6$/), '· 7 step 7', '· 8 step 8', '· 4 more'])
    await ui.press({ key: 'fold:app/build:steps' })
    const open = await steps()
    expect(open).toHaveLength(13)
    expect(open[12]).toBe('▴ fold')
    await ui.press({ key: 'fold:app/build:steps' })
    expect(await steps()).toHaveLength(5)
    await ui.unmount()
  }
})

const stepColours = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^█+$/ })).map(t => String(t.props.color)).filter(c => c !== 'claude')

test('the Steps bar shimmers while a role runs and is plain when idle', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  const a = await stepColours(ui)
  expect(a.every(c => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  await clock.advance(120)
  const b = await stepColours(ui)
  expect(b).not.toEqual(a)
  // The Overall bar stays one theme colour.
  expect((await ui.findAll({ type: 'Text', text: /^█+$/ })).filter(t => t.props.color === 'claude')).toHaveLength(1)
  await ui.unmount()
})

test('an idle task draws a plain Steps bar', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const idle = { ...PROGRAM, running: { roles: [], last_spawn: null } }
  world(on, { exitCode: 0, stdout: output(idle), stderr: '' })
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  expect(await stepColours(ui)).toEqual(['success'])
  await clock.advance(360)
  expect(await stepColours(ui)).toEqual(['success'])
  await ui.unmount()
})

// -- Haiku: plain summaries and the Ask box ---------------------------------------------------------

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
type Call = { model: string; effort?: string; prompt: string; system?: string }

// The model beneath the plugin: records each call and answers `reply` (a text, or a failure reason).
function haiku(on: On, reply: (prompt: string) => string | { reason: 'api-error' } = () => 'In plain words.') {
  const calls: Call[] = []
  on('model.complete', (_, e) => {
    calls.push({ model: e.model, effort: e.effort, prompt: e.prompt, system: e.system })
    const r = reply(e.prompt)
    return typeof r === 'string'
      ? { value: { isAnswered: true as const, text: r, usage: USAGE } }
      : { value: { isAnswered: false as const, reason: 'api-error' as const, status: 500, error: 'server_error' as const, usage: USAGE } }
  })
  return calls
}

// $.store in memory, in insertion order, as the engine keeps it.
function memStore(on: On, seed: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_, e) => ({ value: map.get(e.key) }))
  on('store.set', (_, e) => {
    map.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    map.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...map.keys()] }))
  return map
}

const STEP2_INPUT = plainInput('step', 'second step', 'change thing 2\nand more')

test('expanding a step asks Haiku once for a plain summary and caches it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const calls = haiku(on)
  const store = memStore(on)
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'step:app/build:2' })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({ model: 'haiku', effort: 'low' })
  expect(calls[0]?.prompt).toContain('change thing 2')
  expect((await ui.find({ type: 'Text', text: /In plain words/ }))?.text).toBe('✦ In plain words.')
  expect(await ui.find({ type: 'Text', text: /change thing 2/ })).toBeUndefined()
  expect(store.get(`plain:${textKey(STEP2_INPUT)}`)).toEqual({ text: 'In plain words.' })
  await ui.press({ key: 'step:app/build:2' })
  await ui.press({ key: 'step:app/build:2' })
  expect(calls).toHaveLength(1)
  // Raw stays reachable.
  await ui.press({ key: 'raw:step:app/build:2' })
  expect((await ui.find({ type: 'Text', text: /change thing 2/ }))?.text).toBe('change thing 2')
  expect((await ui.find({ type: 'Button', key: 'raw:step:app/build:2' }))?.text).toBe('plain')
  await ui.press({ key: 'raw:step:app/build:2' })
  expect((await ui.find({ type: 'Text', text: /In plain words/ }))?.text).toBe('✦ In plain words.')
  await ui.unmount()
})

test('a summary stored by an earlier session is not asked again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const calls = haiku(on)
  memStore(on, { [`plain:${textKey(STEP2_INPUT)}`]: { text: 'From the cache.' } })
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    await ui.press({ key: 'step:app/build:2' })
    expect((await ui.find({ type: 'Text', text: /From the cache/ }))?.text).toBe('✦ From the cache.')
    await ui.press({ key: 'step:app/build:2' })
    await ui.unmount()
  }
  expect(calls).toHaveLength(0)
})

test('a failed summary keeps the raw text and says why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  haiku(on, () => ({ reason: 'api-error' }))
  const store = memStore(on)
  await start($, clock)
  const ui = await $.ui.mount(PANE60('desktop'))
  await ui.press({ key: 'step:app/build:2' })
  expect((await ui.find({ type: 'Text', text: /change thing 2/ }))?.text).toBe('change thing 2')
  expect((await ui.find({ type: 'Text', text: /no plain summary/ }))?.text).toBe('no plain summary: api-error')
  expect(store.size).toBe(0)
  await ui.unmount()
})

test('the goal and milestones get plain summaries too', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const calls = haiku(on, prompt => (prompt.includes('goal') ? 'The app gets built.' : 'Milestone two.'))
  memStore(on)
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  await ui.press({ key: 'goal:app/build' })
  expect((await ui.find({ type: 'Text', text: /The app gets built/ }))?.text).toBe('✦ The app gets built.')
  await ui.press({ key: 'ms:app/build:2' })
  expect((await ui.find({ type: 'Text', text: /Milestone two/ }))?.text).toBe('✦ Milestone two.')
  expect(calls.map(c => c.model)).toEqual(['haiku', 'haiku'])
  await ui.unmount()
})

test('no model call happens at start, on polls or on draws', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const calls = haiku(on)
  memStore(on)
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  await clock.advance(16000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  await ui.press({ key: 'scope' })
  expect(calls).toHaveLength(0)
  await ui.unmount()
})

test('the store keeps the newest 200 summaries', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  haiku(on)
  const seed = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`plain:old${i}`, { text: `t${i}` }]))
  const store = memStore(on, { other: 1, ...seed })
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  await ui.press({ key: 'step:app/build:2' })
  const kept = [...store.keys()].filter(k => k.startsWith('plain:'))
  expect(kept).toHaveLength(200)
  expect(kept).not.toContain('plain:old0')
  expect(kept).toContain('plain:old1')
  expect(kept).toContain(`plain:${textKey(STEP2_INPUT)}`)
  expect(store.get('other')).toBe(1)
  await ui.unmount()
})

test('the Ask box answers a question from the status of the shown tasks', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  const calls = haiku(on, () => 'The implementer is on step 2.')
  memStore(on)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE60(surface))
    expect(await ui.find({ type: 'Text', text: 'Ask' })).toBeDefined()
    expect((await ui.find({ type: 'Input', key: 'ask' }))?.props.placeholder).toBe('Ask about these tasks…')
    await ui.input({ key: 'ask', text: '   ' })
    expect(calls).toHaveLength(0)
    await ui.input({ key: 'ask', text: 'what is running?' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'haiku', effort: 'low' })
    expect(calls[0]?.prompt).toContain('<status>')
    expect(calls[0]?.prompt).toContain('"id":"app/build"')
    expect(calls[0]?.prompt).not.toContain('other/fix')
    expect(calls[0]?.prompt).toMatch(/Question: what is running\?$/)
    expect((await ui.find({ type: 'Text', text: /^Q:/ }))?.text).toBe('Q: what is running?')
    expect((await ui.find({ type: 'Text', text: /implementer is on step 2/ }))?.text).toBe('The implementer is on step 2.')
    await ui.press({ key: 'ask-clear' })
    expect(await ui.find({ type: 'Text', text: /implementer is on step 2/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'ask-clear' })).toBeUndefined()
    calls.length = 0
    await ui.unmount()
  }
})

test('a failed answer says why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  haiku(on, () => ({ reason: 'api-error' }))
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  await ui.input({ key: 'ask', text: 'status?' })
  expect((await ui.find({ type: 'Text', text: /no answer/ }))?.text).toBe('no answer: api-error')
  await ui.unmount()
})

test('mobile draws the pane without the Ask box', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Button', key: 'task:app/build' })).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'ask' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Ask' })).toBeUndefined()
  await ui.unmount()
})

// -- lost calls expire --------------------------------------------------------------------------------

const IDLE_OUT = output({ ...PROGRAM, running: { roles: [], last_spawn: null } })

// What a hot reload leaves: an Ask or a summary marked in flight in $.state, and no code left to settle it.
// A seeded key reads as its seed, at the store's own version, until the plugin writes it.
function seedState(on: On, seeds: Record<string, unknown>) {
  const live = new Set(Object.keys(seeds))
  const ticks = { n: 0 }
  on('state.get', async (_, e, next) => {
    const r = await next(e)
    const read = r.value as { value?: unknown; version: number } | undefined
    const seeded = e.plugin === 'orch-pane' && live.has(e.key) && read !== undefined && read.value === undefined
    return seeded ? ({ value: { value: seeds[e.key], version: read.version } } as typeof r) : r
  })
  on('state.set', (_, e, next) => {
    if (e.plugin === 'orch-pane') live.delete(e.key)
    if (e.plugin === 'orch-pane' && e.key === 'frame') ticks.n += 1
    return next(e)
  })
  return ticks
}

// The spinner glyph of a row, which turns only while the 120 ms tick runs.
const glyphOf = async (ui: { find: (q: { type: string; text: RegExp }) => Promise<{ text: string } | undefined> }, re: RegExp) =>
  (await ui.find({ type: 'Text', text: re }))?.text?.[0]

test('an Ask left busy by a lost call expires and the tick stops', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { exitCode: 0, stdout: IDLE_OUT, stderr: '' })
  const ticks = seedState(on, { ask: { state: 'busy', question: 'status?', at: NOW } })
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  const a = await glyphOf(ui, /thinking…/)
  await clock.advance(120)
  expect(await glyphOf(ui, /thinking…/)).not.toBe(a)
  await clock.advance(50000)
  expect(await ui.find({ type: 'Text', text: /thinking/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /no answer/ }))?.text).toBe('no answer: aborted')
  const settled = ticks.n
  await clock.advance(1200)
  expect(ticks.n).toBe(settled)
  await ui.unmount()
})

test('a summary left pending by a lost call expires, keeps the raw text, and is asked again on re-expand', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on, { exitCode: 0, stdout: IDLE_OUT, stderr: '' })
  memStore(on)
  const calls = haiku(on, () => 'Second try.')
  const ticks = seedState(on, {
    expanded: { 'step:app/build:2': true },
    plain: { [textKey(STEP2_INPUT)]: { state: 'pending', at: NOW } },
  })
  await start($, clock)
  const ui = await $.ui.mount(PANE60('terminal'))
  const a = await glyphOf(ui, /plain summary…/)
  await clock.advance(120)
  expect(await glyphOf(ui, /plain summary…/)).not.toBe(a)
  await clock.advance(45000)
  expect(await ui.find({ type: 'Text', text: /plain summary…/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /no plain summary/ }))?.text).toBe('no plain summary: aborted')
  expect((await ui.find({ type: 'Text', text: /change thing 2/ }))?.text).toBe('change thing 2')
  const settled = ticks.n
  await clock.advance(1200)
  expect(ticks.n).toBe(settled)
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'step:app/build:2' })
  await ui.press({ key: 'step:app/build:2' })
  expect(calls).toHaveLength(1)
  expect((await ui.find({ type: 'Text', text: /Second try/ }))?.text).toBe('✦ Second try.')
  await ui.unmount()
})

// -- code index -----------------------------------------------------------------------------------

test('the Index section is folded under Goal and opens to the details', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Index' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'index:app/build' }))?.text).toBe('▸ stale · 3 behind · 1.4 GB · revised 3m ago  ⚠ stale answers')
  expect(await ui.find({ type: 'Text', text: /contents/ })).toBeUndefined()
  await ui.press({ key: 'index:app/build' })
  expect((await ui.find({ type: 'Button', key: 'index:app/build' }))?.text).toMatch(/^▾ /)
  expect((await ui.find({ type: 'Text', text: /^commit/ }))?.text).toMatch(/2a465daf7c · 3 commits behind HEAD/)
  expect(await ui.find({ type: 'Text', text: /d5eb5b06fb/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /485,942 files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /p50 4 ms · p95 31 ms/ })).toBeDefined()
  await ui.press({ key: 'index:app/build' })
  expect(await ui.find({ type: 'Text', text: /contents/ })).toBeUndefined()
  await ui.unmount()
})

test('the Index section is left out of tasks of other folders', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  world(on)
  await start($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'scope' })
  await ui.press({ key: 'task:other/fix' })
  expect(await ui.find({ type: 'Button', key: 'goal:other/fix' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'index:other/fix' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'index:app/build' })).toBeDefined()
  await ui.unmount()
})

test('a missing orch-index says so, and a bad answer says why', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.index = { exitCode: 127, stdout: '', stderr: '' }
  await start($, clock)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /orch-index/ }))?.text).toBe('orch-index is not installed')
  expect(await ui.find({ type: 'Text', text: /Loading|could not run/ })).toBeUndefined()
  await ui.unmount()

  w.index = { exitCode: 1, stdout: '', stderr: 'error: not a git repository\nmore' }
  await clock.advance(8000)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /orch-index/ }))?.text).toBe('orch-index failed: error: not a git repository')
  await ui.unmount()
})

test('indexLook words the state as latest, stale, outdated or not built', () => {
  const look = (o: Partial<IndexStatus>) => indexLook({ ...INDEX, ...o })
  expect(look({ state: 'current' })).toEqual({ color: 'success', words: 'latest' })
  expect(look({ state: 'stale', commits_behind: 1 }).words).toBe('stale · 1 behind')
  expect(look({ state: 'stale', commits_behind: null }).words).toBe('stale')
  expect(look({ state: 'outdated' })).toEqual({ color: 'warning', words: 'outdated' })
  expect(look({ state: 'none' })).toEqual({ color: 'error', words: 'not built' })
  expect(look({ state: 'current', indexing: true }).words).toBe('indexing…')
})

test('index sizes, headline, sparkline and parsing', () => {
  expect(bytesText(512)).toBe('512 B')
  expect(bytesText(675840)).toBe('660 KB')
  expect(bytesText(1503238554)).toBe('1.4 GB')
  expect(indexHeadline(INDEX, NOW)).toBe('1.4 GB · revised 3m ago')
  expect(indexHeadline({ ...INDEX, db_bytes: null, indexed_at: null }, NOW)).toBe('')
  expect(sparkline([1, 8])).toBe('▂█')
  expect(sparkline([0, 0])).toBe('▁▁')
  expect(parseIndex(JSON.stringify(INDEX))?.state).toBe('stale')
  expect(parseIndex('{"schema":2,"state":"current"}')).toBeNull()
  expect(parseIndex('{"schema":1,"state":"weird"}')).toBeNull()
  expect(parseIndex('nope')).toBeNull()
})

test('indexDetails reports only what the index gives, and the fix when not current', () => {
  const none = indexDetails({ ...INDEX, state: 'none' }, NOW).map(r => r.text)
  expect(none).toEqual(['not built', 'run `orch-index index`'])
  const lean: IndexStatus = {
    schema: 1, state: 'current', indexing: false, indexed_commit: 'abc', head_commit: 'abc', commits_behind: 0,
    indexed_at: null, db_bytes: null, counts: null, parse_error_files: 0, parse_error_structural: 0,
  }
  expect(indexDetails(lean, NOW).map(r => r.label)).toEqual(['commit'])
  const rows = indexDetails({ ...INDEX, state: 'outdated', extractor_version: '8', binary_extractor_version: '9' }, NOW)
  expect(rows.find(r => r.label === 'extractor')?.text).toBe('built by v8, this orch-index is v9')
  expect(rows.find(r => r.label === 'answers')?.warn).toBe(true)
  expect(rows.find(r => r.label === 'run time')?.text).toMatch(/^█▂  last 2 runs, slowest 9\.0 s/)
  expect(rows.at(-1)?.label).toBe('fix')
  // A fresh index with one unlabelled query reports label_mix (and possibly by_command) as null.
  const fresh = { ...INDEX, state: 'current' as const, usage: { ...INDEX.usage!, queries: 1, label_mix: null, by_command: null } }
  const freshRows = indexDetails(fresh, NOW)
  expect(freshRows.find(r => r.label === 'answers')).toBeDefined()
  expect(freshRows.find(r => r.label === 'trust')).toBeUndefined()
})
