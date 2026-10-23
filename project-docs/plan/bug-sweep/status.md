# 상태

lead만 고친다. `tools/status.py bug-sweep build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bs-agent-gate` | agent | 1 | 없음 | running | agent/bs-agent-gate |  |  |
| `bs-app-import-map` | apps | 1 | 없음 | running | apps/bs-app-import-map |  |  |
| `bs-release-probe-reason` | apps | 1 | 없음 | running | apps/bs-release-probe-reason |  |  |
| `bs-runtime-stderr` | core | 1 | 없음 | merged | core/bs-runtime-stderr | 8de37172a |  |
| `bs-graph-back-edge` | design | 1 | 없음 | running | design/bs-graph-back-edge |  |  |
| `bs-jobs` | jobs | 1 | 없음 | running | jobs/bs-jobs |  |  |
| `bs-attach-remove` | shell | 1 | 없음 | running | shell/bs-attach-remove |  |  |
| `bs-bridge-other-desk` | shell | 1 | 없음 | running | shell/bs-bridge-other-desk |  |  |
| `bs-route-string-check` | tools | 1 | 없음 | running | tools/bs-route-string-check |  |  |
