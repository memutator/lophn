#!/usr/bin/env bash
# usage: merge-nocheck.sh <pr> <worktree-dir-name> <review-body> [squash|merge]
# light-check는 통합 branch에서 이미 돌렸다는 전제다.
set -u
PR=$1; WT=/home/pyosechang/projects/lophn/.claude/worktrees/$2; BODY=$3
MODE=${4:-squash}; case " ${MERGE_COMMIT_PRS:-} " in *" $PR "*) MODE=merge;; esac
W=/home/pyosechang/projects/lophn/docs/tmp
BR=$(gh pr view $PR --json headRefName -q .headRefName)
if [ ! -d "$WT" ]; then git -C /home/pyosechang/projects/lophn worktree add -q "$WT" "origin/$BR" 2>/dev/null || git -C /home/pyosechang/projects/lophn worktree add -q -B "$BR" "$WT" "origin/$BR"; fi
cd "$WT" || exit 2
git fetch -q origin
git checkout -q "$BR" 2>/dev/null || git checkout -q -B "$BR" "origin/$BR"
git merge -q --ff-only "origin/$BR" 2>/dev/null
if ! git merge -q --no-edit origin/main >/dev/null 2>&1; then
  u=$(git diff --name-only --diff-filter=U)
  if [ -n "$u" ] && ! echo "$u" | grep -qvE '^docs/plan/.*\.md$'; then
    python3 $W/keepboth.py $u && git add $u && git commit -qm "Merge origin/main (plan both sides)"
  else echo "CONFLICT #$PR: $u"; git merge --abort; exit 3; fi
fi
if grep -rlsI '^<<<<<<< ' apps packages docs tools e2e open-issues.md 2>/dev/null | head -1 | grep -q .; then echo "MARKERS #$PR"; exit 3; fi
git checkout -q -- apps/shell/main/desktop/core/deno.lock 2>/dev/null
git push -q origin HEAD:"$BR" || exit 5
h=$(git rev-parse HEAD); git fetch -q origin
if ! git merge-base --is-ancestor origin/main "$h"; then echo "MOVED #$PR"; exit 6; fi
for i in $(seq 1 20); do m=$(gh pr view $PR --json mergeable -q .mergeable); [ "$m" != UNKNOWN ] && break; sleep 5; done
gh pr review "$PR" --comment --body "$BODY" >/dev/null
gh pr merge "$PR" --$MODE --match-head-commit "$h" || exit 7
git push -q origin --delete "$BR" 2>/dev/null
cd /home/pyosechang/projects/lophn && git worktree remove --force "$WT" 2>&1 | tail -1; git pull -q --ff-only
gh pr view "$PR" --json state,mergeCommit --jq '"#'$PR' \(.state) \(.mergeCommit.oid[0:7])"'
