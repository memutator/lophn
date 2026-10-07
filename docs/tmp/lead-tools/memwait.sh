#!/bin/bash
# usage: memwait.sh <command...>
# 보통 test 실행(deno test 등). 쓸 수 있는 메모리가 6GB 아래면 기다리고, 메모리 상한 4GB(swap 256MB) scope 안에서 돈다.
while [ "$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)" -lt 6 ]; do sleep 15; done
exec systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=256M "$@"
