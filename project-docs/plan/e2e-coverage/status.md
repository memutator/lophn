# 상태

lead만 고친다. `tools/status.py e2e-coverage build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-cli-finish` | app-cli-finish | 1 | 없음 | merged | app-cli-finish/app-cli-finish | 6e60c4309 |  |
| `boot-damaged` | boot-damaged | 1 | 없음 | merged | boot-damaged/boot-damaged | 602ee09a2 |  |
| `coding-role` | coding-role | 1 | boot-damaged | merged | coding-role/coding-role | d46289a85 |  |
| `gateway-client` | gateway-client | 1 | 없음 | merged | gateway-client/gateway-client | 4e55b37c4 |  |
| `reply-fn` | reply-fn | 1 | 없음 | merged | reply-fn/reply-fn | 87dbd4d3e |  |
| `annotation-archived-app` | annotation-archived-app | 2 | annotation-to-ae | merged | annotation-archived-app/annotation-archived-app | 4c3b188f0 |  |
| `annotation-to-ae` | annotation-to-ae | 2 | reply-fn | merged | annotation-to-ae/annotation-to-ae | 836984c8d |  |
| `approval-rows` | approval-rows | 2 | boot-damaged | merged | approval-rows/approval-rows | a7ce86a91 |  |
| `boot-rows` | boot-rows | 2 | boot-damaged | merged | boot-rows/boot-rows | 43dec93aa |  |
| `call-gate` | call-gate | 2 | 없음 | merged | call-gate/call-gate | b0189e380 |  |
| `compact` | compact | 2 | 없음 | merged | compact/compact | 26b703e18 |  |
| `file-write-rows` | file-write-rows | 2 | 없음 | merged | file-write-rows/file-write-rows | 934cb4860 |  |
| `oauth-issuer` | oauth | 2 | 없음 | merged | oauth/oauth-issuer | fe8778459 |  |
| `pm-context` | pm-context | 2 | reply-fn | merged | pm-context/pm-context | dc5355b4f |  |
| `pm-tools` | pm-tools | 2 | 없음 | merged | pm-tools/pm-tools | 0bf40226b |  |
| `prompt-blocked` | prompt-blocked | 2 | 없음 | merged | prompt-blocked/prompt-blocked | 19b3b3f9e |  |
| `prompt-notice` | prompt-notice | 2 | reply-fn | merged | prompt-notice/prompt-notice | c1768683d |  |
| `reaction-rows` | reaction-rows | 2 | boot-damaged, gateway-client | merged | reaction-rows/reaction-rows | 7faedf9d5 |  |
| `registration-rows` | registration-rows | 2 | 없음 | merged | registration-rows/registration-rows | 6901fa09a |  |
| `rewind-rows` | rewind-rows | 2 | 없음 | merged | rewind-rows/rewind-rows | c9e2e22ec |  |
| `secret-rows` | secret-rows | 2 | 없음 | merged | secret-rows/secret-rows | 577e9956a |  |
| `session-archive-calls` | session-archive-calls | 2 | reply-fn, session-scope | merged | session-archive-calls/session-archive-calls | 0e0624e49 |  |
| `session-rows` | session-rows | 2 | 없음 | merged | session-rows/session-rows | 080476589 |  |
| `session-scope` | session-scope | 2 | session-rows | merged | session-scope/session-scope | e120be42a |  |
| `steer` | steer | 2 | 없음 | merged | steer/steer | 3abf290dd | 단정 3: steer 메시지의 messages_only rewind. 문서대로 gather를 고친다(rewind-rows merge 뒤, 추가 소유) |
| `test-app` | test-app | 2 | reply-fn, boot-damaged, gateway-client, coding-role, app-cli-finish | merged | test-app/test-app | 696bf90f1 | coding 길 bug 1·7·8 + run 경로. release 쪽은 release-cold-cache |
| `agent-call` | agent-call | 3 | reply-fn, call-gate, restart-rows | merged | agent-call/agent-call | 53fcef2a1 |  |
| `app-activation` | app-activation | 3 | test-app | running | app-activation/app-activation |  |  |
| `app-call` | app-call | 3 | test-app | merged | app-call/app-call | 8c86db1be |  |
| `app-data-rewind` | app-data-rewind | 3 | test-app | merged | app-data-rewind/app-data-rewind | 70109b857 |  |
| `app-restart` | app-restart | 3 | test-app | running | app-restart/app-restart |  |  |
| `app-sandbox` | app-sandbox | 3 | test-app | merged | app-sandbox/app-sandbox | d758a0a00 |  |
| `coding-cancel-keeps-ticket` | coding-cancel-keeps-ticket | 3 | coding-one-per-app | merged | coding-cancel-keeps-ticket/coding-cancel-keeps-ticket | 4691cfbf0 |  |
| `coding-end-without-report` | coding-end-without-report | 3 | coding-report-needs-release | merged | coding-end-without-report/coding-end-without-report | 00216e611 |  |
| `coding-message-to-ae` | coding-message-to-ae | 3 | coding-end-without-report | merged | coding-message-to-ae/coding-message-to-ae | 57364371b |  |
| `coding-one-per-app` | coding-one-per-app | 3 | coding-message-to-ae | merged | coding-one-per-app/coding-one-per-app | 1052825e9 |  |
| `coding-report-needs-release` | coding-report-needs-release | 3 | coding-token-scope | merged | coding-report-needs-release/coding-report-needs-release | 13f333075 |  |
| `coding-token-not-stored` | coding-token-not-stored | 3 | coding-cancel-keeps-ticket | merged | coding-token-not-stored/coding-token-not-stored | eb45b02c9 |  |
| `coding-token-scope` | coding-token-scope | 3 | test-app, coding-role, gateway-client, reply-fn | merged | coding-token-scope/coding-token-scope | aff4042fa |  |
| `app-socket-root` | fix | 3 | 없음 | merged | fix/app-socket-root | f690e93ed |  |
| `caller-directory` | fix | 3 | 없음 | merged | fix/caller-directory | 9cf9bb9a6 |  |
| `cli-app-input` | fix | 3 | test-app | merged | fix/cli-app-input | 22aa43da8 | test-app 전에 당김. 앱 E2E 확인은 merge 때 |
| `release-cold-cache` | fix | 3 | test-app | merged | fix/release-cold-cache | 070d975d9 | release 길 bug 2·3·4 같이(test-app commit 위) |
| `oauth-login` | oauth | 3 | oauth-issuer | merged | oauth/oauth-login | 9b74f30f3 |  |
| `oauth-token` | oauth | 3 | oauth-login | merged | oauth/oauth-token | db973d5b3 |  |
| `operator-app-api` | operator | 3 | test-app, reply-fn | merged | operator/operator-app-api | 2124e9270 |  |
| `operator-grants` | operator | 3 | operator-app-api | merged | operator/operator-grants | f4bce5e43 |  |
| `operator-project-write` | operator | 3 | operator-grants | merged | operator/operator-project-write | 3ca4a25db |  |
| `reaction-app` | reaction-app | 3 | reaction-rows, test-app | merged | reaction-app/reaction-app | fa1b9f126 |  |
| `reaction-context` | reaction-context | 3 | pm-context | merged | reaction-context/reaction-context | 915745354 |  |
| `restart-rows` | restart-rows | 3 | 없음 | merged | restart-rows/restart-rows | d83cd01cd |  |
| `stop-rows` | stop-rows | 3 | turn-fate | merged | stop-rows/stop-rows | 9be971ca0 |  |
| `turn-fate` | turn-fate | 3 | 없음 | merged | turn-fate/turn-fate | d7ee5791d |  |
