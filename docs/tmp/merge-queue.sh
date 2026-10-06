#!/bin/bash
# Lead merge chain v3: merge main into the PR first; plan-doc-only conflicts are resolved keeping both sides; then format and merge.sh.
W=/home/pyosechang/projects/lophn/docs/tmp
cd /home/pyosechang/projects/lophn
done_list=" "
while true; do
  line=$(grep -v '^$' "$1" | while IFS='|' read -r pr wt rev; do case "$done_list" in *" $pr:$(echo "$rev" | md5sum | cut -c1-8) "*) ;; *) echo "$pr|$wt|$rev"; break;; esac; done)
  [ -z "$line" ] && { sleep 60; continue; }
  IFS='|' read -r pr wt rev <<<"$line"
  done_list="$done_list$pr:$(echo "$rev" | md5sum | cut -c1-8) "
  st=$(gh pr view $pr --json state -q .state 2>/dev/null)
  echo "== $pr ($st) $(date +%H:%M)"
  [ "$st" = OPEN ] || continue
  br=$(gh pr view $pr --json headRefName -q .headRefName)
  d=.claude/worktrees/$wt
  ( cd $d && git merge --abort 2>/dev/null; git fetch -q origin && git merge -q --ff-only "origin/$br" 2>/dev/null
    if ! git merge -q --no-edit origin/main >/dev/null 2>&1; then
      u=$(git diff --name-only --diff-filter=U)
      if [ -n "$u" ] && ! echo "$u" | grep -qvE '^docs/plan/.*\.md$'; then
        python3 $W/keepboth.py $u && git add $u && git commit -qm "Merge origin/main

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && echo "auto-resolved plan: $u"
      else git merge --abort 2>/dev/null; exit 0; fi
    fi
    f=$(git diff --name-only origin/main -- packages apps e2e tools | grep -E '\.(ts|tsx|md|json)$' | grep -v 'deno.lock$')
    [ -n "$f" ] && deno fmt -q $f 2>/dev/null
    git checkout -- apps/shell/main/desktop/core/deno.lock 2>/dev/null
    git diff --quiet || git commit -qam "Format changed files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push -q origin HEAD:"$br" ) </dev/null
  bash docs/tmp/merge.sh $pr $wt $br "$rev" </dev/null 2>&1 | grep -E "MERGED|CONFLICT|FAILED|MOVED|MARKERS|=> " | tail -5
done
