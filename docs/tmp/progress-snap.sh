#!/bin/bash
# Append one progress snapshot line to .dev-data/progress-log.md
cd /home/pyosechang/projects/lophn && git fetch -q origin
L=.dev-data/progress-log.md
r=$(node /home/pyosechang/projects/lophn/docs/tmp/plan-count.js now | awk '{print $2}')
d=${r%/*}; n=${r#*/}
pct=$(( d * 100 / n ))
open=$(gh pr list --state open --json number -q length)
m1=$(git log origin/main --since="1 hour ago" --oneline | wc -l)
prev=$(tail -1 $L | awk -F'|' '{gsub(/ /,"",$3); print $3}' | cut -d/ -f1)
delta=$([ -n "$prev" ] && [ "$prev" -eq "$prev" ] 2>/dev/null && echo $((d-prev)) || echo -)
echo "| $(date '+%m-%d %H:%M') | $d/$n | $pct% | $delta | $m1 | $open |" >> $L
