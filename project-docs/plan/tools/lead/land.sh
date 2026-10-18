#!/bin/bash
# land.sh <계획>: plan/<계획> branch를 main에 올린다. wave 하나가 끝날 때와 계획이 끝날 때 lead가 돌린다.
# lead worktree를 main 위로 rebase하고 full check와 core 기동을 본 뒤 main을 fast-forward한다.
# 멈추면 "STOP: ..."을 찍고 exit 1. main checkout에 그 commit들과 겹치는 고친 file이 있으면 ff가 멈춘다.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
MAIN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")
plan=$1
L=$MAIN/.claude/worktrees/plan-$plan
[ -d "$L" ] || { echo "STOP: lead worktree 없음: $L"; exit 1; }
cd "$L" || exit 1
[ "$(git branch --show-current)" = "plan/$plan" ] || { echo "STOP: $L이 plan/$plan이 아니다"; exit 1; }
[ -z "$(git status --short | grep -v node_modules)" ] || { echo "STOP: lead worktree에 commit 안 된 변경"; git status --short | head; exit 1; }
git rebase main >/dev/null 2>&1 || { echo "STOP: rebase conflict"; git status --short | head; exit 1; }
out=$(deno task check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: full check failed"; exit 1; }
if ls tests/e2e/*_test.ts >/dev/null 2>&1; then
  # 새 lead worktree에는 앱 E2E가 쓰는 의존이 없다. 없으면 앱을 띄우는 E2E가 모두 실패한다.
  out=$(deno task e2e:deps 2>&1) || { echo "$out" | tail -10; echo "STOP: e2e deps failed"; exit 1; }
  out=$(deno task e2e 2>&1) || { echo "$out" | tail -30; echo "STOP: e2e failed"; exit 1; }
fi
BOOT=$(project-docs/plan/tools/lead/boot.sh 2>&1); [ "$(echo "$BOOT" | grep -c "exit 0")" = 2 ] || { echo "STOP: boot failed"; echo "$BOOT" | tail -6; exit 1; }
git -C "$MAIN" merge --ff-only -q "plan/$plan" || { echo "STOP: main ff failed"; exit 1; }
echo "landed plan/$plan at $(git rev-parse --short HEAD)"
