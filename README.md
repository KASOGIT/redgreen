# redgreen marketplace: the crew plugin

`crew` is a spec-first, test-first workflow for Claude Code. Everything here is generic: it reads commands, folders and conventions from the repository's own `CLAUDE.md`.

## Install

```
claude plugin marketplace add KASOGIT/redgreen
claude plugin install crew@redgreen
claude plugin install crew-office@redgreen   # optional: the pixel-art desks pane
```

Third-party marketplaces start with auto-update off. Turn it on in `/plugin` > Marketplaces > redgreen, and each new snapshot reaches you.

To see the plugin in use within a full setup (personal rules, models, the weekly improvement loop), and a prompt to build your own: https://claude.ai/artifact/QHJmdBYHe69SRsGGzxvPeC

## What it contains

- Seven agents: `test-engineer`, `implementer`, `code-reviewer`, `test-runner`, `domain-researcher`, `architecture-planner`, `debugger-analyst`. Each sets its own `model` and `effort` in its frontmatter and ends with a size-capped hand-back, so the main session only keeps summaries.
- Skills: `feature` (spec, plan, RED, GREEN, critique, feedback, report), `debug`, `review`, `research` (subject to plan file, with web search), `audit` (perf, bugs, debt or security findings, ranked), and `adopt`. `research` and `audit` run by hand only.
- Hooks (`crew/hooks/`): a guard against hard-to-undo commands and a spec-first nudge.
- `crew/bin/crew-vendor`: copies the plugin into a repo.

## How a repo gets it

Load the plugin, either by installing it as above or, from a local checkout of this folder, with `claude --plugin-dir <path to this folder>/crew`. Then run `/crew:adopt` in the repo you want to set up. It inspects the repo, writes `CLAUDE.md`, `.claude/rules/tdd.md` and `.claude/crew.json`, shows `crew-vendor plan`, and after your OK copies the agents, the `feature`, `debug`, `review`, `research` and `audit` skills and the hook scripts into `.claude/`. Commit the result: teammates, cloud sessions and CI then need no plugin. `crew-vendor` never overwrites a file it did not write and never clobbers a local edit; it lists the problem and stops.

The copy never carries a skill's `model:` line: each contributor keeps their own session model. A repo that wants the `feature` workflow to start on a given model sets `"managerModel"` (`sonnet`, `opus`, `haiku` or `fable`) in its `.claude/crew.json`, and the next `crew-vendor apply` writes it into the copied skill.

An adopted repo also gets the `/crew-update` skill and `.claude/hooks/crew/crew-update.sh`, which pull the latest crew from the public redgreen marketplace and open a pull request. A repo that wants this weekly and automatic sets `"updateWorkflow": true` in its `.claude/crew.json`: `crew-vendor` then also copies `.github/workflows/crew-update.yml`.

To update a repo later: `crew-vendor plan <repo>`, then `crew-vendor apply <repo>`. `crew-vendor check <repo>` exits non-zero when the copy is behind the plugin or was edited.

## Hook configuration

Per repo, in `.claude/crew.json` (every key optional; without it the spec-first hook does nothing and the guard uses defaults). The keys and values are defined by `crew/hooks/crew.schema.json`, with an example beside it.

## Tests

The tests live in the source repository this marketplace is published from, not here. From that repository (they need `bash` and `jq`):

- `bash tests/plugin/run.sh`: frontmatter, descriptions, references, manifests, house rules, then `claude plugin validate`.
- `bash tests/vendor/run.sh`: `crew-vendor` on fixtures and on the real plugin.
- `crew/hooks/tests/run-all.sh`: the hooks.
- Evals (they start real Claude sessions: billed per token on an API key, counted against plan usage on a subscription; they need the fixture repos the cases build with `--scaffold`): `claude plugin eval ./crew --model sonnet --runs 2 --max-cost-usd 4 --trust-plugin --scaffold --allow-tools Bash`. Results land in `crew/evals/results/`, which is git-ignored.
  - On macOS the eval sandbox blocks the `/usr/bin/git` launcher (xcrun cannot write its cache), so a case that runs git fails and the test runner falls back to the full suite. Install a standalone git (for example Homebrew's) before running the evals.
  - `regex` graders use JavaScript regular expressions: no inline flags such as `(?i)`; write `[Aa]ffected` instead.

MIT licensed, see LICENSE.
