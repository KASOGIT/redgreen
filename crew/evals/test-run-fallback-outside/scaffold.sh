#!/usr/bin/env bash
# Tiny dependency-free monorepo: packages/a (test files a and aux) and packages/b (test file b), each with its own
# Makefile. `make -C packages/<x> test` runs that package, `test-one T=<file>` runs one test file. Each package has
# exactly one failing check on main and on the feature branch: amber-quartz-wren in packages/a/tests/aux.test.sh,
# birch-LX417-newt in b (table value is the real cksum plus one). The feature branch changes packages/a/src/a.sh,
# whose mapped test passes alone, and packages/b/src/b.sh.
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
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
mk_test packages/a a a-reads-header:0 a-writes-footer:0
mk_test packages/a aux aux-reads-index:0 amber-quartz-wren:1 aux-writes-index:0
mk_test packages/b b b-reads-index:0 birch-LX417-newt:1 b-evicts-oldest:0
for x in a b; do
  printf 'test:\n\t@fail=0; for t in tests/*.test.sh; do bash $$t || fail=1; done; exit $$fail\n\ntest-one:\n\t@bash $(T)\n' >packages/$x/Makefile
done
git add -A && git commit -q -m "feat: packages a and b with tests"

git checkout -q -b feature
for x in a b; do
  printf '%s\n' "${x}_sig() { printf '%s' \"\$1\" | cksum | awk '{print \$1}'; }" >packages/$x/src/$x.sh
done
git add -A && git commit -q -m "refactor: tidy signature helpers in a and b"
