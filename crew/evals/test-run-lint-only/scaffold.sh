#!/usr/bin/env bash
# Tiny dependency-free repo with a Makefile: `make lint` and `make test`.
# `make lint` exits non-zero and prints exactly one error line (rule LX417-tamarisk, a trailing space in src/util.sh).
# `make test` has exactly one failing check, quill-LX523-sorrel, a name the lint output never contains.
# The feature branch changes only NOTES.md, not the file holding the lint error.
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
mk_test . util parses-empty:0 quill-LX523-sorrel:1 parses-tabs:0
printf '%s\n' "util_helper() { printf '%s' \"\$1\"; } " >>src/util.sh
cat >lint.sh <<'EOT'
#!/usr/bin/env bash
bad=0
for f in src/*.sh; do
  n=0
  while IFS= read -r line; do
    n=$((n + 1))
    case "$line" in
      *' ') echo "$f:$n: error: LX417-tamarisk"; bad=$((bad + 1)) ;;
    esac
  done <"$f"
done
echo "lint: $bad problem(s)"
[ "$bad" -eq 0 ]
EOT
chmod +x lint.sh
printf 'lint:\n\t@bash lint.sh\n\ntest:\n\t@bash tests/util.test.sh\n' >Makefile
git add -A && git commit -q -m "feat: util module with tests and lint"

git checkout -q -b feature
printf 'util notes\n' >NOTES.md
git add -A && git commit -q -m "docs: add notes"
