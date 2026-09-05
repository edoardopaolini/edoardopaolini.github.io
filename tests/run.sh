#!/bin/sh
# Runs the model tests of the figures in a bare JavaScript engine. Usage: tests/run.sh
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
[ -x "$JSC" ] || JSC=jsc
status=0
for t in tests/*.test.js; do
  echo "== $t"
  "$JSC" "$t" || status=1
done
exit $status
