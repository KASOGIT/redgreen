---
paths:
  - "<SOURCE_GLOB, for example src/**/*.ts>"
---

# Spec first (<PROJECT NAME>)

Applies to feature and fix work that changes behavior. Exempt: pure refactors, logging-only changes, generated files, docs, dependency bumps. The protocol itself (right-reason red, independent oracle, tautology list) is built into the `test-engineer` agent. This file holds what is specific to this repo.

## Commands

- One test: `<ONE_TEST_COMMAND>`
- Type-check: `<TYPECHECK_COMMAND>`
- Lint: `<LINT_COMMAND>`

## Where tests live

- <TEST_LOCATION_AND_NAMING, for example `*.spec.ts` beside the source file>
- Reference test to copy the structure from (not the expected values): `<REFERENCE_TEST_PATH>`

## Commits

- RED: `test(<scope>): <behavior>`, only the test, fixtures and scaffolding.
- GREEN: `feat(<scope>): ...` or `fix(<scope>): ...`.

## Repo specifics

- <Fixtures, mocks and helpers to use, and what must never be mocked.>
- A hook blocking exempt work is not a reason to touch an unrelated test. Ask the user.
