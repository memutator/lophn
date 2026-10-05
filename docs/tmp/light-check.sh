#!/usr/bin/env bash
# 사람 허락(full check 대신): fmt·lint·deps·coverage·check·docs는 전체, test는 바뀐 디렉터리만.
set -u
base=$(git merge-base HEAD origin/main)
changed=$(git diff --name-only "$base" HEAD)
fail=0
run() { echo "== $*"; out=$("$@" 2>&1) || { echo "실패: $*"; echo "$out" | tail -20; fail=1; }; }
run deno fmt --check
run deno lint
run deno run --allow-read tools/check-deps.ts
run deno run --allow-read tools/contract-coverage.ts
run deno check
run node tools/check-docs.ts
dirs=$(echo "$changed" | grep -E '\.(ts|tsx)$' | grep -vE '^apps/shell/main/|^e2e/' | xargs -r -n1 dirname | sort -u)
existing=""; for d in $dirs; do [ -d "$d" ] && existing="$existing $d"; done
# 바뀐 자리와 상관없이 항상: 저장소 전체를 보는 tripwire와 core 기동 테스트.
existing="$existing packages/platform/responsiveness/core_imports_test.ts apps/core/core_test.ts"
if true; then
  echo "== deno test$existing"
  out=$(deno test --allow-all --permit-no-files $existing 2>&1); rc=$?
  echo "$out" | grep -E 'passed \|' | tail -1
  [ $rc -eq 0 ] || { echo "실패: deno test"; echo "$out" | grep -E 'FAILED|=>' | tail -15; echo "$out" | sed -n '/ERRORS/,/FAILURES/p' | head -60; fail=1; }
fi
if echo "$changed" | grep -qE '^apps/shell/|^packages/design/'; then [ -x apps/shell/main/node_modules/.bin/tsc ] || npm --prefix apps/shell/main ci --no-audit --no-fund >/dev/null 2>&1; run npm --prefix apps/shell/main run check; fi
[ $fail -eq 0 ] && echo "LIGHT OK" || echo "LIGHT FAILED"
exit $fail
