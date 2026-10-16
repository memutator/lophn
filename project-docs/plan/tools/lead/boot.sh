#!/bin/bash
# boot.sh: route duplicates, then start core twice on the same fresh data root (restart check).
cd /home/pyosechang/projects/lophn
D=/home/pyosechang/projects/lophn/project-docs/plan/tools/lead; L=${TMPDIR:-/tmp}
deno run -A --config deno.json $D/dup-routes.ts 2>&1 | head -1
H=.dev-data/boot; rm -rf $H; mkdir -p -m 700 $H
for i in 1 2; do
  (sleep 12) | LOPHN_HOME=$PWD/$H timeout 40 deno run -A packages/core/main/daemon/main.ts --port=0 >/dev/null 2>$L/lophn-boot-$i.err
  echo "boot $i exit $?"; grep -v "^Listening" $L/lophn-boot-$i.err | head -5
done
rm -rf $H
