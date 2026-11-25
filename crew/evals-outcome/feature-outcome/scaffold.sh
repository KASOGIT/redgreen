#!/usr/bin/env bash
# Tiny dependency-free repo with a CLAUDE.md that names the test command. ./test.sh prints PASS n/n as its last line when every check passes.
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
cat >slug.sh <<'EOS'
slugify() { echo "$1" | tr 'A-Z' 'a-z' | tr -d '[:punct:]' | tr -s ' ' '-'; }
EOS
cat >test.sh <<'EOS'
#!/usr/bin/env bash
. ./slug.sh
fail=0
n=0
check() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "FAIL $1: expected '$3' got '$2'"; fail=1; }; }
check lowercases "$(slugify 'Hello World')" hello-world
check drops-punctuation "$(slugify 'Hello, World!')" hello-world
check collapses-spaces "$(slugify 'a   b')" a-b
[ "$fail" = 0 ] && echo "PASS $n/$n"
exit $fail
EOS
chmod +x test.sh
cat >CLAUDE.md <<'EOS'
# slug

A tiny shell library, `slug.sh`.

## Commands
- Test: `./test.sh` (exits 0 and prints `PASS n/n` as its last line when every check passes)
EOS
git add -A && { git diff --cached --quiet || git commit -q -m "feat: slugify"; }
