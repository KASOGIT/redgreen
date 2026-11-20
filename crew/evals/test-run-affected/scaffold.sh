#!/usr/bin/env bash
# Tiny dependency-free repo with two modules (alpha, beta), one test file each, and a Makefile.
# `make test` runs every tests/*.test.sh, `make test-one T=tests/alpha.test.sh` runs one file.
# Each check compares the output of the module's signature function with a table of POSIX cksum values written
# here, so nobody can read the verdict off the files. On main one beta check (beta-decoy-failure) already fails
# (its table value is the real cksum plus one). On the feature branch only src/alpha.sh changes, source code only,
# and that breaks exactly one alpha check (alpha-rounds-half-up).
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
mkdir src tests

printf '%s\n' "alpha_sig() { printf '%s' \"\$1\" | cksum | cut -d' ' -f1; }" >src/alpha.sh
printf '%s\n' "beta_sig() { printf '%s' \"\$1\" | cksum | cut -d' ' -f1; }" >src/beta.sh

# mk_test <module> <name:bump>...  writes tests/<module>.test.sh, bump 1 makes the table value wrong on purpose
mk_test() {
  mod=$1
  shift
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
  } >"tests/$mod.test.sh"
  chmod +x "tests/$mod.test.sh"
}
mk_test alpha alpha-parses-empty:0 alpha-trims-spaces:0 alpha-rounds-half-up:0 alpha-clamps-negative:0 alpha-joins-parts:0
mk_test beta beta-splits-lines:0 beta-decoy-failure:1 beta-merges-keys:0 beta-sorts-words:0

printf 'test:\n\t@fail=0; for t in tests/*.test.sh; do bash $$t || fail=1; done; exit $$fail\n\ntest-one:\n\t@bash $(T)\n' >Makefile
git add -A && git commit -q -m "feat: alpha and beta modules with tests"

git checkout -q -b feature
printf '%s\n' "alpha_sig() { printf '%s' \"\${1//half/Half}\" | cksum | cut -d' ' -f1; }" >src/alpha.sh
git add -A && git commit -q -m "fix(alpha): normalize the word half before hashing"
