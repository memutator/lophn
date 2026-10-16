#!/bin/bash
# launch.sh <id>...: worktree와 branch(<단위>/<id>)를 만들고, prep하고, status를 running으로 한다. main checkout에서 돈다.
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT" || exit 1
for id in "$@"; do
  u=$(grep -m1 -oP "단위: \K[a-z0-9-]+" project-docs/plan/tasks/$id.md)
  git worktree add -q .claude/worktrees/$id -b $u/$id main && deno run -A tools/worktree-prep.ts .claude/worktrees/$id >/dev/null && python3 -I project-docs/plan/tools/status.py set $id running $u/$id && echo "$id $u/$id"
done
