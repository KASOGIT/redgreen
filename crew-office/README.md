# crew-office

A Claude Code mod that shows the crew at work: a side pane with one pixel-art desk per agent, animated while that agent runs.

## What you see

Ten desks: the manager (the main session), the seven crew agents (test-runner, researcher, debugger, architect, test-engineer, implementer, reviewer), a guest desk for every other agent type and an advisor desk. The advisor has its own idle desk showing how many consultations this session made, while the five-second pose stays at the manager desk.

A header line on top reads `2 working · 5 done`, then adds the context percentage (`ctx 40%`), the 5h and 7d rate-limit windows (`5h 42% · 7d 18%`, only on a subscription that reports them) and the session cost (`~$0.12`) when known. A narrow pane drops the cost first, then 7d, 5h and ctx.

Each desk has a status line:

- While an agent runs: the tool it uses and its target (`Bash npm test`, `Read model.ts`), with `x2` when two run at once. `working` alone when no tool is known yet.
- `waiting` when every agent on the desk is waiting for a permission or an answer.
- After the manager consults the advisor, a robed advisor stands at the manager desk for five seconds and the status reads `advised by fable` (the model comes from the `advisorModel` setting, `advised` when it is unknown). The mod learns of the call only when the request that made it has finished, so this follows the consultation instead of accompanying it.
- When the agent ends, a mark stays for five seconds, then the desk goes back to `idle`. A finished run shows `done` with its duration (`done 12s`); a failed run shows its outcome, or `failed`. A green check or a red cross sits on the desk too.
- A desk counts the runs that ended well: `3 · idle` means three runs done. The count starts again from zero in a new or cleared session (not on resume, compact or fork). Failed and aborted runs do not count, and the manager desk never does.

The layout follows the pane size. A short pane draws the busiest desks first (working, then waiting, then marked, then idle). Desks that do not fit are not drawn but are listed in one roster line: the working or waiting ones first with a `*` after the label (`debugger*  guest*  architect  test-engineer`), then the advisor (`advisor 3`, its consultation count) when it has no seat, then the idle ones, cut with `…` at the pane width. The working desks that are drawn carry a task line (the agent's label) and a meter line (the model name, the effort of its latest request and the elapsed time, `sonnet hi 1m31s`, the effort shortened to two letters: `lo`, `me`, `hi`, `xh`, `ma`; without a known effort, or when the desk is too narrow to keep 3 columns of the model name, `sonnet · 1m31s`). A tall pane draws every desk with its task and meter lines. The advisor desk fills a free cell, or a last line of its own when rows allow; on smaller panes it takes the idle guest's seat and the guest moves to the roster.

A desk whose agents all wait for a permission or an answer draws its undimmed idle art. A working desk animates in four frames.

The mod only observes: it never blocks or rewrites a spawn, a model request or a tool call.

## Use

The pane opens by itself whenever a crew agent starts and the pane is not already open. Other agent types (`Explore`, `general-purpose`) show at the guest desk but do not open it.

`/crew-office off` closes the pane and keeps it closed, in every session and every project on this machine, until `/crew-office on`. `/crew-office` alone flips the setting.

When Claude Code reports the pane placed and shown but has never drawn it, two seconds after the mod opened it (or loaded), `/crew-office on` and `/crew-office off` say so and suggest a new session.

The pixel desks need a terminal pane at least 18 columns wide. Desks per row follow the pane width, up to ten in a row, and the sprites double (32x16 cells) when all nine desks fit the pane's width and rows at that size. The mod asks for the widest dock, 45% of the terminal; a wider office needs you to drag the dock wider. Narrower panes and the desktop, VS Code and mobile surfaces show a text list instead (`test-runner: working Bash`).

When the pane is hidden (or closed with `/crew-office off`) while the crew works, the status line shows `crew: 2 working · 5 done` instead, and clears when the crew stops or the pane comes back.

The hotkeys 0 to 8 work while the pane has focus (ctrl+x tab or a click) and open that desk's agent transcript; 0 is the manager, which goes back to the main conversation.

## Install

```
/plugin install crew-office@redgreen
```

## Develop

```
claude plugin validate marketplace/crew-office
claude plugin test marketplace/crew-office
claude --plugin-dir marketplace/crew-office
tsc -p marketplace/crew-office
```

`tsc` needs the types the engine lays in `.claude-plugin/types/` the first time the mod loads, so run the `--plugin-dir` line once before it.

Sprites live in `hooks/sprites.ts` as 16x16 palette-indexed grids (drawn at 16x8 cells, or 32x16 when doubled), four animation frames per desk.
