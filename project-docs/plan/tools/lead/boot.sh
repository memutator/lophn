#!/bin/bash
# boot.sh: route 중복 검사 뒤, 새 data root로 core를 두 번 띄운다(재시작 확인). 각 boot의 exit 0을 본다.
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$ROOT" || exit 1
D=project-docs/plan/tools/lead; L=${TMPDIR:-/tmp}
node $D/dup-routes.ts 2>&1 | head -1
# core가 깐 sdk 설치 사본은 읽기 전용(0555)이라 쓰기 권한을 돌려준 뒤 지운다.
H=.dev-data/boot; chmod -R u+w $H 2>/dev/null; rm -rf $H; mkdir -p -m 700 $H
for i in 1 2; do
  # core는 stdin으로 끝나지 않는다. 12초 뒤 SIGTERM으로 정상 종료하고 core 자신의 exit code를 본다.
  LOPHN_HOME=$PWD/$H timeout --preserve-status -s TERM 12 env ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron packages/core/main/daemon/main.ts --port=0 </dev/null >/dev/null 2>$L/lophn-boot-$i.err
  echo "boot $i exit $?"; grep -v "^Listening" $L/lophn-boot-$i.err | head -5
done
chmod -R u+w $H; rm -rf $H
