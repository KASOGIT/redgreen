#!/usr/bin/env bash
# Checks run-guard-tests.sh itself: the runner must fail a case when the hook it runs is broken (exit code
# other than 0 or 2, or the hook file is missing), measured cases included, and must still pass a hook that
# answers the way the cases say. Prints a FAIL line per wrong runner verdict and exits non-zero on any.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$HERE/run-guard-tests.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
bad=0

printf '#!/bin/sh\nexit 1\n' >"$WORK/exit1.sh"
printf '#!/bin/sh\nexit 3\n' >"$WORK/exit3.sh"
printf '#!/bin/sh\nexit 0\n' >"$WORK/exit0.sh"
printf '#!/bin/sh\nexit 2\n' >"$WORK/exit2.sh"
printf '#!/bin/sh\necho %s\nexit 1\n' "'{\"hookSpecificOutput\":{\"permissionDecision\":\"ask\"}}'" >"$WORK/ask-exit1.sh"
printf '#!/bin/sh\necho %s\nexit 0\n' "'{\"hookSpecificOutput\":{\"permissionDecision\":\"ask\"}}'" >"$WORK/ask-exit0.sh"

printf '%s\n' '{"cmd":"git status","expect":"allow"}' >"$WORK/allow.jsonl"
printf '%s\n' '{"cmd":"git status","expect":"allow","maxms":60000}' >"$WORK/allow-maxms.jsonl"
printf '%s\n' '{"cmd":"git status","scalecmd":"git status","expect":"allow","maxratio":50}' >"$WORK/allow-maxratio.jsonl"
printf '%s\n' '{"cmd":"git push","expect":"ask"}' >"$WORK/ask.jsonl"
printf '%s\n' '{"cmd":"rm -rf x","expect":"deny"}' >"$WORK/deny.jsonl"

# verdict <label> <hook> <cases> <runner must pass: yes|no>
verdict() {
  local rc=0
  GUARD_HOOK="$2" GUARD_CASES="$3" bash "$RUNNER" >/dev/null 2>&1 || rc=$?
  if [[ "$4" == yes && $rc -ne 0 ]]; then
    echo "FAIL runner rejected a hook that behaves ($1)"
    bad=$((bad + 1))
  elif [[ "$4" == no && $rc -eq 0 ]]; then
    echo "FAIL runner passed a broken hook ($1)"
    bad=$((bad + 1))
  fi
}

verdict "hook exit 0, allow case" "$WORK/exit0.sh" "$WORK/allow.jsonl" yes
verdict "hook exit 2, deny case" "$WORK/exit2.sh" "$WORK/deny.jsonl" yes
verdict "hook ask on exit 0, ask case" "$WORK/ask-exit0.sh" "$WORK/ask.jsonl" yes
verdict "hook exit 0, maxms case" "$WORK/exit0.sh" "$WORK/allow-maxms.jsonl" yes
verdict "hook exit 0, maxratio case" "$WORK/exit0.sh" "$WORK/allow-maxratio.jsonl" yes

verdict "hook exit 1, allow case" "$WORK/exit1.sh" "$WORK/allow.jsonl" no
verdict "hook exit 3, allow case" "$WORK/exit3.sh" "$WORK/allow.jsonl" no
verdict "hook exit 1 with ask output, ask case" "$WORK/ask-exit1.sh" "$WORK/ask.jsonl" no
verdict "missing hook file, allow case" "$WORK/missing.sh" "$WORK/allow.jsonl" no
verdict "hook exit 1, maxms case" "$WORK/exit1.sh" "$WORK/allow-maxms.jsonl" no
verdict "missing hook file, maxms case" "$WORK/missing.sh" "$WORK/allow-maxms.jsonl" no
verdict "hook exit 1, maxratio case" "$WORK/exit1.sh" "$WORK/allow-maxratio.jsonl" no
verdict "missing hook file, maxratio case" "$WORK/missing.sh" "$WORK/allow-maxratio.jsonl" no

[[ $bad -eq 0 ]]
