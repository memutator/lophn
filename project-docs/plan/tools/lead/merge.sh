#!/bin/bash
# merge.sh <계획> <id>: rebase, worktree에서 check:full, plan branch로 ff-merge, plan branch에서 check:full과 core 기동, renderer build, 정리, status merged.
# 그 계획의 lead worktree(branch plan/<계획>)에서 돈다. main에는 land.sh가 올린다. 멈추면 "STOP: ..."을 찍고 exit 1.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT" || exit 1
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
BASE=$(git branch --show-current)
plan=$1; id=$2
[ "$BASE" = "plan/$plan" ] || { echo "STOP: lead worktree(branch plan/$plan)에서 돌린다. 지금: $BASE"; exit 1; }
[ -d project-docs/plan/$plan/tasks ] || { echo "STOP: 계획 없음: $plan"; exit 1; }
if [ "${FIX:-}" = 1 ]; then B=fix/$id; else u=$(grep -m1 -oP "단위: \K[a-z0-9-]+" project-docs/plan/$plan/tasks/$id.md); B=$u/$id; fi
W=$MAIN/.claude/worktrees/$id
# land가 plan branch를 main 위로 다시 쓰면 merge-base가 옛 wave commit 앞으로 간다. launch.sh가 적은 갈라진 점이 있으면
# 그 뒤의 commit만 task의 것이다(옛 base의 commit을 다시 올리다 충돌한 일이 여섯 번 있다).
FROM=$(git config --get "branch.$B.lophnBase" || true)
if [ -z "$FROM" ] || ! git merge-base --is-ancestor "$FROM" "$B"; then FROM=$(git merge-base $BASE $B); fi
# 충돌을 손으로 풀어 이미 plan branch 위에 있으면 옮길 것은 그 뒤뿐이다(옛 lophnBase로 plan commit을 또 옮기다 충돌했다).
if git merge-base --is-ancestor "$BASE" "$B"; then FROM=$(git rev-parse $BASE); fi
nm=$(git diff --stat $FROM $B | grep -c node_modules)
[ "$nm" != 0 ] && { echo "STOP: node_modules in diff"; exit 1; }
echo "changed files (brief의 소유와 대 본다):"; git diff --name-only $FROM $B | sed 's/^/  /'
git diff $FROM $B | grep -nE '^\+.*(TODO|FIXME)' && echo "WARN: TODO/FIXME"
git -C $W status --short | grep -v node_modules | sed 's/^/dirty: /'
git -C $W rebase --onto $BASE $FROM >/dev/null 2>&1 || { echo "STOP: rebase conflict"; git -C $W status --short | head; exit 1; }
# 뒤에서 끊겨 다시 돌릴 때 이미 옮긴 plan branch commit을 또 옮기지 않게 기준을 지금 BASE로 적는다.
git config "branch.$B.lophnBase" "$(git rev-parse $BASE)"
out=$(cd $W && npm run check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: worktree full check failed"; exit 1; }
git merge --ff-only -q $B || { echo "STOP: ff failed"; exit 1; }
[ -e node_modules ] || { echo "STOP: lead worktree node_modules missing (worktree-prep)"; exit 1; }
out=$(npm run check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: plan branch full check failed"; exit 1; }
echo "plan branch full check ok"
BOOT=$(project-docs/plan/tools/lead/boot.sh 2>&1); [ "$(echo "$BOOT" | grep -c "exit 0")" = 2 ] || { echo "STOP: boot failed after merge"; echo "$BOOT" | tail -6; exit 1; }; echo "boot ok"
node packages/shell/renderer/build.ts >/dev/null 2>&1 || { echo "STOP: renderer build failed after merge"; exit 1; }; echo "renderer build ok"
chmod -R u+w $W/.dev-data 2>/dev/null  # core가 깐 읽기 전용 sdk 사본
git worktree remove --force $W && git branch -q -D $B
python3 -I project-docs/plan/tools/status.py $plan set $id merged $B $(git rev-parse --short HEAD)
echo "merged $id at $(git rev-parse --short HEAD)"
