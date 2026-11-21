#!/usr/bin/env bash
# Runs every case in spec-first-cases.jsonl against ../require-spec-first.sh in scratch git repos.
# A case: {"name", "file", "expect", ...optional fields}. "file" is relative to the repo root.
# Unless "new" is true the target file is created in the scratch repo first (a gated edit needs an
# existing file; a missing one is scaffolding).
# Every case runs with the project config <repo>/.claude/crew.json, which is fixtures/api-layout.json (a nested
# layout with numeric-prefixed shared layers) unless the case says otherwise ("base": "example" uses ../crew.example.json). CLAUDE_PLUGIN_DATA points at a per-case directory that
# does not exist yet, and the log is read from <that directory>/hook-log.jsonl.
#   expect    silent   exit 0, no output, no log line
#             logged   exit 0, no output, one valid would_block log line per run (nudged false), no file contents
#             scaffold exit 0, no output, one valid log line per run with new_file true, would_block false
#             nudged   exit 0, one valid log line per run (none when "log" is false), and per run the stdout
#                      the "pattern" asks for: N = exactly one JSON object whose only content is
#                      hookSpecificOutput {hookEventName PreToolUse, additionalContext}, with no
#                      permissionDecision, and nudged true in its log line, S = nothing and nudged
#                      false. One marker file under the case's TMPDIR per N.
#             blocked  exit 2, "spec-first:" on stderr (and the config's ruleFile when it has one), no log line
#   mode      nudge (default) | shadow | enforce | off | unset (CREW_POLICY_MODE not set) | empty (set to "")
#             | any other value. Matched case-insensitively. The log line must carry the effective mode,
#             nudge or shadow: from the env var when it is set and not empty, else from the config, else nudge.
#   config     config edit: a jq program applied to the base config (for example
#              "del(.specFirst.ruleFile)" or ".specFirst.mode = \"enforce\"")
#   base       "example": start from ../crew.example.json instead of the fixture
#   configRaw  text written verbatim as the config file (replaces config; may be malformed on purpose)
#   noconfig   true: no config file at all
#   configmode chmod applied to the config file, for example "000" (skipped as root)
#   pattern   with expect nudged, one N or S per run (default N for a single run)
#   runs      [{"file", "session", "new", "agent", "context"}, ...]: one hook run per entry against the same
#             repo, each entry overriding the case's file, the session id (default sess-1), new, agent, context
#   agent     agent_id sent in the input (a subagent call); default none
#   nosession true: the input has no session_id
#   log       false: with expect nudged, no log line is expected (unwritable or unset log directory)
#   context   expected "context" field of the log line ("<none>" for the empty one; default: the 4th path component, for the nested api layout)
#   scope     substring the nudge must name as its scope (default derived from the nested api layout)
#   repo      feature (default: branch off origin/main, no upstream) | noorigin (no remote, local main stays) | nobase (no remote and no local main) | nogit
#             | worktree (hook runs in a linked worktree)
#             | symlink (hook runs through a symlinked checkout path)
#   setup     ["<verb> <repo-relative path>", ...] applied before the hook runs:
#             modify (append to a tracked file), untracked (new file), add (new file, staged),
#             commit (create or append, commit on the branch), delete (rm a tracked file),
#             commitdelete (git rm, commit on the branch), detach (detach HEAD),
#             readonly-metrics (make the plugin data directory read-only),
#             basebranch (create refs/remotes/origin/<path> at origin/main),
#             localbranch (create or move local branch <path> to main), localbranchhead (same, to HEAD)
#   pathmode  abs (default) | rel (relative to the repo root) | relapi (relative to services/core) | nocwd
#   tool      Edit (default) | Write | MultiEdit
#   env       nojq | nogit: run with a PATH that lacks the tool
#             noprojdir: CLAUDE_PROJECT_DIR unset, run from services/core (the project is found from cwd)
#             badprojdir: CLAUDE_PROJECT_DIR points at a path that does not exist
#             badtmpdir: TMPDIR points at a path that does not exist
#             reltmpdir: TMPDIR is relative (the hook runs inside the directory that would receive the marker)
#             fifo: a FIFO sits at the marker path of the first run (the hook must not hang, 10 s limit)
#             minpath: PATH has only core tools; jq and git are reachable only through CREW_FALLBACK_PATH
#             nodata: CLAUDE_PLUGIN_DATA unset
#             baddata: CLAUDE_PLUGIN_DATA is a path below a regular file
#   new       true: the target file does not exist yet (default false)
#   repeat    run the hook N times against the same repo (default 1); expects N log lines. Ignored with runs
#   branch    expected branch in the log line (default feature/x, feature/wt for worktree)
#   skip_if_root  true: skip when running as root, where chmod cannot make a path unreadable
#   input     raw stdin; overrides everything else
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="${SPEC_FIRST_HOOK:-$HERE/../require-spec-first.sh}"
HOOK="$(cd "$(dirname "$HOOK")" && pwd)/$(basename "$HOOK")"
CASES="${SPEC_FIRST_CASES:-$HERE/spec-first-cases.jsonl}"
BASE_CONFIG="$HERE/fixtures/api-layout.json"
EXAMPLE_CONFIG="$HERE/../crew.example.json"
source "$HERE/lib.sh"
require_tools jq git

scratch_setup

git_in() { local dir="$1"; shift; git -C "$dir" -c user.email=t@t -c user.name=t -c commit.gpgsign=false "$@"; }

TEMPLATE="$TMP/template"
git init -q --bare "$TMP/remote.git"
git init -q -b main "$TEMPLATE"
for f in \
  services/core/src/orders/Existing.usecase.ts \
  services/core/src/orders/Existing.usecase.int.spec.ts \
  services/core/src/orders/refund/Refund.usecase.ts \
  services/core/src/shipping/Other.usecase.ts \
  services/core/src/shipping/Other.usecase.int.spec.ts \
  services/core/src/orders-gateway/Gateway.ts \
  services/core/src/00_adapters/logger/logger.ts; do
  mkdir -p "$TEMPLATE/$(dirname "$f")"
  echo "// baseline" >"$TEMPLATE/$f"
done
echo "ignored-dir/" >"$TEMPLATE/.gitignore"
git_in "$TEMPLATE" add -A
git_in "$TEMPLATE" commit -q -m baseline
git_in "$TEMPLATE" remote add origin "$TMP/remote.git"
git_in "$TEMPLATE" push -q -u origin main
git_in "$TEMPLATE" checkout -q -b feature/x
git_in "$TEMPLATE" branch --unset-upstream 2>/dev/null || true

apply() {
  local dir="$1" verb="$2" path="$3"
  mkdir -p "$dir/$(dirname "$path")"
  case "$verb" in
    modify) [[ -f "$dir/$path" ]] || { echo "setup: modify needs an existing file: $path" >&2; exit 1; }
            echo "// modify" >>"$dir/$path" ;;
    untracked) echo "// untracked" >>"$dir/$path" ;;
    add) echo "// add" >>"$dir/$path"; git_in "$dir" add -- "$path" ;;
    commit) echo "// commit" >>"$dir/$path"; git_in "$dir" add -- "$path"; git_in "$dir" commit -q -m "commit $path" ;;
    delete) rm -f "$dir/$path" ;;
    commitdelete) git_in "$dir" rm -q -- "$path"; git_in "$dir" commit -q -m "delete $path" ;;
    detach) git_in "$dir" checkout -q --detach ;;
    readonly-metrics) mkdir -p "$datadir"; chmod 555 "$datadir" ;;
    basebranch) git_in "$dir" update-ref "refs/remotes/origin/$path" refs/remotes/origin/main ;;
    localbranch) git_in "$dir" branch -f "$path" main ;;
    localbranchhead) git_in "$dir" branch -f "$path" HEAD ;;
    *) echo "setup: unknown verb: $verb" >&2; exit 1 ;;
  esac
}

norm_mode() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    nudge) echo nudge ;;
    enforce) echo enforce ;;
    off) echo off ;;
    *) echo shadow ;;
  esac
}

LOG_KEYS='["branch", "context", "file", "mode", "new_file", "nudged", "project", "session_id", "tool", "ts", "would_block"]'
NUDGE_OK='
  keys == ["hookSpecificOutput"]
  and (.hookSpecificOutput | keys) == ["additionalContext", "hookEventName"]
  and .hookSpecificOutput.hookEventName == "PreToolUse"
  and (.hookSpecificOutput.additionalContext | type == "string"
       and (split(" ") | length) >= 40 and (split(" ") | length) <= 80
       and contains("one line") and contains("exempt")
       and (if $rule != "" then contains("The project rule, " + $rule + ", is to") else contains("The project rule is to") end)
       and (contains("require-spec-first") | not) and (contains("LEAK-MARKER") | not))'

RS=$'\x1e'
# SHARD_COUNT and SHARD_INDEX (run-all.sh sets them) make this process run only every SHARD_COUNT-th case.
SHARD_COUNT="${SHARD_COUNT:-1}"
SHARD_INDEX="${SHARD_INDEX:-0}"

n=0
idx=0
load_cases '[.name, .file // "", .expect, .mode // "nudge", .repo // "feature", .pathmode // "abs", .tool // "Edit", .env // "-", (has("input") | tostring), ((.new // false) | tostring), (if has("runs") then (.runs | length) else (.repeat // 1) end | tostring), (has("branch") | tostring), (.branch // ""), ((.skip_if_root // false) | tostring), (has("runs") | tostring), (.pattern // "-"), ((.nosession // false) | tostring), (if has("log") then .log else true end | tostring), (.agent // ""),
  (.config // "."), ((.configRaw // "") | tojson), (has("configRaw") | tostring), ((.noconfig // false) | tostring), (.configmode // ""), (.context // ""), (.scope // ""), (.base // ""),
  (if has("input") then (.input | tojson) else "" end),
  (. as $c | ([{file: $c.file, new: ($c.new // false)}] + [($c.runs // [])[] | {file: (.file // $c.file), new: (.new // $c.new // false)}]) | map(select(.file != null and .new == false) | .file) | unique | join("\u001e")),
  ((.setup // []) | join("\u001e")),
  ((.runs // []) | tojson)] | join("\u001f")'
# One jq pass reads every case: a record per line, fields joined by the unit separator, lists by the
# record separator. Free text that may hold control characters (raw input, raw config) travels as compact JSON.
while IFS="$SEP" read -r name file expect mode repo_kind pathmode tool envname has_input newfile repeat has_branch case_branch skip_root has_runs pattern nosession wantlog case_agent conf_edit conf_raw_json has_raw noconf confmode case_context case_scope case_base input_json files_field setup_field runs_json_all; do
  idx=$((idx + 1))
  [[ $((idx % SHARD_COUNT)) -eq "$SHARD_INDEX" ]] || continue
  n=$((n + 1))
  [[ "$expect" != nudged || "$pattern" != - ]] || pattern=N
  IFS="$RS" read -ra files_arr <<<"$files_field"
  IFS="$RS" read -ra setup_arr <<<"$setup_field"

  if [[ ( "$skip_root" == true || -n "$confmode" ) && "$(id -u)" -eq 0 ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  total=$((total + 1))

  repo="$TMP/cases/$n"
  mkdir -p "$TMP/cases"
  cp -R "$TEMPLATE" "$repo"
  work="$repo"
  branch="feature/x"
  case "$repo_kind" in
    noorigin) git_in "$repo" remote remove origin ;;
    nobase) git_in "$repo" remote remove origin; git_in "$repo" branch -q -D main ;;
    nogit) rm -rf "$repo/.git" ;;
    worktree) work="$TMP/wt/$n"; mkdir -p "$TMP/wt"; git_in "$repo" worktree add -q -b feature/wt "$work"; branch="feature/wt" ;;
    symlink) mkdir -p "$TMP/link"; work="$TMP/link/$n"; ln -s "$repo" "$work" ;;
  esac
  [[ "$has_branch" == true ]] && branch="$case_branch"

  conf="$work/.claude/crew.json"
  if [[ "$noconf" != true ]]; then
    mkdir -p "$work/.claude"
    if [[ "$has_raw" == true ]]; then
      printf '%s' "$conf_raw_json" | jq -j '.' >"$conf"
    else
      base_file="$BASE_CONFIG"; [[ "$case_base" != example ]] || base_file="$EXAMPLE_CONFIG"
      jq "$conf_edit" "$base_file" >"$conf"
    fi
    [[ -z "$confmode" ]] || chmod "$confmode" "$conf"
  fi
  rule=""
  cfg_mode=nudge
  if [[ "$noconf" != true && -z "$confmode" ]]; then
    IFS="$SEP" read -r rule cfg_mode <<<"$(jq -r '[(.specFirst.ruleFile // ""), (.specFirst.mode // "nudge")] | join("\u001f")' "$conf" 2>/dev/null || true)"
    [[ -n "$cfg_mode" ]] || cfg_mode=nudge
  fi
  if [[ "$mode" == unset || "$mode" == empty ]]; then eff_mode="$(norm_mode "$cfg_mode")"; else eff_mode="$(norm_mode "$mode")"; fi

  datadir="$TMP/plugdata/$n"
  if [[ "$envname" == baddata ]]; then
    mkdir -p "$TMP/plugdata"
    : >"$TMP/plugdata/$n.file"
    datadir="$TMP/plugdata/$n.file/sub"
  fi
  log="$datadir/hook-log.jsonl"

  if [[ "$has_input" != true && "$newfile" != true ]]; then
    while IFS= read -r f; do
      [[ -z "$f" || -e "$work/$f" ]] && continue
      mkdir -p "$work/$(dirname "$f")"
      echo "// target" >"$work/$f"
    done < <(printf '%s\n' ${files_arr[@]+"${files_arr[@]}"})
  fi
  while IFS= read -r op; do
    [[ -z "$op" ]] && continue
    apply "$work" "${op%% *}" "${op#* }"
  done < <(printf '%s\n' ${setup_arr[@]+"${setup_arr[@]}"})

  run_dir="$TMP"
  env_args=()
  tmpd="$TMP/tmpdirs/$n"
  mkdir -p "$tmpd"
  proj_expect="$work"
  case "$envname" in
    noprojdir) run_dir="$repo/services/core"; proj_expect="" ;;
    badprojdir) env_args+=(CLAUDE_PROJECT_DIR="$TMP/elsewhere"); proj_expect="" ;;
    *) env_args+=(CLAUDE_PROJECT_DIR="$work") ;;
  esac
  apply_env_mode "$envname"
  case "$envname" in
    badtmpdir) env_args+=(TMPDIR="$TMP/no-such-tmpdir") ;;
    reltmpdir) env_args+=(TMPDIR=.); run_dir="$tmpd" ;;
    *) env_args+=(TMPDIR="$tmpd") ;;
  esac
  [[ "$envname" == nodata ]] || env_args+=(CLAUDE_PLUGIN_DATA="$datadir")
  guard_cmd=()
  if [[ "$envname" == fifo ]]; then
    guard_cmd=(perl -e 'alarm 10; exec @ARGV')
    read -r fh fl _ <<<"$(printf '%s\n%s\n%s' sess-1 "$(printf '%s' "$file" | cut -d/ -f4)" "$case_agent" | cksum)"
    mkfifo "$tmpd/crew-spec-first-nudge-$(id -u)-$fh-$fl"
  fi
  env_args+=(PATH="$hook_path")
  [[ "$mode" == unset ]] || env_args+=(CREW_POLICY_MODE="$([[ "$mode" == empty ]] || printf '%s' "$mode")")

  rm -f "$TMP"/out.*
  : >"$TMP/err"
  rc=0
  runs_json="[]"
  for ((i = 0; i < repeat; i++)); do
    run_file="$file"
    run_sess="sess-1"
    run_new="$newfile"
    run_agent="$case_agent"
    run_ctx_override="$case_context"
    if [[ "$has_runs" == true ]]; then
      IFS="$SEP" read -r rf rs rn ra rc_ <<<"$(printf '%s' "$runs_json_all" | jq -r --argjson i "$i" '.[$i] | [.file // "", .session // "", ((.new // "-") | tostring), .agent // "", .context // ""] | join("\u001f")')"
      [[ -z "$rf" ]] || run_file="$rf"
      [[ -z "$rs" ]] || run_sess="$rs"
      [[ "$rn" == - ]] || run_new="$rn"
      [[ -z "$ra" ]] || run_agent="$ra"
      [[ -z "$rc_" ]] || run_ctx_override="$rc_"
    fi
    run_nudged=false
    [[ "$expect" != nudged || "${pattern:i:1}" != N ]] || run_nudged=true
    [[ "$nosession" != true ]] || run_sess=""
    ctx="$(printf '%s' "$run_file" | cut -d/ -f4)"
    [[ -z "$run_ctx_override" ]] || ctx="$run_ctx_override"
    [[ "$run_ctx_override" != "<none>" ]] || ctx=""
    runs_json="$(jq -c --arg f "$run_file" --arg s "$run_sess" --arg c "$ctx" --argjson n "$run_new" --argjson u "$run_nudged" '. + [{file: $f, session: ($s | gsub("[\u0000-\u001f]"; "")), context: $c, new: $n, nudged: $u}]' <<<"$runs_json")"

    if [[ "$has_input" == true ]]; then
      printf '%s' "$input_json" | jq -j '.' >"$TMP/in.json"
    else
      cwd="$work"
      path="$work/$run_file"
      case "$pathmode" in
        rel) path="$run_file" ;;
        relapi) path="${run_file#services/core/}"; cwd="$work/services/core" ;;
        nocwd) cwd="" ;;
      esac
      jq -n --arg p "$path" --arg c "$cwd" --arg t "$tool" --arg s "$run_sess" --arg a "$run_agent" \
        '{tool_name: $t, tool_input: {file_path: $p, content: "LEAK-MARKER", new_string: "LEAK-MARKER"}} + (if $s == "" then {} else {session_id: $s} end) + (if $c == "" then {} else {cwd: $c} end) + (if $a == "" then {} else {agent_id: $a, agent_type: "general-purpose"} end)' >"$TMP/in.json"
    fi

    : >"$TMP/out.$i"
    set +e
    (cd "$run_dir" && env -u CREW_POLICY_MODE -u CLAUDE_PROJECT_DIR -u CLAUDE_PLUGIN_DATA -u TMPDIR "${env_args[@]}" ${guard_cmd[@]+"${guard_cmd[@]}"} "$BASH_BIN" "$HOOK" <"$TMP/in.json" >"$TMP/out.$i" 2>>"$TMP/err")
    run_rc=$?
    set -e
    [[ $rc -ne 0 ]] || rc=$run_rc
  done
  cat "$TMP"/out.* >"$TMP/out"

  lines=0
  [[ -f "$log" ]] && lines="$(wc -l <"$log" | tr -d ' ')"
  markers="$(find "$tmpd" -type f | wc -l | tr -d ' ')"
  stray="$(find "$HOME" -type f 2>/dev/null | head -n 1)"
  if [[ -z "$stray" ]]; then
    stray="$(find "$repo" "$work" \( -path '*/.claude/metrics' -o -name 'hook-log.jsonl' -o -name 'crew-spec-first-nudge*' \) 2>/dev/null | head -n 1)"
  fi

  valid_log() {
    jq -e -s --argjson runs "$runs_json" --arg tool "$tool" --arg branch "$branch" --arg mode "$eff_mode" --arg proj "$proj_expect" --argjson keys "$LOG_KEYS" '
      length == ($runs | length) and ([., $runs] | transpose | all(.[]; . as [$l, $r] |
        ($l | keys) == $keys
        and $l.would_block == ($r.new | not) and $l.new_file == $r.new and $l.session_id == $r.session
        and $l.context == $r.context and $l.file == $r.file and $l.tool == $tool and $l.branch == $branch
        and $l.mode == $mode and $l.nudged == $r.nudged
        and ($l.project | type == "string" and length > 0 and ($proj == "" or . == $proj))
        and ($l.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))))' "$log" >/dev/null 2>&1 \
      && ! grep -q 'LEAK-MARKER' "$log"
  }

  nudge_count=0
  nudge_bad=""
  if [[ "$expect" == nudged ]]; then
    if [[ ${#pattern} -ne $repeat ]]; then
      nudge_bad="pattern '$pattern' does not match $repeat run(s)"
    else
      for ((i = 0; i < repeat; i++)); do
        case "${pattern:i:1}" in
          N)
            nudge_count=$((nudge_count + 1))
            run_ctx="$(jq -r ".[$i].context" <<<"$runs_json")"
            if [[ -n "$case_scope" ]]; then
              want_scope="$case_scope"
            elif [[ "$run_ctx" =~ ^[0-9]{2}_ ]]; then
              want_scope="services/core/src/"
            else
              want_scope="services/core/src/$run_ctx/"
            fi
            if [[ "$(wc -l <"$TMP/out.$i" | tr -d ' ')" != 1 ]] || ! jq -e -s --arg rule "$rule" "length == 1 and (.[0] | $NUDGE_OK)" "$TMP/out.$i" >/dev/null 2>&1; then
              nudge_bad="run $((i + 1)) did not print exactly one valid nudge: $(cat "$TMP/out.$i")"
            elif ! jq -e -s --arg scope "$want_scope" '.[0].hookSpecificOutput.additionalContext | contains($scope)' "$TMP/out.$i" >/dev/null 2>&1; then
              nudge_bad="run $((i + 1)) nudge does not name its scope $want_scope: $(cat "$TMP/out.$i")"
            fi ;;
          S) [[ ! -s "$TMP/out.$i" ]] || nudge_bad="run $((i + 1)) printed: $(cat "$TMP/out.$i")" ;;
          *) nudge_bad="bad pattern character '${pattern:i:1}'" ;;
        esac
      done
    fi
  fi

  blocked_msg_ok() {
    grep -q 'spec-first:' "$TMP/err" && { [[ -z "$rule" ]] || grep -qF "$rule" "$TMP/err"; }
  }

  got="rc=$rc lines=$lines stdout=$(wc -c <"$TMP/out" | tr -d ' ') stderr=$(wc -c <"$TMP/err" | tr -d ' ')"
  if [[ -n "$stray" ]]; then
    got="written outside CLAUDE_PLUGIN_DATA and TMPDIR: $stray"
  elif [[ "$markers" -ne "$nudge_count" ]]; then
    got="$markers marker file(s) under TMPDIR, expected $nudge_count"
  elif [[ "$expect" == nudged ]]; then
    if [[ -n "$nudge_bad" ]]; then
      got="$nudge_bad"
    elif [[ $rc -ne 0 || -s "$TMP/err" ]]; then
      :
    elif [[ "$wantlog" == false && $lines -eq 0 ]]; then
      got=nudged
    elif [[ "$wantlog" == true ]] && valid_log; then
      got=nudged
    else
      got="invalid or missing log: $(cat "$log" 2>/dev/null || true)"
    fi
  elif [[ $rc -eq 2 && ! -s "$TMP/out" && $lines -eq 0 ]] && blocked_msg_ok; then
    got=blocked
  elif [[ $rc -eq 0 && ! -s "$TMP/out" && ! -s "$TMP/err" && $lines -eq 0 ]]; then
    got=silent
  elif [[ $rc -eq 0 && ! -s "$TMP/out" && ! -s "$TMP/err" && $lines -eq $repeat ]]; then
    if valid_log; then
      if [[ "$newfile" == true ]]; then got=scaffold; else got=logged; fi
    else
      got="invalid log line: $(cat "$log" 2>/dev/null || true)"
    fi
  fi

  if [[ "$got" != "$expect" ]]; then
    record_fail "expected=$expect got=$got: $name"
  fi
done <"$TMP/cases.records"

finish_run read "$idx"
