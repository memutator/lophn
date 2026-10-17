# 상태

lead만 고친다. `tools/status.py e2e-coverage build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-cli-finish` | app-cli-finish | 1 | 없음 | running | app-cli-finish/app-cli-finish |  |  |
| `boot-damaged` | boot-damaged | 1 | 없음 | running | boot-damaged/boot-damaged |  |  |
| `coding-role` | coding-role | 1 | boot-damaged | todo |  |  |  |
| `gateway-client` | gateway-client | 1 | 없음 | running | gateway-client/gateway-client |  |  |
| `reply-fn` | reply-fn | 1 | 없음 | running | reply-fn/reply-fn |  |  |
| `annotation-archived-app` | annotation-archived-app | 2 | annotation-to-ae | todo |  |  |  |
| `annotation-to-ae` | annotation-to-ae | 2 | reply-fn | todo |  |  |  |
| `approval-rows` | approval-rows | 2 | boot-damaged | todo |  |  |  |
| `boot-rows` | boot-rows | 2 | boot-damaged | todo |  |  |  |
| `call-gate` | call-gate | 2 | 없음 | running | call-gate/call-gate |  |  |
| `compact` | compact | 2 | 없음 | running | compact/compact |  |  |
| `file-write-rows` | file-write-rows | 2 | 없음 | running | file-write-rows/file-write-rows |  |  |
| `oauth-issuer` | oauth | 2 | 없음 | todo |  |  |  |
| `pm-context` | pm-context | 2 | reply-fn | todo |  |  |  |
| `pm-tools` | pm-tools | 2 | 없음 | running | pm-tools/pm-tools |  |  |
| `prompt-blocked` | prompt-blocked | 2 | 없음 | running | prompt-blocked/prompt-blocked |  |  |
| `prompt-notice` | prompt-notice | 2 | reply-fn | todo |  |  |  |
| `reaction-rows` | reaction-rows | 2 | boot-damaged, gateway-client | todo |  |  |  |
| `registration-rows` | registration-rows | 2 | 없음 | running | registration-rows/registration-rows |  |  |
| `rewind-rows` | rewind-rows | 2 | 없음 | running | rewind-rows/rewind-rows |  |  |
| `secret-rows` | secret-rows | 2 | 없음 | running | secret-rows/secret-rows |  |  |
| `session-archive-calls` | session-archive-calls | 2 | reply-fn, session-scope | todo |  |  |  |
| `session-rows` | session-rows | 2 | 없음 | running | session-rows/session-rows |  |  |
| `session-scope` | session-scope | 2 | session-rows | todo |  |  |  |
| `steer` | steer | 2 | 없음 | blocked | steer/steer |  | 단정 3: steer 메시지의 messages_only rewind. 문서대로 gather를 고친다(rewind-rows merge 뒤, 추가 소유) |
| `test-app` | test-app | 2 | reply-fn, boot-damaged, gateway-client, coding-role, app-cli-finish | todo |  |  |  |
| `agent-call` | agent-call | 3 | reply-fn, call-gate, restart-rows | todo |  |  |  |
| `app-activation` | app-activation | 3 | test-app | todo |  |  |  |
| `app-call` | app-call | 3 | test-app | todo |  |  |  |
| `app-data-rewind` | app-data-rewind | 3 | test-app | todo |  |  |  |
| `app-restart` | app-restart | 3 | test-app | todo |  |  |  |
| `app-sandbox` | app-sandbox | 3 | test-app | todo |  |  |  |
| `coding-cancel-keeps-ticket` | coding-cancel-keeps-ticket | 3 | coding-one-per-app | todo |  |  |  |
| `coding-end-without-report` | coding-end-without-report | 3 | coding-report-needs-release | todo |  |  |  |
| `coding-message-to-ae` | coding-message-to-ae | 3 | coding-end-without-report | todo |  |  |  |
| `coding-one-per-app` | coding-one-per-app | 3 | coding-message-to-ae | todo |  |  |  |
| `coding-report-needs-release` | coding-report-needs-release | 3 | coding-token-scope | todo |  |  |  |
| `coding-token-not-stored` | coding-token-not-stored | 3 | coding-cancel-keeps-ticket | todo |  |  |  |
| `coding-token-scope` | coding-token-scope | 3 | test-app, coding-role, gateway-client, reply-fn | todo |  |  |  |
| `oauth-login` | oauth | 3 | oauth-issuer | todo |  |  |  |
| `oauth-token` | oauth | 3 | oauth-login | todo |  |  |  |
| `operator-app-api` | operator | 3 | test-app, reply-fn | todo |  |  |  |
| `operator-grants` | operator | 3 | operator-app-api | todo |  |  |  |
| `operator-project-write` | operator | 3 | operator-grants | todo |  |  |  |
| `reaction-app` | reaction-app | 3 | reaction-rows, test-app | todo |  |  |  |
| `reaction-context` | reaction-context | 3 | pm-context | todo |  |  |  |
| `restart-rows` | restart-rows | 3 | 없음 | todo |  |  |  |
| `stop-rows` | stop-rows | 3 | turn-fate | todo |  |  |  |
| `turn-fate` | turn-fate | 3 | 없음 | running | turn-fate/turn-fate |  |  |
