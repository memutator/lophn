#!/bin/bash
# Merge every queued PR branch, in queue order, into one integration worktree on top of origin/main.
W=/home/pyosechang/projects/lophn/docs/tmp
cd /home/pyosechang/projects/lophn && git fetch -q origin
I=.claude/worktrees/merge-batch
[ -d $I ] || git worktree add -q -B lead/merge-batch $I origin/main
cd $I
git checkout -q -- apps/shell/main/desktop/core/deno.lock 2>/dev/null
git merge -q --no-edit origin/main >/dev/null 2>&1 || { echo "main merge CONFLICT"; exit 1; }
SKIP=" ${SKIP:-} "
for pr in $(cut -d'|' -f1 /home/pyosechang/projects/lophn/.dev-data/merge-queue.txt); do
  case "$SKIP" in *" $pr "*) echo "$pr skipped"; continue;; esac
  br=$(gh pr view $pr --json headRefName -q .headRefName)
  if git merge-base --is-ancestor origin/$br HEAD; then echo "$pr already"; continue; fi
  if git merge -q --no-edit origin/$br >/dev/null 2>&1; then echo "$pr ok"; continue; fi
  u=$(git diff --name-only --diff-filter=U)
  if [ -n "$u" ] && ! echo "$u" | grep -qvE '^docs/plan/.*\.md$'; then
    python3 $W/keepboth.py $u && git add $u && git commit -qm "Merge #$pr (plan both sides)" && echo "$pr plan-resolved: $u"
  else echo "$pr CONFLICT (skipped):" $u; git merge --abort; SKIP="$SKIP$pr "; fi
done
echo DONE $(git rev-parse --short HEAD)
