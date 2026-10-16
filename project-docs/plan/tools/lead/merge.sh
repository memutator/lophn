#!/bin/bash
# merge.sh <id>: rebase, worktree에서 check:full, ff-merge, main에서 check:full과 core 기동, renderer build, 정리, status merged.
# main checkout에서 돈다. 멈추면 "STOP: ..."을 찍고 exit 1.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT" || exit 1
id=$1
if [ "${FIX:-}" = 1 ]; then B=fix/$id; else u=$(grep -m1 -oP "단위: \K[a-z0-9-]+" project-docs/plan/tasks/$id.md); B=$u/$id; fi
W=.claude/worktrees/$id
nm=$(git diff --stat main...$B | grep -c node_modules)
[ "$nm" != 0 ] && { echo "STOP: node_modules in diff"; exit 1; }
echo "changed files (brief의 소유와 대 본다):"; git diff --name-only main...$B | sed 's/^/  /'
git diff main...$B | grep -nE '^\+.*(TODO|FIXME)' && echo "WARN: TODO/FIXME"
git -C $W status --short | grep -v node_modules | sed 's/^/dirty: /'
git -C $W rebase main >/dev/null 2>&1 || { echo "STOP: rebase conflict"; git -C $W status --short | head; exit 1; }
out=$(cd $W && deno task check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: worktree full check failed"; exit 1; }
git merge --ff-only -q $B || { echo "STOP: ff failed"; exit 1; }
[ -d packages/shell/main/node_modules ] && [ ! -L packages/shell/main/node_modules ] || { echo "STOP: main node_modules broken"; exit 1; }
out=$(deno task check:full 2>&1) || { echo "$out" | tail -30; echo "STOP: main full check failed"; exit 1; }
echo "main full check ok"
BOOT=$(project-docs/plan/tools/lead/boot.sh 2>&1); [ "$(echo "$BOOT" | grep -c "exit 0")" = 2 ] || { echo "STOP: main boot failed after merge"; echo "$BOOT" | tail -6; exit 1; }; echo "main boot ok"
deno run -A packages/shell/renderer/build.ts >/dev/null 2>&1 || { echo "STOP: renderer build failed after merge"; exit 1; }; echo "renderer build ok"
rm -f $W/packages/shell/main/node_modules
git worktree remove --force $W && git branch -q -D $B
python3 -I project-docs/plan/tools/status.py set $id merged $B $(git rev-parse --short HEAD)
echo "merged $id at $(git rev-parse --short HEAD)"
