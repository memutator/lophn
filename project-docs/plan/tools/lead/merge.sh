#!/bin/bash
# merge.sh <id>: rebase, full check in worktree, ff-merge, full check + boot on main, clean up.
set -u
cd /home/pyosechang/projects/lophn
id=$1
if [ "${FIX:-}" = 1 ]; then B=fix/$id; else u=$(grep -m1 -oP "단위: \K[a-z-]+" project-docs/plan/tasks/$id.md); B=$u/$id; fi
W=.claude/worktrees/$id
nm=$(git diff --stat main...$B | grep -c node_modules)
[ "$nm" != 0 ] && { echo "STOP: node_modules in diff"; exit 1; }
[ "${FIX:-}" = 1 ] || python3 -I project-docs/plan/tools/owned.py $id | head -6
git diff main...$B | grep -nE '^\+.*(TODO|FIXME)' && echo "WARN: TODO/FIXME"
git -C $W status --short | grep -v node_modules | sed 's/^/dirty: /'
git -C $W rebase main >/dev/null 2>&1 || { echo "STOP: rebase conflict"; git -C $W status --short | head; exit 1; }
(cd $W && deno task check:full 2>&1 | grep -E "실패" && { echo "STOP: worktree full check failed"; exit 1; }) || true
(cd $W && deno task check:full 2>&1 | grep -qE "실패") && exit 1
git merge --ff-only -q $B || { echo "STOP: ff failed"; exit 1; }
[ -d packages/shell/main/node_modules ] && [ ! -L packages/shell/main/node_modules ] || { echo "STOP: main node_modules broken"; exit 1; }
deno task check:full 2>&1 | grep -E '실패' && { echo "STOP: main full check failed"; exit 1; }
echo "main full check ok"
BOOT=$(/home/pyosechang/projects/lophn/project-docs/plan/tools/lead/boot.sh 2>&1); [ "$(echo "$BOOT" | grep -c "exit 0")" = 2 ] || { echo "STOP: main boot failed after merge"; echo "$BOOT" | tail -6; exit 1; }; echo "main boot ok"
deno run -A packages/shell/renderer/build.ts >/dev/null 2>&1 || { echo "STOP: renderer build failed after merge"; exit 1; }; echo "renderer build ok"
rm -f $W/packages/shell/main/node_modules
git worktree remove --force $W && git branch -q -D $B
python3 -I project-docs/plan/tools/status.py set $id merged $B $(git rev-parse --short HEAD)
echo "merged $id at $(git rev-parse --short HEAD)"
