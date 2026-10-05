#!/usr/bin/env bash
# usage: merge.sh <pr> <worktree-dir-name> <branch> <review-body>
set -u
PR=$1; WT=/home/pyosechang/projects/lophn/.claude/worktrees/$2; BR=$3; BODY=$4
LOG=/tmp/claude-1000/-home-pyosechang-projects-lophn/68cbca68-64dc-464d-8a08-34f5c09553b9/scratchpad/check$PR.log
cd "$WT" || exit 2
git fetch -q origin; git merge -q --ff-only "origin/$BR" 2>/dev/null
if ! git merge -q --no-edit origin/main; then echo "CONFLICT #$PR"; git diff --name-only --diff-filter=U; exit 3; fi
if grep -rlsI '^<<<<<<< ' apps packages docs tools e2e open-issues.md 2>/dev/null | head -1 | grep -q .; then echo "MARKERS #$PR"; exit 3; fi
env -u LOPHN_HOME /tmp/claude-1000/-home-pyosechang-projects-lophn/68cbca68-64dc-464d-8a08-34f5c09553b9/scratchpad/light-check.sh > "$LOG" 2>&1; rc=$?
grep -E 'passed \||LIGHT' "$LOG" | tail -2
if [ $rc -ne 0 ]; then echo "CHECK FAILED #$PR"; grep -A15 '실패' "$LOG" | head -30; exit 4; fi
git push -q origin "$BR" || exit 5
h=$(git rev-parse HEAD); git fetch -q origin
if ! git merge-base --is-ancestor origin/main "$h"; then echo "MOVED #$PR"; exit 6; fi
gh pr review "$PR" --comment --body "$BODY" >/dev/null
gh pr merge "$PR" --squash --match-head-commit "$h" || exit 7
git push -q origin --delete "$BR" 2>/dev/null
cd /home/pyosechang/projects/lophn && git worktree remove --force "$WT"; git pull -q --ff-only
gh pr view "$PR" --json state,mergeCommit --jq '"#'$PR' \(.state) \(.mergeCommit.oid[0:7])"'
