#!/bin/bash
# land.sh <계획>: plan/<계획> branch를 main에 올린다. wave 하나가 끝날 때와 계획이 끝날 때 lead가 돌린다.
# lead worktree를 main 위로 rebase하고 full check와 core 기동을 본 뒤 main을 fast-forward한다.
# 멈추면 "STOP: ..."을 찍고 exit 1. main checkout에 그 commit들과 겹치는 고친 file이 있으면 ff가 멈춘다.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
MAIN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")
plan=$1
# 두 계획의 e2e가 같이 돌면 멈춘 일이 있어 land는 하나씩 돈다. pgrep로 찾으면 찾는 명령 자신이 걸려 lock을 쓴다.
# -o: lock fd를 자식에게 넘기지 않는다. 남은 core process가 lock을 쥐고 있지 않게.
if [ -z "${LOPHN_LAND_LOCKED:-}" ]; then
  LOCK=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)/lophn-land.lock
  flock -n "$LOCK" true || echo "다른 land가 끝나기를 기다린다"
  LOPHN_LAND_LOCKED=1 exec flock -o "$LOCK" "$0" "$@"
fi
# 단계마다 한 줄을 바로 찍는다. 끝에만 찍으면 도는 land를 lock을 기다리는 land로 잘못 읽는다(lead가 그렇게 읽고 멈춘 일이 있다).
step() { echo "$(date +%H:%M:%S) $*"; }
step "lock을 잡았다: $plan"
L=$MAIN/.claude/worktrees/plan-$plan
[ -d "$L" ] || { echo "STOP: lead worktree 없음: $L"; exit 1; }
cd "$L" || exit 1
[ "$(git branch --show-current)" = "plan/$plan" ] || { echo "STOP: $L이 plan/$plan이 아니다"; exit 1; }
[ -z "$(git status --short | grep -v node_modules)" ] || { echo "STOP: lead worktree에 commit 안 된 변경"; git status --short | head; exit 1; }
step "main 위로 rebase"
git rebase main >/dev/null 2>&1 || { echo "STOP: rebase conflict"; git status --short | head; exit 1; }
base=$(git rev-parse main)
step "check:full"
out=$(deno task check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: full check failed"; exit 1; }
# LOPHN_LAND_SKIP_E2E=1: e2e를 돌리지 않는 계획(README가 정한다)이 쓴다.
if [ -z "${LOPHN_LAND_SKIP_E2E:-}" ] && ls tests/e2e/*_test.ts >/dev/null 2>&1; then
  # 새 lead worktree에는 앱 E2E가 쓰는 의존이 없다. 없으면 앱을 띄우는 E2E가 모두 실패한다.
  step "e2e"
  out=$(deno task e2e:deps 2>&1) || { echo "$out" | tail -10; echo "STOP: e2e deps failed"; exit 1; }
  out=$(deno task e2e 2>&1) || { echo "$out" | tail -30; echo "STOP: e2e failed"; exit 1; }
fi
step "core 두 번 기동"
BOOT=$(project-docs/plan/tools/lead/boot.sh 2>&1); [ "$(echo "$BOOT" | grep -c "exit 0")" = 2 ] || { echo "STOP: boot failed"; echo "$BOOT" | tail -6; exit 1; }
# land가 도는 사이 planner가 main에 계획 문서를 commit하곤 한다. 문서만 늘었으면 다시 rebase하고 빠른 check로 올린다.
step "main fast-forward"
until git -C "$MAIN" merge --ff-only -q "plan/$plan" 2>/dev/null; do
  [ "$(git rev-parse main)" != "$base" ] || { echo "STOP: main ff failed"; exit 1; }
  code=$(git diff --name-only "$base" main | grep -v '^project-docs/')
  [ -z "$code" ] || { echo "STOP: land 사이 main에 코드가 바뀌었다. land.sh를 다시 돈다"; echo "$code" | head; exit 1; }
  base=$(git rev-parse main)
  git rebase main >/dev/null 2>&1 || { echo "STOP: rebase conflict"; git status --short | head; exit 1; }
  out=$(deno task check 2>&1) || { echo "$out" | tail -30; echo "STOP: check failed after main moved"; exit 1; }
  done
echo "landed plan/$plan at $(git rev-parse --short HEAD)"
