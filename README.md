# orch-pane

A Claude Code pane beside the chat that shows the [orch](https://github.com/ijat/orch) orchestration tasks of the current repo: what each task does, its state, what is running now, step progress and overall progress. Click a milestone or step to see its summary.

Needs the `orch` CLI from [ijat/orch](https://github.com/ijat/orch) at `~/.claude/bin/orch` (the pane runs `orch status --json`). For the Index section it also runs `~/.claude/bin/orch-index status --json` (`orch-index.exe` on Windows) from [ijat/orch-index](https://github.com/ijat/orch-index), 0.2.0 or later; without it the section says so and nothing else changes.

Works on macOS, Linux and Windows. On Windows the pane runs `orch` as `python <path>` and finds `~` from `USERPROFILE` instead of `HOME`.

## Install

At the prompt of a terminal session:

```
/plugin install orch-pane --marketplace ijat/orch-pane
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install orch-pane --marketplace ijat/orch-pane
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ijat/orch-pane`, then Add plugin.

## Use

`/orch-pane` opens the pane. It opens by itself at session start when the folder belongs to an active task's repo or worktree. The `[this repo]` / `[all tasks]` button switches scope.

Tasks that need you (open questions, an error, or work that stalled for over 30 minutes) come first. Each task shows its Goal (one line; click to open), Now (what runs and the last activity), Progress, and its Milestones and Steps, folded around the current one; click a fold row to see them all.

Opening a goal, milestone or step also asks Haiku (lowest effort) for a plain-language summary of it, once per text: summaries are kept in the mod's own store across sessions. The `raw` button shows the original text.

Under Goal, a task of the session's folder has an Index line: the code index's state (`latest`, `stale · N behind`, `outdated`, `not built`, or `indexing…`), its size, and when it was last revised. It is folded; click it for the indexed commit and how far HEAD is ahead, file/symbol/reference counts, languages, parse errors, the last run (kind, time, files per second, extracted vs reused) with a run-time sparkline, and the last 7 days of queries (p50/p95 per command, empty-answer %, stale-answer %, trust-label mix). A `⚠ stale answers` badge shows when over 10% of answers came from a stale index.

The Ask box at the bottom answers questions about the shown tasks with Haiku, from their `orch status` data. It only reads; it changes nothing.
