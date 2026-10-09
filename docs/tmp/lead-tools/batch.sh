#!/bin/bash
# usage: LIST="408 409" MERGE_COMMIT_PRS="409" bash batch.sh >> .dev-data/batchN.log
T=/home/pyosechang/projects/lophn/.dev-data/lead-tools
Q=/home/pyosechang/projects/lophn/.dev-data/merge-queue.txt
NOTE=" 묶음 통합 branch(lead/merge-batch)에서 light-check(fmt·lint·deps·contract coverage·type check·docs·바뀐 폴더 test·core tripwire·shell check) 통과를 확인한 뒤 merge."
export MERGE_COMMIT_PRS
for pr in $LIST; do
  line=$(grep "^$pr|" $Q | head -1); wt=$(echo "$line" | cut -d'|' -f2); rev=$(echo "$line" | cut -d'|' -f3-)
  echo "== $pr $(date +%H:%M)"
  bash $T/merge-nocheck.sh $pr $wt "$rev$NOTE" </dev/null 2>&1 | tail -3
  st=$(gh pr view $pr --json state -q .state); echo "=> #$pr $st"
  [ "$st" = MERGED ] || { echo "STOP at #$pr"; exit 1; }
  sed -i "/^$pr|/d" $Q
done
echo ALL-DONE
