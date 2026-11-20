#!/usr/bin/env bash
# Runs every case in guard-cases.jsonl against ../guard-destructive.sh.
# A case: {"cmd": "...", "expect": "allow|deny|ask", "repo": "none|main|feature|stable"}.
# repo=main runs in a scratch git repo on main tracking origin/main, stable on a branch tracking
# origin/stable, feature on a branch with no upstream, none (default) outside any repo.
# Optional per-case project config, written to <repo>/.claude/crew.json for that case only:
#   config     text written verbatim as the config file (may be malformed on purpose)
#   env        nojq | nogit: PATH lacks the tool and CREW_FALLBACK_PATH is empty; minpath: PATH holds only core
#              tools and jq and git are reachable only through CREW_FALLBACK_PATH; jqfail: PATH holds core
#              tools and a jq stub that exits 3
#   maxms      fail when the hook takes longer than this many milliseconds
#   noprojdir  true: CLAUDE_PROJECT_DIR is left unset (the hook must find the config from cwd)
#   stderr     list of strings that must all appear (case-insensitive) in the hook's stderr
# CLAUDE_PROJECT_DIR points at the case's repo directory unless noprojdir is set.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="${GUARD_HOOK:-$HERE/../guard-destructive.sh}"
CASES="${GUARD_CASES:-$HERE/guard-cases.jsonl}"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
mkdir -p "$HOME"
git init -q --bare "$TMP/remote.git"
git init -q -b main "$TMP/main"
git -C "$TMP/main" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$TMP/main" remote add origin "$TMP/remote.git"
git -C "$TMP/main" push -q -u origin main
git -C "$TMP/main" push -q origin main:stable
git clone -q "$TMP/remote.git" "$TMP/feature" 2>/dev/null
git -C "$TMP/feature" checkout -q -b feature/x
git -C "$TMP/feature" branch --unset-upstream 2>/dev/null || true
git clone -q -b stable "$TMP/remote.git" "$TMP/stable" 2>/dev/null
mkdir -p "$TMP/none"
mkdir -p "$TMP/core" "$TMP/corejq" "$TMP/fake" "$TMP/jqfail"
for t in cat grep egrep tr sed head tail mkdir cksum cut wc dirname basename find rm env sort uniq id; do
  p="$(command -v "$t" || true)"
  if [[ -n "$p" ]]; then ln -sf "$p" "$TMP/core/$t"; ln -sf "$p" "$TMP/corejq/$t"; ln -sf "$p" "$TMP/jqfail/$t"; fi
done
ln -sf "$(command -v jq)" "$TMP/corejq/jq"
printf '#!/bin/sh\nexit 3\n' >"$TMP/jqfail/jq"
chmod +x "$TMP/jqfail/jq"
ln -sf "$(command -v jq)" "$TMP/fake/jq"
ln -sf "$(command -v git)" "$TMP/fake/git"
BASH_BIN="$(command -v bash)"

SEP=$'\x1f'
now_ms() { perl -MTime::HiRes=time -e 'print int(time*1000)'; }

fail=0
total=0
if ! jq -r --arg d "$TMP" '[.expect, (.repo // "none"), (.env // "-"), ((.noprojdir // false) | tostring), (has("config") | tostring), ((.maxms // 0) | tostring), ((.stderr // []) | join("\u001e")),
  ({tool_input: {command: .cmd}, cwd: ($d + "/" + (.repo // "none"))} | tojson), (.cmd | tojson), (if has("config") then (.config | tojson) else "" end)] | join("\u001f")' "$CASES" >"$TMP/cases.records"; then
  echo "FAIL cannot parse cases file $CASES (malformed line?)" >&2
  exit 1
fi
expected_cases=$(grep -c . "$CASES")
# One jq pass reads every case: a record per line, fields joined by the unit separator. The hook
# input and the command travel as compact JSON (single line, control characters escaped).
while IFS="$SEP" read -r expect repo envname noproj has_config maxms stderr_has input cmd_json config_json; do
  total=$((total + 1))
  mkdir -p "$TMP/$repo/.claude"
  rm -f "$TMP/$repo/.claude/crew.json"
  [[ "$has_config" != true ]] || printf '%s' "$config_json" | jq -j '.' >"$TMP/$repo/.claude/crew.json"
  env_args=()
  [[ "$noproj" == true ]] || env_args+=(CLAUDE_PROJECT_DIR="$TMP/$repo")
  hook_path="$PATH"
  case "$envname" in
    nojq) hook_path="$TMP/core"; env_args+=(CREW_FALLBACK_PATH="") ;;
    nogit) hook_path="$TMP/corejq"; env_args+=(CREW_FALLBACK_PATH="") ;;
    jqfail) hook_path="$TMP/jqfail"; env_args+=(CREW_FALLBACK_PATH="") ;;
    minpath) hook_path="$TMP/core"; env_args+=(CREW_FALLBACK_PATH="$TMP/fake") ;;
  esac
  t0=0
  [[ "$maxms" -eq 0 ]] || t0="$(now_ms)"
  set +e
  out="$(printf '%s' "$input" | env -u CLAUDE_PROJECT_DIR -u CREW_FALLBACK_PATH ${env_args[@]+"${env_args[@]}"} PATH="$hook_path" "$BASH_BIN" "$HOOK" 2>"$TMP/hook.stderr")"
  rc=$?
  set -e
  if [[ "$maxms" -gt 0 ]]; then
    t1="$(now_ms)"
    if [[ $((t1 - t0)) -gt "$maxms" ]]; then
      fail=$((fail + 1))
      cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
      echo "FAIL took $((t1 - t0)) ms, limit $maxms: ${cmd:0:60}"
      continue
    fi
  fi
  got=allow
  if [[ $rc -eq 2 ]]; then
    got=deny
  elif [[ -n "$out" && $(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null) == ask ]]; then
    got=ask
  fi
  if [[ "$got" != "$expect" ]]; then
    fail=$((fail + 1))
    cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
    echo "FAIL expected=$expect got=$got repo=$repo: $cmd"
  elif [[ -n "$stderr_has" ]]; then
    IFS=$'\x1e' read -r -a wanted <<<"$stderr_has"
    for w in "${wanted[@]}"; do
      if ! grep -qiF -- "$w" "$TMP/hook.stderr"; then
        fail=$((fail + 1))
        cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
        echo "FAIL stderr lacks '$w' (got: $(head -c 120 "$TMP/hook.stderr" | tr '\n' ' ')): $cmd"
        break
      fi
    done
  fi
done <"$TMP/cases.records"

[[ $total -eq $expected_cases ]] || { echo "FAIL ran $total cases, $CASES holds $expected_cases" >&2; exit 1; }
echo "$((total - fail))/$total cases passed"
[[ $fail -eq 0 ]]
