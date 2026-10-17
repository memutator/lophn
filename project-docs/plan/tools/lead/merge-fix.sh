#!/bin/bash
# merge-fix.sh <계획> <id>: 단위 없는 `fix/<id>` branch용 merge.sh
FIX=1 exec "$(dirname "$0")/merge.sh" "$@"
