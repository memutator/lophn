#!/bin/bash
# launch.sh <계획> <id>...: worktree와 branch(<단위>/<id>)를 만들고, prep하고, status를 running으로 한다.
# 그 계획의 lead worktree(branch plan/<계획>, lead.sh가 만든다)에서 돈다. task branch는 plan/<계획>에서 갈라진다.
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT" || exit 1
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
BASE=$(git branch --show-current)
plan=$1; shift
[ "$BASE" = "plan/$plan" ] || { echo "lead worktree(branch plan/$plan)에서 돌린다. 지금: $BASE"; exit 1; }
[ -d project-docs/plan/$plan/tasks ] || { echo "계획 없음: $plan"; exit 1; }
for id in "$@"; do
  u=$(grep -m1 -oP "단위: \K[a-z0-9-]+" project-docs/plan/$plan/tasks/$id.md)
  W=$MAIN/.claude/worktrees/$id
  # 갈라진 점을 적어 둔다. land가 plan branch를 다시 쓰면 merge.sh가 이 점 뒤의 commit만 옮긴다.
  git worktree add -q $W -b $u/$id $BASE && git config "branch.$u/$id.lophnBase" "$(git rev-parse $BASE)" && node tools/worktree-prep.ts $W >/dev/null && python3 -I project-docs/plan/tools/status.py $plan set $id running $u/$id && echo "$id $u/$id"
done
