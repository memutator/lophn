# 상태

lead만 고친다. `tools/status.py testing build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `e2e-support-core` | e2e-support | 1 | 없음 | running | e2e-support/e2e-support-core |  |  |
| `e2e-support-server` | e2e-support | 1 | 없음 | running | e2e-support/e2e-support-server |  |  |
| `harness-loop` | harness-loop | 1 | 없음 | running | harness-loop/harness-loop |  |  |
| `harness-wire` | harness-wire | 1 | 없음 | running | harness-wire/harness-wire |  |  |
| `test-tasks` | test-tasks | 1 | 없음 | running | test-tasks/test-tasks |  |  |
| `e2e-approval` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-file-write` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-restart` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-rewind` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-secret` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-stop` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-support-shape` | e2e-support | 2 | e2e-support-server, harness-wire | todo |  |  |  |
| `harness-wire-idle` | harness-wire | 2 | harness-wire | todo |  |  |  |
| `live-suite` | live-suite | 2 | harness-wire | todo |  |  |  |
| `dev-fake` | dev-fake | 3 | e2e-support-server, e2e-support-core | todo |  |  |  |
