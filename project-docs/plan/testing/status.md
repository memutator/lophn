# 상태

lead만 고친다. `tools/status.py testing build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `e2e-support-core` | e2e-support | 1 | 없음 | merged | e2e-support/e2e-support-core | 66caef523 |  |
| `e2e-support-server` | e2e-support | 1 | 없음 | merged | e2e-support/e2e-support-server | ac5697862 |  |
| `harness-loop` | harness-loop | 1 | 없음 | merged | harness-loop/harness-loop | d9919ab34 |  |
| `harness-wire` | harness-wire | 1 | 없음 | merged | harness-wire/harness-wire | d9e3b1777 |  |
| `test-tasks` | test-tasks | 1 | 없음 | merged | test-tasks/test-tasks | e87d92ae1 | fix: --ignore가 deno.json exclude를 대체해서 DENO_EXCLUDED를 같이 준다 |
| `e2e-approval` | e2e | 2 | e2e-support-server, e2e-support-core | running | e2e/e2e-approval |  |  |
| `e2e-file-write` | e2e | 2 | e2e-support-server, e2e-support-core | running | e2e/e2e-file-write |  |  |
| `e2e-restart` | e2e | 2 | e2e-support-server, e2e-support-core | running | e2e/e2e-restart |  |  |
| `e2e-rewind` | e2e | 2 | e2e-support-server, e2e-support-core | running | e2e/e2e-rewind |  |  |
| `e2e-secret` | e2e | 2 | e2e-support-server, e2e-support-core | todo |  |  |  |
| `e2e-stop` | e2e | 2 | e2e-support-server, e2e-support-core | running | e2e/e2e-stop |  |  |
| `e2e-support-shape` | e2e-support | 2 | e2e-support-server, harness-wire | running | e2e-support/e2e-support-shape |  |  |
| `harness-wire-idle` | harness-wire | 2 | harness-wire | running | harness-wire/harness-wire-idle |  |  |
| `live-suite` | live-suite | 2 | harness-wire | running | live-suite/live-suite |  |  |
| `dev-fake` | dev-fake | 3 | e2e-support-server, e2e-support-core | todo |  |  |  |
