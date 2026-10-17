# 문서에서 더 뽑은 E2E 후보

planner가 `project-docs/architecture/*.md`(activation, app-call, approval, agent-call, place-session, agent-definition, event, coding-agent, annotation)와 `project-docs/products/AGENT-ROLE.md`를 읽고 뽑았다. 계획 README의 단위에 이미 있는 것은 뺐다. 근거는 문서와 줄 번호(AGENT-ROLE은 항목 기호)다. support는 README 단위 이름이다: 없음(지금 support), `reply-fn`, 앱(`test-app`·`gateway-client`·`coding-role`), session 여럿(`reply-fn`의 session별 줄).

route는 코드로 확인한 것만 이름을 적었다. 나머지는 brief를 쓸 때 확인한다.

## 1. Operator와 agent grant (AGENT-ROLE O1, O2, H3, T3~T6, app-call "agent에게는 app-api가 tool로 보인다", agent-definition "tool 목록은 session을 시작할 때 고정")

사람이 Operator에게 app-api를 할당하는 길은 `agent_grants/set`(SetAgentGrant, user만, decision handle 없음)이다. agent runtime은 `agent_grants/get`(machine)으로 읽어 app-api tool을 고른다.

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `operator-app-api` | 사람이 project에 Operator를 만든다(`operators/create`) → `agent_grants/set`으로 앱 하나를 할당 → Operator session → fake가 `app__<app>__list_items`, `add_item`을 부른다 → 앱 process가 돌고 invocation이 남는다 | O1. 앱 할당 ∩ release 선언 ∩ agent grant만 tool이 된다 | 앱 |
| `operator-app-api-excluded` | 같은 할당에서 `add_item`을 뺀다 → 첫 model 요청의 `tools[]`에 `add_item`이 없다. fake가 그래도 부르면 not_found로 막힌다 | H3. 사람이 뺀 app-api는 요청에 아예 없다 | 앱 |
| `operator-app-api-ask` | `add_item`을 "물음"으로 할당 → 부르면 turn이 허락을 기다린다 → 거절하면 앱 data가 그대로, 허락하면 쓰인다 | H3, app-call "Gate의 사람 대기는 write 줄에 서기 전에 끝낸다" | 앱 |
| `grant-change-mid-session` | Operator session이 열린 뒤 grant에 앱을 더한다 → 다음 turn의 `tools[]`는 그대로이고 대화 끝에 notice가 붙는다 | agent-definition "tool 목록은 session을 시작할 때 고정", "notice는 program이 쓴 고정 문장만" | 앱 |
| `operator-no-grant` | grant 없이 만든 Operator는 app-api tool이 하나도 없다. PM의 `operator.create`가 grant를 줄 길이 없다 | agent-definition "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다", approval "agent는 자기 grant를 넓히지 못한다" | 앱 |
| `app-operator-writes-project` | 앱 place의 Operator가 앱 data를 사람이 정한 project 폴더에 file로 쓴다 | O2. 열린 이슈 `issues/place-session.md` "앱 place의 Operator가 앱 data를 project 폴더에 쓸 길이 없다"가 이것이다. 지금은 빨강일 것이다 | 앱 |
| `operator-calls-app-engineer` | Operator가 App Engineer에게 결과를 받는 call → AE의 reply가 Operator session의 새 입력으로 온다 | O5, agent-call "result의 답은 받은 agent가 reply로 직접 보내야 done" | 앱 + session 여럿 |

## 2. activation (activation.md)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `activation-needs-verify` | release를 준비만 하고 `ticket.verify`를 안 부른다 → activation이 시작되지 않는다(활성 release가 없다) | 34행 "계기는 ticket 확인됨이고 release 준비만으로는 시작하지 않는다" | 앱 |
| `activation-first-asks` | 첫 activation은 보류 request로 사람에게 묻는다 → 거절하면 앱이 안 뜨고, 허락하면 뜬다 | 36행 "이전 활성 release가 없는 첫 activation", AGENT-ROLE H2, E6. **`app-release` flow의 단계에 이 허락이 들어가야 한다** | 앱 |
| `activation-widened-asks` | 둘째 release가 선언을 넓히면(permission 하나 더함) 다시 묻고, 안 넓히면 묻지 않는다 | 36, 38행 | 앱 |
| `activation-holds-calls` | activation 도중 들어온 앱 호출은 붙잡혔다가 새 release로 간다(실패하지 않는다) | 18, 24행 | 앱 |
| `activation-restart-resume` | activation 도중 core 재시작 → ledger대로 잇는다. 앱이 반쯤 바뀐 채 남지 않는다 | 35, 54행 | 앱 |
| `activation-supersedes-pending` | 첫 release가 허락을 기다리는 사이 더 새 release가 activation을 시작하면 이전 보류 request가 cancelled다 | 56행, approval 181행 | 앱 |
| `release-rollback` | 사람이 이전 release로 돌아간다. schema가 같을 때만 되고 DB는 그대로다 | 28, 64행 | 앱 |

## 3. 앱 호출 (app-call.md)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `app-call-from-screen` | 사람이 화면 대신 `apps/call_api`(user)로 `add_item`을 부른다 → Gate 없이 실행되고 invocation이 남는다 | 79행 "사람 화면은 거치지 않는다", 112행 기록 | 앱 |
| `app-call-unknown` | 앱 process를 호출 도중 죽인다 → 그 invocation은 unknown이고 다시 부르지 않는다. 앱이 멈춘 뒤 보내려던 호출은 unavailable이다 | 110행 | 앱 |
| `app-rewind-blocked-by-unknown` | unknown으로 닫힌 write가 범위에 있으면 앱 rewind가 막힌다 | 119행 | 앱 |
| `app-big-result-changeset-dropped` | 결과가 frame 한도를 넘으면 changeset만 빠지고 호출은 성공이며, 그 write는 rewind에서 "DB를 되돌리지 못함"으로 보인다 | 120, 119행 | 앱 |
| `app-input-too-large` | 입력이 `CALL_BODY_MAX_BYTES`를 넘으면 core가 보내기 전에 `invalid_input` | 121행 | 앱 |
| `app-write-serialized` | write 둘을 동시에 → 하나씩 돌고 changeset이 호출마다 따로다(rewind 하나가 다른 쪽을 안 지운다) | 105, 106행 | 앱 |
| `app-project-scope` | project에 놓인 agent가 project 범위 app-api를 부르면 자기 project로만 간다 | 101행 | 앱(template에 project 범위 api 하나 더) |
| `session-rewind-with-app` | session rewind에서 앱을 고르면 그 session의 첫 write부터 앱 rewind, 안 고르면 앱 data는 그대로 | place-session 38~40행, app-call 134행 | 앱 |
| `rewind-not-across-release` | activation 뒤에는 이전 release의 write를 rewind하지 못한다 | 122행 | 앱 |

## 4. approval (approval.md)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `allow-once-consumed` | "한 번 허락"을 받은 뒤 같은 쓰기를 다시 하면 다시 묻는다 | 176행 | 없음(`LOPHN.md` 쓰기) |
| `allow-session-scope` | "이 session 동안" 허락 → 같은 session은 안 묻고, 다른 session은 묻고, core 재시작 뒤에는 다시 묻는다 | 178행. 선택지가 app_api·MCP에만 있으면 앱 | 앱 |
| `reaction-ask` | reaction grant를 "물음"으로 둔다(Settings `reactions.problem_opened`) → 문제가 열리면 보류 request가 생기고, 허락해야 App Engineer session이 열린다. 같은 event를 다시 처리해도 request는 하나다 | 159, 180행, AGENT-ROLE E1 | 앱(문제를 여는 앱) |
| `reaction-off` | reaction grant "끔" → 문제가 열려도 session이 안 열린다. call 닫음(E4)은 끌 수 없다 | event 149행 | 앱 |
| `allow-reapplied-after-restart` | 보류 request를 허락한 직후 적용 전에 core가 꺼지면, 켤 때 다시 적용하고 효과는 한 번이다 | 185행 | 앱(activation 허락) |

## 5. agent call (agent-call.md, AGENT-ROLE §3·§4)

`agent-call` 단위(A→B result, B 끝, 재시작)에 행으로 더할 것이다.

| id | flow | 지키는 것 |
|---|---|---|
| `call-not-found` | 없는 이름으로 call → tool 결과가 `failed`(not_found). session이 안 생긴다 | 231, 232행, T9 |
| `call-closed-session` | 열린 session으로 보냈는데 닫혀 있다 → 새로 열지 않고 실패가 돌아온다 | 229행, T7 |
| `call-dedup` | 같은 tool call로 두 번(읽기 tool retry) → call과 session이 하나다 | 244, 245행, T15 |
| `call-cancel-late-reply` | 보낸 쪽이 cancel → 뒤늦은 reply는 `closed`로 돌아간다 | 251행, T18 |
| `call-sender-archived` | 보낸 session을 archive한 뒤 reply → 결과는 받은 session에만 남는다 | T13 |
| `call-none-no-reply` | 답 없는 call(none) → 받은 session이 열리고 보낸 쪽에는 답 입력이 오지 않는다 | R2 |
| `inbox-order` | 사람 메시지와 call이 함께 기다리면 사람 메시지가 먼저 다음 turn이다 | 250행 |

## 6. place와 session (place-session.md)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `place-archive-holds-input` | project를 보관하면 그 PM session은 open인 채 새 message·call을 안 받고, 꺼내면 이어서 받는다 | 31행 | 없음 |
| `session-archive-one-tx` | 허락 대기 중이고 받은 call이 열린 session을 archive → turn interrupted, request cancelled, 보낸 쪽 call은 receiver_ended | 29, 30행 | session 여럿 |
| `fork-copies-history` | 대화 몇 turn 뒤 fork → 새 session에 고른 지점까지의 메시지만 있고, rewind로 숨긴 구간과 허락은 없다 | 34, 35행 | 없음 |
| `rewind-needs-idle` | turn이 도는 중 session rewind → 거절 | 38행 | 없음 |
| `role-place-mismatch` | role에 맞지 않는 place로 session 열기(예: App Engineer를 project에) → 거절 | 21행 | 없음 |
| `lophn-reads-not-writes` | lophn이 등록된 project 폴더를 읽을 수 있고 쓰기 tool은 없다. 앱 place Operator는 source를 읽기만 한다 | 41행 | 없음(lophn), 앱(Operator) |

## 7. 지침과 tool 결과 (agent-definition.md)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `instructions-change-next-turn` | turn 사이에 사람이 `LOPHN.md`를 고친다 → 다음 model 요청의 prefix(system)는 그대로이고 대화 끝에 notice가 붙는다 | 79, 88행 | 없음 |
| `instructions-unreadable-no-turn` | `LOPHN.md`를 읽을 수 없게 만든다(권한 000) → turn이 시작되지 않고 이유가 남는다(model 요청 0) | 81행 | 없음 |
| `agents-md-ignored` | project에 `AGENTS.md`를 둔다 → model 요청 어디에도 그 글이 없다 | 84행 | 없음 |
| `shell-env-no-token` | shell로 `env`를 찍는다 → 출력(다음 model 요청의 tool 결과)에 lophn token, machine credential, provider key가 없다 | 95행. secret | 없음 |
| `definition-unreachable` | file tool로 data root 안 agent 정의 file·skill 폴더를 읽거나 쓰려 한다 → 막힌다 | 94행 | 없음(`file-write` 행으로) |
| `tool-result-capped` | shell 출력 100 KiB → 다음 요청의 tool 결과가 약 24 KiB이고 앞과 뒤가 남는다 | 97행 | 없음 |
| `images-latest-two` | `image.read` 셋 → 셋째 뒤 요청에 이미지 조각은 둘이고 가장 오래된 것은 `[image omitted]` | 98행 | 없음 |
| `skill-off` | skill을 끄면 skill 목록에 없고 읽기도 막힌다 | 105행 | 없음 |
| `human-message-ends-ask` | `ask`로 기다리는 중 사람이 그 session에 말한다 → 기다림이 끝나고 그 말이 tool 결과로 간다 | 109행 (README approval 행과 같음, 확인용) | 없음 |

## 8. event와 reaction (event.md, AGENT-ROLE §6)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `reaction-survives-restart` | 문제가 열린 commit 직후 core를 끈다 → 켤 때 Reactor가 이어 App Engineer session을 연다. 다시 켜도 session은 하나다 | 147, 153, 156행 | 앱 |
| `problem-opens-app-engineer` | 앱 오류로 문제가 열리면 그 앱의 App Engineer session이 열리고 문제 근거가 입력에 있다 | AGENT-ROLE A2, E1 | 앱 |
| `restart-halted-reaction` | 앱이 거듭 죽어 자동 재시작을 멈추면 App Engineer가 불린다 | AGENT-ROLE E2 | 앱 |
| `activation-failed-reaction` | activation이 실패하면 그 release의 App Engineer가 불린다 | AGENT-ROLE E3, activation 55행 | 앱 |
| `context-violation-reaction` | 문서가 계약을 어기면 그 project의 PM이 불린다 | AGENT-ROLE E5 | `reply-fn` |
| `gateway-snapshot-then-events` | Gateway에 조건을 걸고 ready 뒤 snapshot을 읽으면 그 사이 event를 놓치지 않는다 | 161행 | `gateway-client` |

## 9. coding agent (coding-agent.md, AGENT-ROLE K, T20)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `coding-token-scope` | coding token으로 다른 앱의 ticket이나 앱을 읽으면 막히고, session이 끝난 뒤 그 token의 호출은 거절된다 | 210행, K5 | 앱 |
| `coding-token-not-stored` | coding token이 ledger, log, data root file 어디에도 없다 | 211행 | 앱 |
| `coding-report-needs-release` | claim과 준비된 release 없이 완료 보고 → 거절. 있으면 접수되고 claim이 끝난다 | 219행 | 앱 |
| `coding-end-without-report` | coding session(터미널 process)이 보고 없이 끝나면 call이 failed이고 맡긴 App Engineer에게 한 번만 알린다 | 220행, T20, E4 | 앱 |
| `coding-message-to-ae` | coding agent가 `lophn message send` → 맡긴 AE session에, 닫혀 있으면 그 앱의 새 AE session에 | K4 | 앱 |
| `coding-one-per-app` | 한 앱에 둘째 ticket을 맡기면 줄에 서고(call accepted) 앞 session이 끝나면 열린다 | 217행 | 앱 |
| `coding-cancel-keeps-ticket` | call cancel → session이 멈추고 token이 회수되고 ticket은 열려 있다 | 221행 | 앱 |

## 10. 등록과 role (AGENT-ROLE P3, P5, L4)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `project-creates-pm` | project를 등록하면 PM 정의가 하나 생기고 사람이 더하거나 지울 수 없다 | P5, place-session 25행 | 없음 |
| `app-creates-ae` | 앱을 등록하면 App Engineer가 하나 생긴다 | P3 | 없음 |
| `lophn-registers-then-calls` | lophn이 `app.create`로 앱을 등록하고 그 App Engineer에게 답 없는 call로 맡긴다 → AE session이 열리고 맡긴 글이 입력에 있다 | L4 | `reply-fn`(앱 id) |

## 11. annotation (annotation.md. 화면 없이 core 쪽만)

| id | flow | 지키는 것 | support |
|---|---|---|---|
| `annotation-to-ae` | 사람이 `annotations/send`(test가 shell 역할로 앱·release·화면 이름을 준다) → 그 앱 AE의 열린 session(없으면 새)에 메시지 하나, AE의 `image.read annotation:<id>`가 screenshot을 연다. 다른 앱의 AE는 not_found | 252~256, 266, 272행 | 앱 |
| `annotation-archived-app` | 보관한 앱이면 저장이 conflict | 264행 | 앱 |
