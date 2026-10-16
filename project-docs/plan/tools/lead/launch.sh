#!/bin/bash
# launch.sh <id>...: create worktree, prep, mark running; print branch
cd /home/pyosechang/projects/lophn
for id in "$@"; do
  u=$(grep -m1 -oP "단위: \K[a-z-]+" project-docs/plan/tasks/$id.md)
  git worktree add -q .claude/worktrees/$id -b $u/$id main && deno run -A tools/worktree-prep.ts .claude/worktrees/$id >/dev/null && python3 -I project-docs/plan/tools/status.py set $id running $u/$id && echo "$id $u/$id"
done
