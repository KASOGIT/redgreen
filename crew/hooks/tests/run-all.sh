#!/usr/bin/env bash
# Single entry point: runs the guard and spec-first suites, prints their failures and the pass and fail
# totals, and exits non-zero when anything fails or a suite cannot run.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0
fail=0
broken=0

echo "== example hygiene"
EX="$HERE/../crew.example.json"
TERMS="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null)/private-terms.txt"
if jq -e . "$EX" "$HERE/../crew.schema.json" >/dev/null 2>&1 && { [ ! -f "$TERMS" ] || ! grep -qiF -f <(grep -v '^[[:space:]]*$' "$TERMS") "$EX"; }; then
  pass=$((pass + 1))
else
  echo "FAIL crew.example.json must be valid JSON and must not hold a term of private-terms.txt"
  fail=$((fail + 1))
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
SHARDS=4

# The suites are independent (each builds its own scratch repos), so they run side by side: the guard
# suite in one process, the spec-first suite split over SHARDS processes by case number.
bash "$HERE/run-guard-tests.sh" >"$OUT/guard.out" 2>&1 &
guard_pid=$!
shard_pids=""
for ((i = 0; i < SHARDS; i++)); do
  SHARD_COUNT=$SHARDS SHARD_INDEX=$i bash "$HERE/run-spec-first-tests.sh" >"$OUT/spec.$i.out" 2>&1 &
  shard_pids="$shard_pids $!"
done

wait "$guard_pid"
echo $? >"$OUT/guard.rc"
i=0
spec_rc=0
spec_ok=0
spec_total=0
spec_missing=0
: >"$OUT/spec.out"
for pid in $shard_pids; do
  wait "$pid" || spec_rc=1
  grep -vE '^[0-9]+/[0-9]+ cases passed$' "$OUT/spec.$i.out" >>"$OUT/spec.out" || true
  line="$(grep -E '^[0-9]+/[0-9]+ cases passed$' "$OUT/spec.$i.out" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    spec_missing=1
  else
    spec_ok=$((spec_ok + ${line%%/*}))
    t="${line#*/}"
    spec_total=$((spec_total + ${t%% *}))
  fi
  i=$((i + 1))
done
[[ $spec_missing -eq 1 ]] || echo "$spec_ok/$spec_total cases passed" >>"$OUT/spec.out"
echo "$spec_rc" >"$OUT/spec.rc"

for suite in run-guard-tests.sh run-spec-first-tests.sh; do
  echo "== $suite"
  name=guard
  [[ "$suite" == run-guard-tests.sh ]] || name=spec
  out="$(cat "$OUT/$name.out")"
  rc="$(cat "$OUT/$name.rc")"
  [[ -z "$out" ]] || printf '%s\n' "$out"
  summary="$(printf '%s\n' "$out" | grep -E '^[0-9]+/[0-9]+ cases passed$' | tail -n 1 || true)"
  if [[ -z "$summary" ]]; then
    echo "suite $suite produced no summary line (rc=$rc)"
    broken=$((broken + 1))
    continue
  fi
  ok="${summary%%/*}"
  total="${summary#*/}"
  total="${total%% *}"
  pass=$((pass + ok))
  fail=$((fail + total - ok))
  [[ $rc -eq 0 || $((total - ok)) -gt 0 ]] || broken=$((broken + 1))
done

echo "== total: $pass passed, $fail failed"
[[ $fail -eq 0 && $broken -eq 0 ]]
