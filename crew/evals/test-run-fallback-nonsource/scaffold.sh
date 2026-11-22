#!/usr/bin/env bash
# Tiny dependency-free repo with two modules (alpha, beta), one test file each, a config file and a Makefile.
# `make test` at the root runs every tests/*.test.sh, `make test-one T=<file>` runs one. Exactly one check fails,
# beta-quartz-osprey in tests/beta.test.sh, on main and on the feature branch alike (its table value is the real
# cksum plus one). The feature branch changes config/settings.json (not source code) and src/alpha.sh, whose own
# test passes alone, so the failure only shows when the whole suite runs.
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
mkdir config
# mk_test <dir> <module> <name:bump>...  writes <dir>/tests/<module>.test.sh, bump 1 makes the table value wrong on purpose
mk_test() {
  dir=$1
  mod=$2
  shift 2
  mkdir -p "$dir/tests" "$dir/src"
  printf '%s
' "${mod}_sig() { printf '%s' \"\$1\" | cksum | cut -d' ' -f1; }" >"$dir/src/$mod.sh"
  {
    cat <<EOS
#!/usr/bin/env bash
cd "\$(dirname "\$0")/.." || exit 1
. src/$mod.sh
fail=0
while read -r name want; do
  got=\$(${mod}_sig "\$name")
  if [ "\$got" = "\$want" ]; then
    echo "ok \$name"
  else
    echo "FAIL \$name: expected '\$want' got '\$got'"
    fail=1
  fi
done <<'TABLE'
EOS
    for pair in "$@"; do
      name=${pair%%:*}
      bump=${pair##*:}
      set -- $(printf '%s' "$name" | cksum)
      echo "$name $(($1 + bump))"
    done
    echo TABLE
    echo 'exit $fail'
  } >"$dir/tests/$mod.test.sh"
  chmod +x "$dir/tests/$mod.test.sh"
}
mk_test . alpha alpha-parses-empty:0 alpha-trims-spaces:0 alpha-joins-parts:0
mk_test . beta beta-splits-lines:0 beta-quartz-osprey:1 beta-sorts-words:0
printf '{"retries": 3, "verbose": false}\n' >config/settings.json
printf 'test:\n\t@fail=0; for t in tests/*.test.sh; do bash $$t || fail=1; done; exit $$fail\n\ntest-one:\n\t@bash $(T)\n' >Makefile
git add -A && git commit -q -m "feat: alpha and beta modules with tests and config"

git checkout -q -b feature
printf '{"retries": 5, "verbose": true}\n' >config/settings.json
printf '%s\n' "alpha_sig() { printf '%s' \"\$1\" | cksum | awk '{print \$1}'; }" >src/alpha.sh
git add -A && git commit -q -m "chore(config): raise retries, turn on verbose, tidy alpha signature helper"
