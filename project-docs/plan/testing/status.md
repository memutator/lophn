# 상태

lead만 고친다. `tools/status.py testing build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `e2e-support-core` | e2e-support | 1 | 없음 | merged | e2e-support/e2e-support-core | 66caef523 |  |
| `e2e-support-server` | e2e-support | 1 | 없음 | merged | e2e-support/e2e-support-server | ac5697862 |  |
| `harness-loop` | harness-loop | 1 | 없음 | merged | harness-loop/harness-loop | d9919ab34 |  |
| `harness-wire` | harness-wire | 1 | 없음 | merged | harness-wire/harness-wire | d9e3b1777 |  |
| `test-tasks` | test-tasks | 1 | 없음 | merged | test-tasks/test-tasks | e87d92ae1 | fix: --ignore가 deno.json exclude를 대체해서 DENO_EXCLUDED를 같이 준다 |
| `e2e-approval` | e2e | 2 | e2e-support-server, e2e-support-core | blocked | e2e/e2e-approval |  | 제품 bug 둘: session_snapshots/list read 없음(issues/event.md), 성공한 tool call이 requested(issues/place-session.md) |
| `e2e-file-write` | e2e | 2 | e2e-support-server, e2e-support-core | merged | e2e/e2e-file-write | d6bcdc913 | 제품 bug: 성공한 tool call이 ledger에 requested로 남는다(issues/place-session.md) |
| `e2e-restart` | e2e | 2 | e2e-support-server, e2e-support-core | blocked | e2e/e2e-restart |  | 제품 bug: session_snapshots/list read 없음(issues/event.md) |
| `e2e-rewind` | e2e | 2 | e2e-support-server, e2e-support-core | merged | e2e/e2e-rewind | f59c10aee | 제품 bug: rewind/preview restore_all의 appWritesPort 미등록(issues/place-session.md) |
| `e2e-secret` | e2e | 2 | e2e-support-server, e2e-support-core | merged | e2e/e2e-secret | b95601580 |  |
| `e2e-stop` | e2e | 2 | e2e-support-server, e2e-support-core | merged | e2e/e2e-stop | eb9e8014b | 제품 bug: turns/stop이 child의 진행 중인 model 요청을 끊지 않는다(issues/place-session.md) |
| `e2e-support-shape` | e2e-support | 2 | e2e-support-server, harness-wire | merged | e2e-support/e2e-support-shape | 63e15198b |  |
| `rewind-port` | fix | 2 | 없음 | merged | fix/rewind-port | 7c2318309 |  |
| `session-snapshots` | fix | 2 | 없음 | running | fix/session-snapshots |  |  |
| `tool-call-state` | fix | 2 | 없음 | merged | fix/tool-call-state | c7fe5677b |  |
| `turn-stop` | fix | 2 | 없음 | merged | fix/turn-stop | 5e5ef4df3 |  |
| `harness-wire-idle` | harness-wire | 2 | harness-wire | merged | harness-wire/harness-wire-idle | 25aa1435f |  |
| `live-suite` | live-suite | 2 | harness-wire | merged | live-suite/live-suite | 23b81cab9 |  |
| `dev-fake` | dev-fake | 3 | e2e-support-server, e2e-support-core | merged | dev-fake/dev-fake | 355625354 |  |
