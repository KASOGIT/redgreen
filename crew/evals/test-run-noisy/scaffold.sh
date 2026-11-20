#!/usr/bin/env bash
# Tiny dependency-free repo: ./test.sh runs 120 checks, exactly 3 fail, and the outcome only shows up at run time.
# Each check compares the POSIX cksum of its name with a table written here. The table holds the real cksum for
# passing checks and the real cksum plus one for the 3 failing ones, so nobody can read the verdict off the files.
set -e
git init -q -b main .
git config user.email eval@localhost
git config user.name eval
verbs="parses formats rounds trims rejects accepts escapes splits joins clamps merges sorts"
objects="empty-input unicode-text negative-number long-string nested-quotes mixed-case trailing-newline leading-zeros tab-characters null-bytes"
n=0
: >checks.tbl
for v in $verbs; do
  for o in $objects; do
    n=$((n + 1))
    name="$v-$o"
    [ "$n" -eq 45 ] && name=handles-error-path
    set -- $(printf '%s' "$name" | cksum)
    want=$1
    case "$n" in 31 | 64 | 97) want=$((want + 1)) ;; esac
    echo "$name $want" >>checks.tbl
  done
done
cat >test.sh <<'EOS'
#!/usr/bin/env bash
echo "warning: locale not set, falling back to C" >&2
fail=0
while read -r name want; do
  set -- $(printf '%s' "$name" | cksum)
  got=$1
  if [ "$got" = "$want" ]; then
    echo "ok $name"
  else
    echo "FAIL $name: expected '$want' got '$got'"
    fail=1
  fi
done <checks.tbl
exit $fail
EOS
chmod +x test.sh
git add -A && git commit -q -m "test: checks table"
