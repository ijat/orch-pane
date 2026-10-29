// Pure logic of the pane: no `$`, no JSX. register.tsx draws with it; the tests call it directly.
import type { StatusTask } from '../types'

// -- small text helpers ---------------------------------------------------------------------------

export const clip = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// -- states ---------------------------------------------------------------------------------------

export const isRunning = (t: StatusTask) =>
  t.running.roles.length > 0 || (t.running.last_spawn !== null && !t.running.last_spawn.returned)

// Theme keys, so the colors follow the person's theme.
export function stateColor(state: string) {
  if (/done|merged|complete/.test(state)) return 'success'
  if (/block|fail|error|stop|abort/.test(state)) return 'error'
  if (/await|question|pause|wait/.test(state)) return 'warning'
  return 'claude'
}

// A state in which work is supposed to be moving (not finished, failed, or waiting on the person).
export const isActiveState = (state: string) => stateColor(state) === 'claude'

// -- time -----------------------------------------------------------------------------------------

export function elapsed(fromIso: string | null, now: number | null) {
  if (!fromIso || now === null) return null
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return null
  const min = Math.max(0, Math.floor((now - from) / 60000))
  if (min < 60) return `${min}m`
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${min % 60}m`
  return `${Math.floor(min / 1440)}d`
}

export const ago = (fromIso: string | null, now: number | null) => {
  const e = elapsed(fromIso, now)
  return e === null ? null : `${e} ago`
}

// Local wall-clock HH:MM.
export const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const LOG_RE = /^(\S+)\s+([\w-]+):\s+([\s\S]*)$/

export type Activity = { who: string; text: string; at: string | null }

// "2026-10-29T15:17Z implementer: started step(s) 6" → who, text, at.
export function lastActivity(t: StatusTask): Activity | null {
  const m = t.last_log ? LOG_RE.exec(t.last_log.trim()) : null
  if (m) {
    const [, at = '', who = '', rest = ''] = m
    let text = rest.trim()
    const again = `${who}:`
    while (text.startsWith(again)) text = text.slice(again.length).trim()
    return { who, text: text.replace(/\s+/g, ' '), at }
  }
  if (t.updated) return { who: '', text: 'updated', at: t.updated }
  return null
}

function parsed(iso: string | null | undefined) {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// Minutes since the later of `updated` and the last log line; null when neither parses.
export function idleMinutes(t: StatusTask, now: number | null): number | null {
  if (now === null) return null
  const logAt = t.last_log ? parsed(LOG_RE.exec(t.last_log.trim())?.[1]) : null
  const times = [parsed(t.updated), logAt].filter((x): x is number => x !== null)
  if (times.length === 0) return null
  return Math.max(0, Math.floor((now - Math.max(...times)) / 60000))
}

export const STALE_MIN = 30

export const isStale = (t: StatusTask, now: number | null) =>
  isActiveState(t.state) && !isRunning(t) && (idleMinutes(t, now) ?? 0) > STALE_MIN

export const needsAttention = (t: StatusTask, now: number | null) =>
  (t.questions_open ?? 0) > 0 || !!t.error || isStale(t, now)

// Stable: tasks that need the person first, otherwise the input order.
export function sortByAttention(tasks: readonly StatusTask[], now: number | null): StatusTask[] {
  return tasks
    .map((t, i) => ({ t, i, a: needsAttention(t, now) ? 0 : 1 }))
    .sort((x, y) => x.a - y.a || x.i - y.i)
    .map(x => x.t)
}

export const scopeLabel = (all: boolean, elsewhere: number) =>
  all ? '[all tasks]' : elsewhere > 0 ? `[this repo · ${elsewhere} elsewhere]` : '[this repo]'

// -- markdown-lite --------------------------------------------------------------------------------

export type MdRun = { text: string; code?: true; bold?: true; key?: true }
export type MdLine = { lead: string; runs: MdRun[] }

type Style = Omit<MdRun, 'text'>
type Word = MdRun[]

const sameStyle = (a: Style, b: Style) => !!a.code === !!b.code && !!a.bold === !!b.bold && !!a.key === !!b.key

function styleOf(r: MdRun): Style {
  const s: Style = {}
  if (r.code) s.code = true
  if (r.bold) s.bold = true
  if (r.key) s.key = true
  return s
}

// Inline marks: `code` and **bold**; an unclosed mark stays literal.
function inline(text: string): MdRun[] {
  const runs: MdRun[] = []
  const re = /`([^`]+)`|\*\*([^*]+?)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) runs.push({ text: m[1], code: true })
    else runs.push({ text: m[2] ?? '', bold: true })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs
}

// A bullet's leading `key:` or `**key:**` becomes a key run.
function keyed(content: string): MdRun[] {
  const bold = /^\*\*([^*\s][^*]{0,23}):\*\*\s*([\s\S]*)$/.exec(content)
  if (bold) return [{ text: `${bold[1]}:`, key: true }, ...(bold[2] ? [{ text: ' ' }, ...inline(bold[2])] : [])]
  const plain = /^([^\s:`*][^:`*]{0,23}):(?:\s+([\s\S]*))?$/.exec(content)
  if (plain && (plain[1] ?? '').split(' ').length <= 3) {
    return [{ text: `${plain[1]}:`, key: true }, ...(plain[2] ? [{ text: ' ' }, ...inline(plain[2])] : [])]
  }
  return inline(content)
}

// Runs → words (no whitespace inside a word; a word may mix styles, as `foo`s).
function words(runs: MdRun[]): Word[] {
  const out: Word[] = []
  let cur: Word = []
  for (const r of runs) {
    for (const piece of r.text.split(/(\s+)/)) {
      if (piece === '') continue
      if (/^\s+$/.test(piece)) {
        if (cur.length) out.push(cur)
        cur = []
        continue
      }
      cur.push({ ...styleOf(r), text: piece })
    }
  }
  if (cur.length) out.push(cur)
  return out
}

const wordLen = (w: Word) => w.reduce((n, r) => n + r.text.length, 0)

function pushRun(runs: MdRun[], r: MdRun) {
  const prev = runs[runs.length - 1]
  if (prev && sameStyle(prev, r)) prev.text += r.text
  else runs.push({ ...r })
}

// Cut a word into pieces of at most `room` characters, keeping styles.
function hardBreak(w: Word, room: number): Word[] {
  const pieces: Word[] = []
  let cur: Word = []
  let len = 0
  for (const r of w) {
    let text = r.text
    while (text.length > 0) {
      const take = Math.min(room - len, text.length)
      cur.push({ ...styleOf(r), text: text.slice(0, take) })
      len += take
      text = text.slice(take)
      if (len === room) {
        pieces.push(cur)
        cur = []
        len = 0
      }
    }
  }
  if (cur.length) pieces.push(cur)
  return pieces
}

function wrapRuns(runs: MdRun[], lead: string, cont: string, width: number): MdLine[] {
  const lines: MdLine[] = []
  let line: MdLine = { lead, runs: [] }
  let len = 0
  const room = () => Math.max(1, width - line.lead.length)
  const flush = () => {
    lines.push(line)
    line = { lead: cont, runs: [] }
    len = 0
  }
  for (const w of words(runs)) {
    const wl = wordLen(w)
    if (len > 0 && len + 1 + wl > room()) flush()
    if (wl > room() - (len > 0 ? len + 1 : 0)) {
      // Longer than a whole line: start it on its own line and cut it.
      if (len > 0) flush()
      const parts = hardBreak(w, room())
      parts.forEach((p, i) => {
        if (i > 0) flush()
        for (const r of p) pushRun(line.runs, r)
        len = wordLen(p)
      })
      continue
    }
    if (len > 0) {
      // The space takes the style shared by both neighbours (a space inside `a b`), else none.
      const prev = line.runs[line.runs.length - 1]
      const next = w[0]
      pushRun(line.runs, prev && next && sameStyle(prev, next) ? { ...styleOf(next), text: ' ' } : { text: ' ' })
      len += 1
    }
    for (const r of w) pushRun(line.runs, r)
    len += wl
  }
  if (line.runs.length > 0 || lines.length === 0) lines.push(line)
  return lines
}

type Block = { indent: number; marker: string | null; content: string }

const BULLET_RE = /^([-*]|\d+[.)])\s+([\s\S]*)$/

// Source lines → logical blocks; an indented plain line that continues a bullet's text joins it.
function blocks(text: string): (Block | null)[] {
  const out: (Block | null)[] = []
  for (const raw of text.replace(/\t/g, '  ').split('\n')) {
    const body = raw.trim()
    if (!body) {
      out.push(null)
      continue
    }
    const indent = raw.length - raw.trimStart().length
    const b = BULLET_RE.exec(body)
    const prev = out[out.length - 1]
    if (!b && prev && prev.marker !== null && indent >= prev.indent + 2) {
      prev.content += ` ${body}`
      continue
    }
    out.push(b ? { indent, marker: b[1] ?? '-', content: b[2] ?? '' } : { indent, marker: null, content: body })
  }
  return out
}

export function mdLite(text: string, width: number): MdLine[] {
  const w = Math.max(12, Math.floor(width))
  const maxLevel = Math.max(0, Math.floor((w / 2 - 2) / 2))
  const lines: MdLine[] = []
  for (const b of blocks(text)) {
    if (b === null) {
      const prev = lines[lines.length - 1]
      if (prev && prev.runs.length > 0) lines.push({ lead: '', runs: [] })
      continue
    }
    const indent = '  '.repeat(Math.min(maxLevel, Math.floor(b.indent / 2)))
    if (b.marker !== null) {
      const mark = /^\d/.test(b.marker) ? `${b.marker} ` : '• '
      const lead = indent + mark
      lines.push(...wrapRuns(keyed(b.content), lead, ' '.repeat(lead.length), w))
    } else {
      lines.push(...wrapRuns(inline(b.content), indent, indent, w))
    }
  }
  while (lines.length && lines[lines.length - 1]!.runs.length === 0) lines.pop()
  return lines
}

// One line of text with its inline marks (ticks, bold markers) removed: titles and goals in a row.
export const stripMarks = (text: string) => inline(text).map(r => r.text).join('')

export const lineText = (l: MdLine) => l.lead + l.runs.map(r => r.text).join('')

// The goal as one line: the `- goal:` bullet's text when the summary opens with one, else its first line.
export function goalLine(summary: string | null): string | null {
  if (!summary || !summary.trim()) return null
  const first = blocks(summary).find((b): b is Block => b !== null)
  if (!first) return null
  const m = first.marker !== null ? /^(?:\*\*goal:\*\*|goal:)\s*([\s\S]*)$/i.exec(first.content) : null
  const text = m ? m[1] ?? '' : first.content
  return inline(text).map(r => r.text).join('').replace(/\s+/g, ' ').trim() || null
}

// -- folding --------------------------------------------------------------------------------------

export type ItemState = 'done' | 'current' | 'pending'
export type FoldRow =
  | { kind: 'item'; index: number }
  | { kind: 'done'; from: number; to: number }
  | { kind: 'more'; from: number; to: number }

// Done items fold into one row per run, pending items past the next `ahead` into one row; the current
// item, everything not done before it, and the next `ahead` pending items always show.
export function fold<T>(items: readonly T[], stateOf: (t: T) => ItemState, ahead = 2): FoldRow[] {
  const states = items.map(stateOf)
  let anchor = states.indexOf('current')
  if (anchor < 0) {
    const lastDone = states.lastIndexOf('done')
    anchor = states.findIndex((s, i) => i > lastDone && s === 'pending')
  }
  const shown = states.map(s => s === 'current')
  if (anchor >= 0) {
    for (let i = 0; i <= anchor; i++) if (states[i] !== 'done') shown[i] = true
    let left = ahead
    for (let i = anchor + 1; i < states.length && left > 0; i++) {
      if (states[i] === 'pending') {
        shown[i] = true
        left--
      }
    }
  } else {
    states.forEach((s, i) => {
      if (s !== 'done') shown[i] = true
    })
  }
  const rows: FoldRow[] = []
  let i = 0
  while (i < states.length) {
    if (shown[i]) {
      rows.push({ kind: 'item', index: i })
      i++
      continue
    }
    const kind = states[i] === 'done' ? 'done' : 'more'
    let j = i
    while (j + 1 < states.length && !shown[j + 1] && (states[j + 1] === 'done') === (kind === 'done')) j++
    if (j === i) rows.push({ kind: 'item', index: i })
    else rows.push({ kind, from: i, to: j })
    i = j + 1
  }
  return rows
}

// -- bars -----------------------------------------------------------------------------------------

export const BAR_MIN = 10
export const BAR_MAX = 24

export function barLayout(avail: number, bars: readonly { label: string; tail: string }[]) {
  const labelW = Math.max(0, ...bars.map(b => b.label.length)) + 2
  const tailW = Math.max(0, ...bars.map(b => b.tail.length))
  const barW = clamp(avail - labelW - 2 - tailW, BAR_MIN, BAR_MAX)
  return { labelW, barW, tailW }
}

export const barCells = (percent: number, barW: number) => clamp(Math.round((percent / 100) * barW), 0, barW)

export const stepsTail = (percent: number, done: number, total: number) =>
  `${`${percent}%`.padStart(4)}  ${done}/${total}`

export const overallTail = (percent: number, estimate: boolean) =>
  `${percent}%`.padStart(4) + (estimate ? '  estimate' : '')

// Gradient ends and the moving highlight of the running Steps bar.
const DARK = [0x16, 0xa3, 0x4a] // #16a34a
const LIGHT = [0x4a, 0xde, 0x80] // #4ade80
const GLOW = [0xe0, 0xff, 0xec] // #e0ffec
const RADIUS = 3.5

const hex = (rgb: number[]) => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`
const mix = (a: number[], b: number[], t: number) => a.map((c, i) => c + ((b[i] ?? c) - c) * t)

// One colour per filled cell: a left→right green gradient with a highlight moving one cell per frame,
// period `filled + 6`.
export function shimmer(filled: number, frame: number): string[] {
  if (filled <= 0) return []
  const period = filled + 6
  const pos = (((frame % period) + period) % period) - 3
  return Array.from({ length: filled }, (_, i) => {
    const base = mix(DARK, LIGHT, filled === 1 ? 0 : i / (filled - 1))
    const glow = Math.max(0, 1 - Math.abs(i - pos) / RADIUS)
    return hex(mix(base, GLOW, glow * 0.85))
  })
}

// -- model helpers --------------------------------------------------------------------------------

// cyrb53: a 53-bit string hash; a cache key, not a security use. The prefix names the prompt version.
export function textKey(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return `p1-${n.toString(16).padStart(14, '0')}`
}

// What a plain-language summary is asked about, and so what its cache key covers.
export const plainInput = (kind: 'goal' | 'milestone' | 'step', title: string | null, summary: string) =>
  `${kind}${title ? `: ${title}` : ''}\n\n${summary}`

const ITEM_CLIP = 160

type Lean = Omit<StatusTask, 'task_dir' | 'repo_path' | 'worktree'>

function lean(t: StatusTask, items: 'full' | 'clip' | 'none'): Lean {
  const { task_dir: _d, repo_path: _r, worktree: _w, ...rest } = t as StatusTask & Record<string, unknown>
  const cut = (s: string | null) => (items === 'full' || s === null ? s : items === 'clip' ? clip(s, ITEM_CLIP) : null)
  return {
    ...rest,
    steps: { ...t.steps, items: t.steps.items.map(s => ({ ...s, summary: cut(s.summary) })) },
    milestones: t.milestones
      ? { ...t.milestones, items: t.milestones.items.map(m => ({ ...m, summary: cut(m.summary) })) }
      : null,
  } as Lean
}

// The status of the shown tasks for the Ask prompt, bounded by `limit` characters.
export function askContext(tasks: readonly StatusTask[], limit = 60000): string {
  let last = ''
  for (const items of ['full', 'clip', 'none'] as const) {
    last = JSON.stringify(tasks.map(t => lean(t, items)))
    if (last.length <= limit) return last
  }
  return last
}
