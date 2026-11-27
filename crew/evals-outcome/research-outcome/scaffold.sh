#!/usr/bin/env bash
# Tiny dependency-free repo on main with a one-line CLI, a CLAUDE.md that names the test command and no docs/plans folder.
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
git checkout -q -f main 2>/dev/null || true
cat >cli.sh <<'EOS'
#!/usr/bin/env bash
echo "hello ${1:-world}"
EOS
chmod +x cli.sh
cat >test.sh <<'EOS'
#!/usr/bin/env bash
fail=0
n=0
check() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "FAIL $1: expected '$3' got '$2'"; fail=1; }; }
check default "$(./cli.sh)" "hello world"
check named "$(./cli.sh Ada)" "hello Ada"
[ "$fail" = 0 ] && echo "PASS $n/$n"
exit $fail
EOS
chmod +x test.sh
cat >CLAUDE.md <<'EOS'
# cli

A tiny shell CLI, `cli.sh`, that prints a greeting.

## Commands
- Test: `./test.sh` (exits 0 and prints `PASS n/n` as its last line when every check passes)
EOS
git add -A && { git diff --cached --quiet || git commit -q -m "feat: cli"; }
