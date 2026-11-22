#!/usr/bin/env bash
# Tiny dependency-free repo whose test file waits 150 seconds (a literal sleep), then runs the checks.
# Exactly one check fails, vault-ember-LX88 (its table value is the real cksum plus one), so make exits non-zero.
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
sleep 150
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
mk_test . vault vault-opens-door:0 vault-ember-LX88:1 vault-seals-door:0
printf 'test:\n\t@bash tests/vault.test.sh\n' >Makefile
git add -A && git commit -q -m "feat: vault module with slow tests"
