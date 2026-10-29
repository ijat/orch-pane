import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

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

type World = { runs: string[][]; opens: number; paneOpen: boolean; placed: boolean }

// The engine beneath the plugin: env, cwd, the command, panes, and `orch status` itself.
function world(on: On, result = { exitCode: 0, stdout: OUTPUT, stderr: '' }): World {
  const w: World = { runs: [], opens: 0, paneOpen: true, placed: true }
  mock.env(on, { HOME: '/home/u' })
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
    w.runs.push([...e.argv])
    return { value: { ...result, isStdoutTruncated: false, isStderrTruncated: false } }
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
  expect(w.opens).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /M2 steps/ }))?.text).toBe('M2 steps  █████░░░░░  1/2  50%')
    expect((await ui.find({ type: 'Text', text: /Overall/ }))?.text).toBe('Overall  ~████░░░░░░  ~43% estimate')
    expect((await ui.find({ type: 'Text', text: /implementer/ }))?.text).toBe('▶ implementer  sonnet/high  steps 2')
    expect((await ui.find({ type: 'Text', text: /running/ }))?.text).toBe('  running 12m · last: 1')
    expect((await ui.find({ type: 'Button', key: 'ms:app/build:1' }))?.text).toMatch(/^✓ M1 first/)
    expect((await ui.find({ type: 'Button', key: 'ms:app/build:2' }))?.text).toMatch(/^▶ M2 second.*L/)
    expect((await ui.find({ type: 'Button', key: 'ms:app/build:3' }))?.text).toMatch(/^· M3 third/)
    expect((await ui.find({ type: 'Button', key: 'step:app/build:2' }))?.text).toMatch(/^▶ 2 second step/)
    expect(await ui.find({ type: 'Button', key: 'task:other/fix' })).toBeUndefined()
    await ui.unmount()
  }
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
    expect((await ui.find({ type: 'Text', text: /change thing 2/ }))?.text).toBe('╰ change thing 2')
    expect((await ui.find({ type: 'Text', text: /and more/ }))?.text).toBe('  and more')
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
