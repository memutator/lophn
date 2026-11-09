#!/bin/bash
# main-merge.sh <branch> [--full]: 계획(land.sh)이 아닌 session이 자기 worktree의 branch를 main에 올린다.
# main lock을 쥔 채 main 위로 rebase, 판 정하기, 빠른 check(--full이면 check:full), main fast-forward. e2e와 기동은 돌지 않는다.
# 멈추면 "STOP: ..."을 찍고 exit 1.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
MAIN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")
. "$(dirname "$0")/main-lib.sh"
branch=${1:-}; full=${2:-}
[ -n "$branch" ] || { echo "usage: main-merge.sh <branch> [--full]"; exit 1; }
# branch를 checkout한 worktree를 찾는다.
W=$(git -C "$ROOT" worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{w=substr($0,10)} $0=="branch " b {print w}')
[ -n "$W" ] || { echo "STOP: $branch를 checkout한 worktree가 없다"; exit 1; }
[ "$W" != "$MAIN" ] || { echo "STOP: $branch가 main checkout에 있다. 자기 worktree에서 일한다"; exit 1; }
[ -z "$(git -C "$W" status --short | grep -v node_modules)" ] || { echo "STOP: $W에 commit 안 된 변경"; git -C "$W" status --short | head; exit 1; }
require_main_checkout || exit 1

exec 9>"$(main_lock_file)"
flock -n 9 || { echo "main lock을 기다린다"; flock 9; }
step "main lock을 잡았다: $branch"
cd "$W" || exit 1
old=$(git merge-base HEAD main)
rebase_main || exit 1
deps "$old" main || exit 1
if [ "$full" = --full ]; then check="npm run check:full"; else check="npm run check"; fi
finish_on_main "$check" || exit 1
echo "merged $branch at $(git rev-parse --short HEAD) (판 $(grep -m1 -oP '"version": "\K[^"]+' package.json))"
