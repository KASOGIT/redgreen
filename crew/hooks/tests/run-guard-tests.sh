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
#   maxms      fail when the hook takes longer than this many milliseconds (an absolute limit: keep it far
#              above the measured time, since the suites run concurrently under bin/check)
#   maxcpums   fail when the CPU time (user + sys of the hook and its children) of 8 hook runs on cmd exceeds
#              this many milliseconds. Prefer it to maxms: CPU time rose at most 1.6x under the contention of
#              concurrent suites (more on efficiency cores), so bounds sit 5x (10x for the heaviest case) above
#              the measured cost and still catch a regression. A hook that idles uses no CPU, so the 8 runs
#              also fail when their wall-clock time exceeds GUARD_WALL_CEILING_MS (env, default 24000 ms,
#              that is 8 runs x 3000 ms)
#   scalecmd   with maxratio: a smaller command of the same shape. The case fails when the CPU time of 8 hook
#              runs on cmd, divided by that of 8 runs on scalecmd, exceeds maxratio
#   maxratio   a scaling limit for a hook that must stay linear: CPU time (user + sys of the hook and its
#              children) does not move under the load of concurrent suites the way wall time does. Linear
#              growth gives about the size ratio (plus the fixed start-up cost), quadratic growth its square
#   locale     value of LC_ALL for the hook (a UTF-8 locale makes bash count characters, not bytes)
#   noprojdir  true: CLAUDE_PROJECT_DIR is left unset (the hook must find the config from cwd)
#   stderr     list of strings that must all appear (case-insensitive) in the hook's stderr
# CLAUDE_PROJECT_DIR points at the case's repo directory unless noprojdir is set.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="${GUARD_HOOK:-$HERE/../guard-destructive.sh}"
CASES="${GUARD_CASES:-$HERE/guard-cases.jsonl}"
source "$HERE/lib.sh"
require_tools jq

scratch_setup
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
now_ms() { perl -MTime::HiRes=time -e 'print int(time*1000)'; }

# hook_cpu_ms <hook input>: runs the hook 8 times in the current case's environment, prints the total CPU
# milliseconds of those runs (the clock ticks every 10 ms, so one run is too coarse to compare).
hook_cpu_ms() {
  printf '%s' "$1" >"$TMP/scale.in"
  perl -e 'my $in = shift; open(my $so, ">&", \*STDOUT); for (1 .. 8) { open(STDIN, "<", $in); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null"); system(@ARGV); }
    open(STDOUT, ">&", $so); my @t = times; print int(($t[2] + $t[3]) * 1000)' "$TMP/scale.in" \
    env -u CLAUDE_PROJECT_DIR -u CREW_FALLBACK_PATH ${env_args[@]+"${env_args[@]}"} PATH="$hook_path" "$BASH_BIN" "$HOOK"
}

load_cases --arg d "$TMP" '[.expect, (.repo // "none"), (.env // "-"), (.locale // "-"), ((.noprojdir // false) | tostring), (has("config") | tostring), ((.maxms // 0) | tostring), ((.maxcpums // 0) | tostring), ((.maxratio // 0) | tostring), ((.stderr // []) | join("\u001e")),
  ({tool_input: {command: .cmd}, cwd: ($d + "/" + (.repo // "none"))} | tojson), (.cmd | tojson), (if has("scalecmd") then ({tool_input: {command: .scalecmd}, cwd: ($d + "/" + (.repo // "none"))} | tojson) else "" end), (if has("config") then (.config | tojson) else "" end)] | join("\u001f")'
# One jq pass reads every case: a record per line, fields joined by the unit separator. The hook
# input and the command travel as compact JSON (single line, control characters escaped).
while IFS="$SEP" read -r expect repo envname locale noproj has_config maxms maxcpums maxratio stderr_has input cmd_json scale_input config_json; do
  total=$((total + 1))
  mkdir -p "$TMP/$repo/.claude"
  rm -f "$TMP/$repo/.claude/crew.json"
  [[ "$has_config" != true ]] || printf '%s' "$config_json" | jq -j '.' >"$TMP/$repo/.claude/crew.json"
  env_args=()
  [[ "$noproj" == true ]] || env_args+=(CLAUDE_PROJECT_DIR="$TMP/$repo")
  apply_env_mode "$envname"
  [[ "$locale" == - ]] || env_args+=(LC_ALL="$locale")
  t0=0
  [[ "$maxms" -eq 0 ]] || t0="$(now_ms)"
  set +e
  out="$(printf '%s' "$input" | env -u CLAUDE_PROJECT_DIR -u CREW_FALLBACK_PATH ${env_args[@]+"${env_args[@]}"} PATH="$hook_path" "$BASH_BIN" "$HOOK" 2>"$TMP/hook.stderr")"
  rc=$?
  set -e
  if [[ $rc -ne 0 && $rc -ne 2 ]]; then
    cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
    record_fail "hook exited $rc (only 0 and 2 are verdicts): ${cmd:0:120}"
    continue
  fi
  t1=0
  [[ "$maxms" -eq 0 ]] || t1="$(now_ms)"
  if [[ "$maxratio" -gt 0 ]]; then
    small_cpu="$(hook_cpu_ms "$scale_input")"
    big_cpu="$(hook_cpu_ms "$input")"
    [[ "$small_cpu" -ge 1 ]] || small_cpu=1
    if [[ $((big_cpu * 100 / small_cpu)) -gt $((maxratio * 100)) ]]; then
      cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
      record_fail "scaling: ${big_cpu} ms CPU vs ${small_cpu} ms for 8 runs is $((big_cpu * 100 / small_cpu))% (limit $((maxratio * 100))%): ${cmd:0:60}"
      continue
    fi
  fi
  if [[ "$maxcpums" -gt 0 ]]; then
    w0="$(now_ms)"
    cpu="$(hook_cpu_ms "$input")"
    w1="$(now_ms)"
    if [[ "$cpu" -gt "$maxcpums" ]]; then
      cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
      record_fail "cpu: ${cpu} ms for 8 runs, limit ${maxcpums}: ${cmd:0:60}"
      continue
    fi
    wall_ceiling="${GUARD_WALL_CEILING_MS:-24000}"
    if [[ $((w1 - w0)) -gt "$wall_ceiling" ]]; then
      cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
      record_fail "wall: $((w1 - w0)) ms for 8 runs, ceiling ${wall_ceiling}: ${cmd:0:60}"
      continue
    fi
  fi
  if [[ "$maxms" -gt 0 ]]; then
    if [[ $((t1 - t0)) -gt "$maxms" ]]; then
      cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
      record_fail "took $((t1 - t0)) ms, limit $maxms: ${cmd:0:60}"
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
    cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
    record_fail "expected=$expect got=$got repo=$repo: ${cmd:0:120}"
  elif [[ -n "$stderr_has" ]]; then
    IFS=$'\x1e' read -r -a wanted <<<"$stderr_has"
    for w in "${wanted[@]}"; do
      if ! grep -qiF -- "$w" "$TMP/hook.stderr"; then
        cmd="$(printf '%s' "$cmd_json" | jq -r '.')"
        record_fail "stderr lacks '$w' (got: $(head -c 120 "$TMP/hook.stderr" | tr '\n' ' ')): $cmd"
        break
      fi
    done
  fi
done <"$TMP/cases.records"

finish_run ran "$total"
