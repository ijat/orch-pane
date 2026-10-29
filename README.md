# orch-pane

A Claude Code pane beside the chat that shows the [orch](https://github.com/ijat/orch) orchestration tasks of the current repo: what each task does, its state, what is running now, step progress and overall progress. Click a milestone or step to see its summary.

Needs the `orch` CLI from [ijat/orch](https://github.com/ijat/orch) at `~/.claude/bin/orch` (the pane runs `orch status --json`).

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
