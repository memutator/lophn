#!/bin/bash
# usage: rerun-failed.sh <light-check log> [worktree]
# light-check에서 실패한 test 파일만 하나씩 따로 다시 돌린다. 부하 탓 실패인지 실제 결함인지 가른다.
LOG=$1; WT=${2:-/home/pyosechang/projects/lophn/.claude/worktrees/merge-batch}
files=$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -oE '=> \./[^:]+_test\.tsx?' | sed 's/=> \.\///' | sort -u)
[ -z "$files" ] && { echo "실패 파일 없음"; exit 0; }
cd "$WT" || exit 2
bad=0
for f in $files; do
  # tsx 화면 test는 묶는 진입점(*_test.ts)이 따로 있으면 그쪽을 돌린다.
  out=$(/home/pyosechang/projects/lophn/.dev-data/lead-tools/memwait.sh timeout 600 deno test --no-check --allow-all "$f" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'passed \|' | tail -1)
  case "$out" in ok*) echo "PASS(alone) $f";; *) echo "FAIL(alone) $f :: $out"; bad=1;; esac
done
[ $bad -eq 0 ] && echo "RERUN OK" || echo "RERUN FAILED"
