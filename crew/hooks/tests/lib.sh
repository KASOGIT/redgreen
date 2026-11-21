# Shared by run-guard-tests.sh and run-spec-first-tests.sh: source it, then call scratch_setup.
# Needs the caller to set CASES before load_cases and finish_run. Counters: fail, total, skipped.

SEP=$'\x1f'
BASH_BIN="$(command -v bash)"
fail=0
total=0
skipped=0

# require_tools <tool>...: stop the runner with the tool's name when one is missing.
require_tools() {
  local t
  for t in "$@"; do command -v "$t" >/dev/null || { echo "$t is required" >&2; exit 1; }; done
}

# scratch_setup: scratch dir $TMP (removed on exit), a private HOME below it, and the tool folders the
# env modes put on PATH: core (core tools only), corejq (core + jq), jqfail (core + a jq that exits 3),
# fake (jq and git, for CREW_FALLBACK_PATH).
scratch_setup() {
  TMP="$(mktemp -d)"
  trap 'chmod -R u+w "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT
  export HOME="$TMP/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  mkdir -p "$HOME" "$TMP/core" "$TMP/corejq" "$TMP/fake" "$TMP/jqfail"
  local t p
  for t in cat grep egrep tr sed head tail mkdir cksum cut wc dirname basename find rm env sort uniq id date mktemp chmod ln; do
    p="$(command -v "$t" || true)"
    if [[ -n "$p" ]]; then ln -sf "$p" "$TMP/core/$t"; ln -sf "$p" "$TMP/corejq/$t"; ln -sf "$p" "$TMP/jqfail/$t"; fi
  done
  ln -sf "$(command -v jq)" "$TMP/corejq/jq"
  printf '#!/bin/sh\nexit 3\n' >"$TMP/jqfail/jq"
  chmod +x "$TMP/jqfail/jq"
  ln -sf "$(command -v jq)" "$TMP/fake/jq"
  ln -sf "$(command -v git)" "$TMP/fake/git"
}

# apply_env_mode <mode>: sets hook_path and appends to env_args for the modes both runners share
# (nojq, nogit, minpath, jqfail); any other mode leaves PATH as it is.
apply_env_mode() {
  hook_path="$PATH"
  case "$1" in
    nojq) hook_path="$TMP/core"; env_args+=(CREW_FALLBACK_PATH="") ;;
    nogit) hook_path="$TMP/corejq"; env_args+=(CREW_FALLBACK_PATH="") ;;
    jqfail) hook_path="$TMP/jqfail"; env_args+=(CREW_FALLBACK_PATH="") ;;
    minpath) hook_path="$TMP/core"; env_args+=(CREW_FALLBACK_PATH="$TMP/fake") ;;
  esac
}

# load_cases <jq args>: writes one record per case to $TMP/cases.records, counts the cases of $CASES.
load_cases() {
  if ! jq -r "$@" "$CASES" >"$TMP/cases.records"; then
    echo "FAIL cannot parse cases file $CASES (malformed line?)" >&2
    exit 1
  fi
  expected_cases=$(grep -c . "$CASES")
}

# record_fail <message>: counts a failed case and prints it.
record_fail() {
  fail=$((fail + 1))
  echo "FAIL $*"
}

# finish_run <verb> <seen>: stops when the runner saw a different number of cases than the file holds,
# else prints the summary line (parsed by run-all.sh) and exits non-zero when a case failed.
finish_run() {
  [[ $2 -eq $expected_cases ]] || { echo "FAIL $1 $2 cases, $CASES holds $expected_cases" >&2; exit 1; }
  [[ $skipped -eq 0 ]] || echo "$skipped case(s) skipped (running as root)"
  echo "$((total - fail))/$total cases passed"
  [[ $fail -eq 0 ]]
}
