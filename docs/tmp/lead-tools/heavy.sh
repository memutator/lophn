#!/bin/bash
# usage: heavy.sh <command...>
# lophn의 무거운 실행(e2e flow·Electron·shell build/npm check·npm ci·light-check)을 기계 전체에서 동시에 둘까지만 돌린다.
# 쓸 수 있는 메모리가 8GB 아래면 기다리고, 실행은 메모리 상한 8GB(swap 512MB)인 systemd scope 안에서 해서
# 새는 실행이 기계 전체를 swap thrashing에 빠뜨리지 않고 그 실행만 OOM으로 끝나게 한다.
D=/home/pyosechang/projects/lophn/.dev-data
got=""
until [ -n "$got" ]; do
  for slot in 1 2; do
    exec 9>"$D/heavy.$slot.lock"
    if flock -n 9; then got=$slot; break; fi
    exec 9>&-
  done
  [ -n "$got" ] || sleep 10
done
while [ "$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)" -lt 8 ]; do sleep 15; done
exec systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=512M "$@"
