---
name: adopt
description: Makes this repo self-contained with the crew workflow (CLAUDE.md, tdd rule, hook config, agents, skills, hooks in .claude), or updates an already adopted repo.
disable-model-invocation: true
---

# Adopt crew in this repository

Goal: after this runs and the result is committed, anyone who clones the repo gets the agents, the `feature`, `debug` and `review` skills and the hooks with nothing to install, in the editor, in cloud sessions and in CI. Two parts: you write the repo's facts, and `crew-vendor` copies the plugin's files into `.claude/`. Work from the repo root.

Rules:

- Local, reversible edits only. Never overwrite a file without showing the diff and asking. Merge into an existing `CLAUDE.md`, never replace.
- Never push, open a PR or message anyone without asking. Never commit to a protected branch.
- Write only: `CLAUDE.md`, `.claude/rules/tdd.md`, `.claude/crew.json`, what `crew-vendor` writes, and (step 6) the local settings override. Nothing else, and nothing in `~/.claude`.
- Templates are in `${CLAUDE_PLUGIN_ROOT}/skills/adopt/templates/`. Fill the `<PLACEHOLDERS>` from what you found.
- The script is `${CLAUDE_PLUGIN_ROOT}/bin/crew-vendor` (also on PATH while the plugin is enabled).

## Update mode

When `.claude/crew.lock.json` already exists, the repo is adopted. Update mode is self-contained and replaces steps 1 to 7 (no inspection, no questions, no project facts, no plugin switch-off). Do this instead.

This skill runs only where the plugin is enabled. In a repo where step 6 turned it off locally, `/crew:adopt` is unknown there: run the same steps with the script by its path in a plugin checkout or install (`<plugin root>/bin/crew-vendor plan|apply|check .`), or re-enable the plugin for the session.

1. Run `crew-vendor plan .` and show the summary and the diffs.
2. For each EDITED file, ask: keep or take. Take: delete the file, so the apply installs the plugin version. Keep: first move the local change to a differently named file (for example a project skill) and give it a different frontmatter `name:` too, otherwise `crew-vendor` reports a name CLASH. Then delete the vendored file so `apply` restores it. `apply` refuses while a vendored file is edited.
3. Wait for the person's OK on the plan, with every keep or take decided. Do not run `apply` before it.
4. Run `crew-vendor apply .`, then `crew-vendor check .` and show the result.
5. Offer a commit on a branch (never a protected branch, staging by explicit path). Never push.

## 1. Inspect (read-only)

Find, and note the evidence for each:

- languages and package manager; monorepo or not (workspaces, nx, turbo, lerna);
- test runner and the exact commands: all tests, one test file, type-check, lint, format, and what to run before committing;
- source folders and test file patterns (they feed the rule's `paths:` and `crew.json`);
- CI config and the commands it uses;
- commit conventions (commitlint, PR title lint, history) and PR rules;
- protected branches and the base branch PRs target;
- existing `CLAUDE.md` and `.claude/` (settings, rules, agents, skills, hooks);
- whether `jq` and `git` are installed (the hooks and the script need both).

## 2. Ask only what you could not determine

At most five questions, each with your best guess as the default: which areas are costly to get wrong (money, auth, data migrations, production admin commands, personal data), because they become the escalation list; protected branches and base branch if unclear; RED and GREEN as separate commits (default yes); hook mode, `nudge` (default) or `enforce`; and the source roots if the layout is ambiguous.

## 3. Plan, then wait

Run `crew-vendor plan .` (nothing is written). Show its output and, next to it, every project file you will create or modify, one line each, and what you leave alone. At most 30 lines of your own. If the plan reports clashes (files the repo already has with the same name as a crew file) or local edits, list them: the user decides per file, and you do not apply the copy until they have. Wait for an explicit OK.

## 4. Write the project facts

1. **`CLAUDE.md`** from `templates/CLAUDE.md.tmpl`. If one exists, merge: add missing sections, keep existing text, show the diff. Sections: what the product is and what a mistake costs; repo map; the exact commands (install, run, all tests, one test, type-check, lint, format, before committing); git and PR rules; the escalation list; invariants that must always hold; pointers to `.claude/rules/*.md`. Under 150 lines. One owner file per topic, others link to it. No version numbers, file counts or anything a linter already enforces.
2. **`.claude/rules/tdd.md`** from `templates/tdd.md`. Set `paths:` to the production source globs (a rule without `paths:` loads every session, so never leave it out) and fill in this repo's exact commands. The generic protocol lives in the `test-engineer` agent, so this file carries only what is specific to the repo.
3. **`.claude/crew.json`** from `templates/crew.json`: the config the hooks read. The schema is `${CLAUDE_PLUGIN_ROOT}/hooks/crew.schema.json`: read it for valid keys and values, and an example sits beside it. Do not restate the schema anywhere. Validate the result against it when a validator is available, otherwise at least `jq . .claude/crew.json`. `managerModel` is optional and is left out unless the repo's owner asks for the `feature` workflow to start on a given model; with it, `crew-vendor` writes `model: <value>` into the copied `feature` skill.

## 5. Copy the plugin in

After the OK, and only when the plan had no clash or local edit: run `crew-vendor apply .`. It writes the agents, the three skills and the hook scripts under `.claude/`, merges the hook entries into `.claude/settings.json` without touching other keys or hooks, and writes `.claude/crew.lock.json`. It also copies the `/crew-update` skill and `.claude/hooks/crew/crew-update.sh`, so the repo can update itself; mention it. A repo that wants a weekly pull request sets `"updateWorkflow": true` in `.claude/crew.json`, and the next apply adds `.github/workflows/crew-update.yml`. Then run `crew-vendor check .` and show the result. Verify the commands you wrote into `CLAUDE.md` exist in the repo's scripts.

## 6. Turn the plugin off for the person running this

If the user has the plugin enabled themselves, they would now see every agent twice (`crew:test-runner` and the repo's `test-runner`). Find its id with `claude plugin list` (an id like `crew@<marketplace>`), then run from the repo root `claude plugin disable <id> --scope local`. That writes an override in `.claude/settings.local.json` for this project and this user only. Say so, and say it applies after `/reload-plugins` or a new session. If the plugin was loaded with `--plugin-dir` (no id), say it needs no action in a normal session. Teammates never have the plugin, so nothing is needed for them.

## 7. Finish

Show a table of what you created, changed and skipped. Tell the user: commit `CLAUDE.md` and `.claude/` (the lock file included, `.claude/settings.local.json` excluded, so suggest adding it to `.gitignore` if it is not already); teammates then need nothing, and `/feature <requirement>` starts the workflow. To update later, run this skill again (update mode), or run `crew-vendor plan|apply|check .` by its path from a plugin checkout, since the plugin is off here; `crew-vendor check .` shows whether the copy is behind or edited. Offer, but do not do, a commit on a new branch (for example `chore/crew-setup`, staging by explicit path) and a PR. Ask before either.
