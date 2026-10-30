# orch-pane

A Claude Code pane beside the chat that shows the [orch](https://github.com/ijat/orch) orchestration tasks of the current repo: what each task does, its state, what is running now, step progress and overall progress. Click a milestone or step to see its summary.

Needs the `orch` CLI from [ijat/orch](https://github.com/ijat/orch) at `~/.claude/bin/orch` (the pane runs `orch status --json`).

Works on macOS, Linux and Windows. On Windows the pane runs `orch` through Python (`py -3`, then `python`, then `python3`; the first that starts is kept), and finds `~` from `USERPROFILE` when `HOME` is unset.

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

The Ask box at the bottom answers questions about the shown tasks with Haiku, from their `orch status` data. It only reads; it changes nothing.
