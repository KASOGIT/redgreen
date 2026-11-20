#!/usr/bin/env bash
# Tiny dependency-free repo: one source file, one failing test, and a committed change on branch "change" to review.
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
cat >slug.sh <<'EOS'
slugify() { echo "$1" | tr 'A-Z' 'a-z' | tr -s ' ' '-'; }
EOS
cat >test.sh <<'EOS'
#!/usr/bin/env bash
. ./slug.sh
fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL $1: expected '$3' got '$2'"; fail=1; }; }
check lowercases "$(slugify 'Hello World')" hello-world
check drops-punctuation "$(slugify 'Hello, World!')" hello-world
exit $fail
EOS
chmod +x test.sh
git add -A && git commit -q -m "feat: slugify"
git checkout -q -b change
cat >>slug.sh <<'EOS'
slug_max() { echo "$1" | cut -c1-$2; }
EOS
git commit -q -am "feat: slug_max"
