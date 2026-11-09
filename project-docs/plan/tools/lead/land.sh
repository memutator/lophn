#!/bin/bash
# land.sh <계획>: plan/<계획> branch를 main에 올린다. 기본은 계획이 끝날 때 한 번이다. 중간 land는
# 사람의 data root 모양을 바꾸는 migration이 든 wave, main에서 같은 file을 고치는 다른 계획·session이 있을 때,
# plan branch가 오래 열려 rebase가 커질 때만 한다(orchestrate skill "merge").
# 두 단계다. (1) 무거운 단계: lophn-land.lock 아래서 main snapshot 위로 rebase, check:full, e2e, 기동. main lock은 안 쥔다.
# (2) 쓰는 단계: lophn-main.lock 아래서 지금 main 위로 rebase, 판 정하기, main fast-forward. 그 사이 main이 움직였으면 빠른 check만 다시 본다.
# 멈추면 "STOP: ..."을 찍고 exit 1.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
MAIN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")
. "$(dirname "$0")/main-lib.sh"
plan=$1
COMMON=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)
L=$MAIN/.claude/worktrees/plan-$plan
[ -d "$L" ] || { echo "STOP: lead worktree 없음: $L"; exit 1; }
cd "$L" || exit 1

heavy() {
  step "lock을 잡았다: $plan"
  [ "$(git branch --show-current)" = "plan/$plan" ] || { echo "STOP: $L이 plan/$plan이 아니다"; exit 1; }
  [ -z "$(git status --short | grep -v node_modules)" ] || { echo "STOP: lead worktree에 commit 안 된 변경"; git status --short | head; exit 1; }
  # e2e가 닿는 쪽을 따지던 reaches_e2e는 없다. main이 움직여도 e2e는 다시 돌지 않고 다음 land의 무거운 단계가 합친 상태를 본다.
  e2e() {
    [ -z "${LOPHN_LAND_SKIP_E2E:-}" ] && ls tests/e2e/*_test.ts >/dev/null 2>&1 || return 0
    # worktree-prep이 node_modules는 만들지만 앱 E2E가 쓰는 앱 의존은 없다. 없으면 앱을 띄우는 E2E가 모두 실패한다.
    step "e2e"
    out=$(npm run e2e:deps 2>&1) || { echo "$out" | tail -10; echo "STOP: e2e deps failed"; exit 1; }
    out=$(npm run e2e 2>&1) || { echo "$out" | tail -30; echo "STOP: e2e failed"; exit 1; }; }
  step "main 위로 rebase"
  old=$(git merge-base HEAD main)
  rebase_main || exit 1
  deps "$old" main || exit 1
  step "check:full"
  out=$(npm run check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: full check failed"; exit 1; }
  # LOPHN_LAND_SKIP_E2E=1: e2e를 돌리지 않는 계획(README가 정한다)이 쓴다.
  e2e
  step "core 두 번 기동"
  BOOT=$(project-docs/plan/tools/lead/boot.sh 2>&1); [ "$(echo "$BOOT" | grep -c "exit 0")" = 2 ] || { echo "STOP: boot failed"; echo "$BOOT" | tail -6; exit 1; }
}

# 두 계획의 e2e가 같이 돌면 멈춘 일이 있어 무거운 단계는 하나씩 돈다. pgrep로 찾으면 찾는 명령 자신이 걸려 lock을 쓴다.
# -o: lock fd를 자식에게 넘기지 않는다. 남은 core process가 lock을 쥐고 있지 않게.
# 무거운 단계가 끝나면 lock을 놓아야 다음 land가 바로 시작한다. 그래서 단계를 자식 process로 돈다.
if [ "${LOPHN_LAND_PHASE:-}" = heavy ]; then heavy; exit 0; fi
LAND_LOCK=$COMMON/lophn-land.lock
# 단계마다 한 줄을 바로 찍는다. 끝에만 찍으면 도는 land를 lock을 기다리는 land로 잘못 읽는다(lead가 그렇게 읽고 멈춘 일이 있다).
flock -n "$LAND_LOCK" true || echo "다른 land가 끝나기를 기다린다"
LOPHN_LAND_PHASE=heavy flock -o "$LAND_LOCK" "$0" "$@" || exit 1

# 쓰는 단계. main lock을 쥐면 아무도 main에 쓰지 못하니 재시도 loop가 없다.
exec 9>"$(main_lock_file)"
flock -n 9 || { echo "main lock을 기다린다"; flock 9; }
step "main lock을 잡았다"
cd "$L" || exit 1
require_main_checkout || exit 1
check=""
# 무거운 단계 동안 main이 움직였으면(HEAD가 main을 포함하지 않는다) 새로 rebase하고 빠른 check만 본다.
# e2e와 기동은 다시 돌지 않는다: 합친 상태의 e2e는 다음 land의 무거운 단계가 본다.
if ! git merge-base --is-ancestor main HEAD; then
  step "main이 움직였다: 다시 rebase하고 빠른 check만 본다"
  old=$(git merge-base HEAD main)
  rebase_main || exit 1
  deps "$old" main || exit 1
  check="npm run check"
fi
finish_on_main "$check" || exit 1
echo "landed plan/$plan at $(git rev-parse --short HEAD)"
