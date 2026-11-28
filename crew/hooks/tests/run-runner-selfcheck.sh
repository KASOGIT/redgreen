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

printf '#!/bin/sh\ni=0\nwhile [ "$i" -lt 20000 ]; do i=$((i + 1)); done\nexit 0\n' >"$WORK/busy.sh"
printf '%s\n' '{"cmd":"git status","expect":"allow","maxcpums":1}' >"$WORK/allow-maxcpums-tight.jsonl"
printf '%s\n' '{"cmd":"git status","expect":"allow","maxcpums":600000}' >"$WORK/allow-maxcpums-loose.jsonl"

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

verdict "busy hook, maxcpums case with a loose bound" "$WORK/busy.sh" "$WORK/allow-maxcpums-loose.jsonl" yes
verdict "busy hook, maxcpums case with a 1 ms bound" "$WORK/busy.sh" "$WORK/allow-maxcpums-tight.jsonl" no
verdict "hook exit 1, maxcpums case" "$WORK/exit1.sh" "$WORK/allow-maxcpums-loose.jsonl" no

# The failure line of a CPU overrun names the measure.
cpu_out="$(GUARD_HOOK="$WORK/busy.sh" GUARD_CASES="$WORK/allow-maxcpums-tight.jsonl" bash "$RUNNER" 2>&1 || true)"
if ! grep -qE '^FAIL cpu: [0-9]+ ms for 8 runs, limit 1: git status' <<<"$cpu_out"; then
  echo "FAIL a maxcpums overrun does not print 'cpu: <n> ms for 8 runs, limit 1: <cmd>' (got: $(head -c 200 <<<"$cpu_out" | tr '\n' ' '))"
  bad=$((bad + 1))
fi

# A hook that idles uses no CPU: maxcpums alone lets it through, so the runner also checks the wall time of
# the 8 CPU runs against GUARD_WALL_CEILING_MS.
printf '#!/bin/sh\nsleep 0.3\nexit 0\n' >"$WORK/idle.sh"
printf '%s\n' '{"cmd":"git status","expect":"allow","maxcpums":100000}' >"$WORK/allow-maxcpums-idle.jsonl"
wall_out="$(GUARD_WALL_CEILING_MS=1000 GUARD_HOOK="$WORK/idle.sh" GUARD_CASES="$WORK/allow-maxcpums-idle.jsonl" bash "$RUNNER" 2>&1 || true)"
if ! grep -qE '^FAIL wall: [0-9]+ ms for 8 runs, ceiling 1000: ' <<<"$wall_out"; then
  echo "FAIL an idle hook escapes the wall ceiling (got: $(head -c 200 <<<"$wall_out" | tr '\n' ' '))"
  bad=$((bad + 1))
fi
rc=0
GUARD_WALL_CEILING_MS=60000 GUARD_HOOK="$WORK/idle.sh" GUARD_CASES="$WORK/allow-maxcpums-idle.jsonl" bash "$RUNNER" >/dev/null 2>&1 || rc=$?
if [[ $rc -ne 0 ]]; then
  echo "FAIL runner rejected an idle hook under a 60000 ms wall ceiling"
  bad=$((bad + 1))
fi

# The widened wall-clock limits are gone: a single wall-clock sample trips under load, so any bound above
# 1000 ms belongs to maxcpums.
wide="$(jq -r 'select((.maxms // 0) > 1000) | "\(.maxms) ms: \(.cmd[0:60])"' "$HERE/guard-cases.jsonl")"
if [[ -n "$wide" ]]; then
  echo "FAIL guard-cases.jsonl has maxms above 1000, use maxcpums: $(tr '\n' ';' <<<"$wide")"
  bad=$((bad + 1))
fi

[[ $bad -eq 0 ]]
