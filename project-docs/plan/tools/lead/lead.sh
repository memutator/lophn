#!/bin/bash
# lead.sh <계획>: 그 계획의 lead worktree를 연다. branch plan/<계획>을 main에서 갈라 main checkout의
# .claude/worktrees/plan-<계획>에 두고 prep한다. 이미 있으면 그 경로만 찍는다. lead는 이 경로에서 일한다.
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
MAIN=$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")
plan=$1
[ -n "$plan" ] || { echo "사용: lead.sh <계획>"; exit 1; }
L=$MAIN/.claude/worktrees/plan-$plan
if [ ! -d "$L" ]; then
  git -C "$MAIN" worktree add -q "$L" -b "plan/$plan" main || exit 1
  (cd "$MAIN" && deno run -A tools/worktree-prep.ts "$L" >/dev/null) || exit 1
fi
[ -d "$L/project-docs/plan/$plan/tasks" ] || echo "주의: $L/project-docs/plan/$plan/tasks가 없다" >&2
echo "$L"
