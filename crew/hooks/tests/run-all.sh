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

echo "== schema hygiene"
SCHEMA="$HERE/../crew.schema.json"
TEMPLATE="$HERE/../../skills/adopt/templates/crew.json"
check() { # check <label> <ok: 0 passes>
  if [[ "$2" -eq 0 ]]; then pass=$((pass + 1)); else echo "FAIL $1"; fail=$((fail + 1)); fi
}
# Keys of a config that its schema does not describe, recursively through object properties and array items.
UNKNOWN_KEYS='def unk($s): if type == "object" and ($s | has("properties")) then to_entries[] | .key as $k | if ($s.properties | has($k)) then (.value | unk($s.properties[$k]) | "\($k)." + .) else $k end elif type == "array" and ($s | has("items")) then .[] | unk($s.items) else empty end;
  $schema[0] as $root | unk($root)'
for f in "$EX" "$TEMPLATE" "$HERE"/fixtures/*.json; do
  bad="$(jq -r --slurpfile schema "$SCHEMA" "$UNKNOWN_KEYS" "$f" 2>&1)"
  check "$(basename "$f") uses keys the schema does not define: $bad" "$([[ -z "$bad" ]] && echo 0 || echo 1)"
done
# Values of a config against the schema keywords it actually uses: type, enum, pattern, minLength, minimum, maximum,
# minItems, items and required, recursively through properties and items. strict=false skips pattern and minLength
# (the adopt template holds <PLACEHOLDER> strings that are filled in at adoption).
BAD_VALUES='def istype($t): if $t == "integer" then (type == "number" and . == floor) else type == $t end;
  def viol($s; $p):
    . as $v
    | (if ($s | has("type")) and ($v | istype($s.type) | not) then "\($p) is not \($s.type)" else empty end),
      (if ($s | has("enum")) and (any($s.enum[]; . == $v) | not) then "\($p) is not one of \($s.enum | tojson)" else empty end),
      (if ($v | type) == "string" and $strict and ($s | has("pattern")) and ($v | test($s.pattern) | not) then "\($p) \($v | tojson) does not match \($s.pattern)" else empty end),
      (if ($v | type) == "string" and $strict and ($s | has("minLength")) and ($v | length) < $s.minLength then "\($p) \($v | tojson) is shorter than \($s.minLength)" else empty end),
      (if ($v | type) == "number" and ($s | has("minimum")) and $v < $s.minimum then "\($p) \($v) is below \($s.minimum)" else empty end),
      (if ($v | type) == "number" and ($s | has("maximum")) and $v > $s.maximum then "\($p) \($v) is above \($s.maximum)" else empty end),
      (if ($v | type) == "array" and ($s | has("minItems")) and ($v | length) < $s.minItems then "\($p) has fewer than \($s.minItems) items" else empty end),
      (if ($v | type) == "array" and ($s | has("items")) then range($v | length) as $i | $v[$i] | viol($s.items; "\($p)[\($i)]") else empty end),
      (if ($v | type) == "object" and ($s | has("required")) then $s.required[] | select(. as $k | $v | has($k) | not) | "\($p) lacks required \(.)" else empty end),
      (if ($v | type) == "object" and ($s | has("properties")) then $v | keys[] as $k | select($s.properties | has($k)) | $v[$k] | viol($s.properties[$k]; "\($p).\($k)") else empty end);
  $schema[0] as $root | viol($root; "$")'
for f in "$EX" "$TEMPLATE" "$HERE"/fixtures/*.json; do
  strict=true
  [[ "$f" != "$TEMPLATE" ]] || strict=false
  bad="$(jq -r --argjson strict "$strict" --slurpfile schema "$SCHEMA" "$BAD_VALUES" "$f" 2>&1)"
  check "$(basename "$f") holds values the schema rejects: $bad" "$([[ -z "$bad" ]] && echo 0 || echo 1)"
done
# The value check must itself catch each kind of violation, or it would pass vacuously.
for probe in '{"specFirst":{"roots":[{"path":"src"}],"sourceExtensions":[".ts"],"testPatterns":["tests/*.py",""]}}' \
  '{"baseBranch":7}' '{"managerModel":"gpt"}' '{"protectedBranches":[]}' '{"protectedBranches":["a b"]}' \
  '{"specFirst":{"roots":[{"path":"src","moduleDepth":10}],"sourceExtensions":[".ts"]}}' \
  '{"specFirst":{"roots":[{"path":"src","moduleDepth":"1"}],"sourceExtensions":[".ts"]}}' \
  '{"specFirst":{"roots":[{"moduleDepth":1}],"sourceExtensions":[".ts"]}}' '{"updateWorkflow":"no"}'; do
  caught="$(printf '%s' "$probe" | jq -r --argjson strict true --slurpfile schema "$SCHEMA" "$BAD_VALUES" 2>&1)"
  check "the schema value check does not flag $probe" "$([[ -n "$caught" ]] && echo 0 || echo 1)"
done
# A relative $schema must resolve from the file's own folder (the template names its vendored location, so it is skipped).
for f in "$EX" "$HERE"/fixtures/*.json; do
  ref="$(jq -r '."$schema" // empty' "$f")"
  check "$(basename "$f") \$schema '$ref' does not point at crew.schema.json" "$([[ -z "$ref" || "$(cd "$(dirname "$f")" && cd "$(dirname "$ref")" && pwd)/$(basename "$ref")" == "$(cd "$(dirname "$SCHEMA")" && pwd)/crew.schema.json" ]] && echo 0 || echo 1)"
done
# Defaults restated in the hooks must equal the schema's "default" values. Each hook line is read by pattern:
# if a hook is reworded the extraction comes up empty and the check fails, so edit both together.
sdef() { jq -c "$1.default" "$SCHEMA"; }
GUARD="$HERE/../guard-destructive.sh"
SPEC="$HERE/../require-spec-first.sh"
hook_branches="$(sed -n 's/^BRANCHES=(\(.*\))$/\1/p' "$GUARD" | head -n 1 | tr ' ' '\n' | jq -R . | jq -sc .)"
check "guard BRANCHES default ($hook_branches) differs from schema protectedBranches default $(sdef .properties.protectedBranches)" "$([[ "$hook_branches" == "$(sdef .properties.protectedBranches)" ]] && echo 0 || echo 1)"
hook_base="$(sed -n 's/.*(\.baseBranch \/\/ \("[^"]*"\)).*/\1/p' "$SPEC" | head -n 1)"
check "spec-first baseBranch default ($hook_base) differs from the schema default $(sdef .properties.baseBranch)" "$([[ "$hook_base" == "$(sdef .properties.baseBranch)" ]] && echo 0 || echo 1)"
hook_depth="$(sed -n 's/.*(\.moduleDepth \/\/ \([0-9]*\)).*/\1/p' "$SPEC" | head -n 1)"
check "spec-first moduleDepth default ($hook_depth) differs from the schema default $(sdef .properties.specFirst.properties.roots.items.properties.moduleDepth)" "$([[ "$hook_depth" == "$(sdef .properties.specFirst.properties.roots.items.properties.moduleDepth)" ]] && echo 0 || echo 1)"
hook_mode="$(sed -n 's/.*\${RAW_MODE:-\([a-z]*\)}.*/"\1"/p' "$SPEC" | head -n 1)"
check "spec-first mode default ($hook_mode) differs from the schema default $(sdef .properties.specFirst.properties.mode)" "$([[ "$hook_mode" == "$(sdef .properties.specFirst.properties.mode)" ]] && echo 0 || echo 1)"
tp_schema="$(sdef .properties.specFirst.properties.testPatterns)"
tp_jq="$(sed -n '/specFirst\.testPatterns/s/.*else \(\[[^]]*\]\) end.*/\1/p' "$SPEC" | head -n 1 | jq -c . 2>/dev/null)"
tp_bash="$(sed -n 's/^\[\[ \${#TESTS\[@\]} -gt 0 \]\] || TESTS=(\(.*\))$/\1/p' "$SPEC" | head -n 1 | tr -d '"' | tr ' ' '\n' | jq -R . | jq -sc .)"
check "spec-first testPatterns default in the jq filter ($tp_jq) differs from the schema default $tp_schema" "$([[ "$tp_jq" == "$tp_schema" ]] && echo 0 || echo 1)"
check "spec-first testPatterns default in bash ($tp_bash) differs from the schema default $tp_schema" "$([[ "$tp_bash" == "$tp_schema" ]] && echo 0 || echo 1)"
check "spec-first ignoreRegex default is not []: schema says $(sdef .properties.specFirst.properties.ignoreRegex)" "$([[ "$(sdef .properties.specFirst.properties.ignoreRegex)" == "[]" ]] && grep -q 'specFirst.ignoreRegex | if type == "array" then . else \[\] end' "$SPEC" && echo 0 || echo 1)"

# Opt-in workflow flags: flat booleans, off by default, shown in the example.
for key in confirmRed openPullRequest; do
  check "schema $key is type boolean" "$([[ "$(jq -r --arg k "$key" '.properties[$k].type // "missing"' "$SCHEMA")" == "boolean" ]] && echo 0 || echo 1)"
  check "schema $key default is false" "$([[ "$(jq -c --arg k "$key" '.properties[$k].default' "$SCHEMA")" == "false" ]] && echo 0 || echo 1)"
  check "crew.example.json carries $key" "$(jq -e --arg k "$key" 'has($k)' "$EX" >/dev/null 2>&1 && echo 0 || echo 1)"
done

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

echo "== runner self-check"
selfcheck_out="$(bash "$HERE/run-runner-selfcheck.sh" 2>&1)"
selfcheck_rc=$?
[[ -z "$selfcheck_out" ]] || printf '%s\n' "$selfcheck_out"
if [[ $selfcheck_rc -eq 0 ]]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi

echo "== total: $pass passed, $fail failed"
[[ $fail -eq 0 && $broken -eq 0 ]]
