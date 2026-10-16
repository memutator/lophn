# event 아키텍처 (2026-10-13)

> **옮겨 가는 중 (2026-10-15):** 이 문서는 `../specs/event.md`(S1 초안)로 옮겨 가고 있다. 그 뒤 바뀐 것: fact를 domain event로 부른다. core의 바뀜 알림과 `notice`를 두지 않고 toast는 renderer가 정한다. `ReleasePrepared`는 domain event가 아니다(activation은 ticket 확인됨으로 시작). 남지 않는 event `ApprovalRequested`를 둔다. 구독은 session과 종류로 거른다. 이 문서와 S1이 다르면 S1을 따른다.

사람(원문 그대로): "아니 그래서 event 관련해서 처음부터 끝까지 정리해서 말해봐" → "아니 requirements가 아니라 아키텍쳐를 구상하라고" → (lead 구상) → "거기서 과한 건 없어? 아까 조사 결과들하고 대조해봤을 때" → (lead: 다섯 군데 고침) → "앱 event는 뭘 말하는거야" → "내가 말한 app event는 그런 게 아니고 뭐 sdk나 그런데서 의존성이 바뀐다거나 아니면 뭐 버그가 일어났다거나 그런 것들" → (lead: 앱을 두고 일어나는 일 표) → "ㄱㄱ"

재료: `event-model-draft.md`(agent event 집합과 앞선 제안, 지금은 지움. 내용은 이 문서와 docs-review에 있다), `../research/events-*.md`(다른 coding agent), `../research/paseo.md`, `../research/orca.md`, 지금 코드(`packages/core/storage/ledger`, `packages/core/events`, `packages/protocol/events`).

## 1. 그림

```
            만드는 쪽                         core 안                                받는 쪽
 ┌─────────────────────────┐
 │ run-loop (lophn agent)  │──agent event──┐
 │ harness adapter         │──agent event──┤
 │ command (domain 변경)    │──바뀜 알림─────┼──▶ Bus(메모리) ──▶ Gateway ──▶ shell 화면
 │                         │──fact(같은 tx)─▶ Ledger(영구) ─┐        ▲
 └─────────────────────────┘                                │        └ 처음과 다시 붙을 때 snapshot 읽기
                                                            ▼
                                              Reactor (cursor, fact마다 handler, approval이 끼는 자리)
                                                            │
                     사람 메시지, agent call ──▶ Router (봉투를 붙여 session에 입력)
                                                            │
                                              ┌─────────────┴──────────────┐
                                              ▼                            ▼
                                     run-loop 입력함              harness adapter → coding agent
```

## 2. 부품

| 부품 | 맡는 일 | 저장 | 지금 코드 |
|---|---|---|---|
| Bus | core 안 메모리 pub/sub. topic은 `session:<id>`(agent event), `change:<kind>`(바뀜 알림), `notice`(toast) | 안 함 | 없음. 지금은 화면도 ledger를 읽는다(`packages/core/events/subscribe.ts`) |
| Ledger | 반응할 사실(fact)만 남는 append-only 표. domain 변경과 같은 transaction에 쓴다(transactional outbox). 읽는 것은 Reactor뿐이다 | SQLite `events`, 고칠 수 없음 | 있음(`packages/core/storage/ledger`). 지금은 모든 변경을 쓰고 화면 구독도 읽는다 |
| Reactor | ledger를 cursor로 이어 읽고 fact 종류마다 handler를 부른다. handler는 평범한 코드이고 rule engine을 두지 않는다. idempotency key로 두 번 반응하지 않는다 | `subscriber_cursors`, `command_results` | 있음(`reaction.ts`, cursor 표) |
| Router | "agent session에 입력을 넣는다" 한 입구. agent call의 봉투(보낸 쪽, 받는 곳, 답 방식, `reply_to`, `agent-call.md`)를 붙여 넣는다. 새 session은 `to`가 새 session일 때와, 보내는 쪽이 "열린 session, 없으면 새 session"을 골랐을 때만 연다. 열린 session으로 보냈는데 닫혀 있으면 열지 않고 실패를 돌려준다. lophn agent면 run-loop 입력함으로, coding agent면 harness adapter로 | 입력은 받는 session의 대화 기록에 | 일부(run 출처 `message`, `handoff`) |
| Run-loop | lophn agent를 돌리고 agent event를 bus에 낸다. 대화 기록(message, tool call과 결과, compact 경계)은 session 기록에 쓴다 | session 기록 | 있음. 지금은 agent event를 ledger에 쓴다 |
| Harness adapter | harness마다 하나. 여는 방식이 tui면 터미널 탭의 TUI로 띄우고(req-1091) 신호는 hook으로 받는다. headless(나중)면 session 동안 process가 살아 있는 streaming 모드(`claude -p --input-format stream-json`, `codex app-server` 등)로 띄우고 신호는 harness가 내는 JSON stream으로 받는다. turn마다 process가 끝나는 비대화 실행은 쓰지 않는다. process 종료를 session 끝으로 보기 때문이다(7장). hook은 앱 source 폴더의 harness 설정에 두고 사용자 전역 설정은 건드리지 않는다(Claude Code `.claude/settings.local.json`, Codex `<repo>/.codex/hooks.json`, Gemini `.gemini/settings.json`. Codex와 Gemini는 project hook을 trust해야 돈다). hook은 lophn CLI를 불러 core에 알리고, adapter가 lophn agent event 이름으로 바꿔 bus에 낸다. Router의 입력은 PTY에 넣는다 | 외부 session ID 연결만 | 일부 |
| Gateway | 화면 WebSocket. 처음 붙을 때 Read API로 snapshot을 읽고 그 뒤 bus topic을 받는다. 끊겼다 붙으면 다시 읽는다 | 안 함 | 있음(ledger 기반 → bus 기반) |

## 3. 메시지 세 가지

| 종류 | 봉투 | 보장 |
|---|---|---|
| fact(반응할 사실) | `seq`(전역), `type`, `subject`, `actor`, `at`, `payload` | 영구. Reactor에 최소 한 번 + idempotent 처리 = 효과는 한 번 |
| agent event | `session`, `type`, `at`, `payload` | 메모리. 한 연결 안에서 순서대로. 놓치면 snapshot을 다시 읽는다. 저장도 replay도 없어 seq를 두지 않는다 |
| 바뀜 알림 | `kind`, `id` | 메모리. command가 바꾸는 대상을 선언하고, commit 뒤 대상마다 자동으로 낸다. domain마다 event type을 만들지 않는다 |

session snapshot은 지금 상태(running, waiting, idle, unknown)와 대기 중인 권한 요청을 담는다. 늦게 붙은 화면도 답을 기다리는 요청을 본다(paseo `pendingPermissions`와 같은 모양).

## 4. agent event 

| event | lophn agent | coding agent |
|---|---|---|
| `SessionStarted` | ○ | ○ (외부 session ID를 잇는 근거) |
| `MessageReceived` | ○ | ○ (App Engineer가 보내는 첫 prompt와 추가 메시지) |
| `TurnStarted` | ○ | ○ |
| `TurnEnded` (completed, failed, interrupted) | ○ | ○ |
| `ToolCallStarted`, `ToolCallEnded` | ○ | × |
| `PermissionRequested`, `PermissionResolved` | ○ | harness가 물어 올 때만 |
| `CompactStarted`, `CompactEnded` | ○ | × |
| `SessionEnded` (reason) | ○ | ○ |

상태는 core가 이 event에서 계산한다. 끝난 session을 되살리면(나중, `agent-call.md`) `SessionStarted`를 다시 내고 payload에 되살림을 적는다. 되살려도 session 허락과 대기 중이던 권한 요청은 돌아오지 않는다(req-0319). subagent는 보류하고 model 호출은 넣지 않는다. coding agent는 harness가 알려 준 것만 바꾸고, 없는 것은 process 종료로 알거나 unknown으로 둔다.

## 5. 반응할 사실 (후보, 목록과 반응은 approval 이야기에서 정한다)

| 주인 | fact | 반응할 쪽(예) |
|---|---|---|
| problems | 문제 열림(처리 안 된 오류, SDK 보고), 해결된 문제가 다시 열림 | App Engineer |
| app-runtime | 앱이 거듭 죽어 자동 재시작을 멈춤(req-0933) | App Engineer, 사람 |
| app-releases | release 준비 끝남 | 사람(activation 승인) |
| app-releases | activation 실패 | App Engineer |
| app-tickets | 완료 보고, claim 만료 | App Engineer |
| coding agent | 완료 보고 없이 session이 끝남 | App Engineer |
| contexts | 위반 생김(사람이 문서를 계약 밖으로 고침) | 사람(toast), Context Engineer |
| approvals | 보류 gate의 결정(`ApprovalDecided`). activation, 물음인 reaction | 그 종류의 Reactor handler(`approval.md` 4장) |

fact가 아닌 것:

- 바뀜 알림이면 되는 것: 열린 문제의 또 다른 발생, activation 성공, 앱 시작과 멈춤, 위반이 고쳐짐, 판 적용과 되돌림, saved view, 용어집, 설정, agent 정의, session 이름·archive.
- 호출 결과로 바로 돌려주는 것: release 준비 중 test 실패(coding agent에게), 새 판의 test 실패(Context Engineer에게). 새 판이 다른 context가 가리키는 public type이나 field를 없애면 판 test가 잡아 적용하지 않는다.
- 의존성 새 version(lophn update의 SDK, 사용자 package): 바뀜 알림만. 앱 의존은 정확한 version으로 고정되어 새 release 전에는 바뀌지 않는다. App Engineer는 그 앱을 고칠 때 목록을 보고 판단한다.
- 다루지 않는 것: npm·jsr package의 새 version과 취약점(바깥 일, 기준 4), agent tool call과 app-api 호출(agent event와 invocation이 맡는다).

## 6. 흐름

1. 사람 메시지: shell → Router(보낸 쪽 사람) → run-loop → agent event가 bus → Gateway → 화면.
2. program이 agent를 부름: command가 domain 변경과 fact(예: 문제 열림)를 한 tx로 씀 → Reactor handler → (approval) → Router(보낸 쪽 program, 근거 fact seq) → App Engineer session.
3. agent가 agent를 부름(agent call): run-loop의 tool이 Router(봉투: 보낸 session, 받는 곳, 답 방식, 내용) → 받는 session. 답(result, conversation)은 같은 길로 보낸 session에 돌아온다. 자세한 규칙은 `agent-call.md`.
4. coding agent: App Engineer → Router(보낸 쪽 agent) → harness adapter가 첫 prompt를 넣음. harness 신호 → adapter → `TurnEnded` 등이 bus로. 완료 보고는 CLI command라 fact로 남고 Reactor → App Engineer. 완료 보고, claim 만료, 보고 없는 session 끝은 이 fact → Reactor 한 길로만 App Engineer에게 가고, 그 handler가 그 call의 상태도 닫는다. 맡긴 App Engineer session이 닫혀 있으면 그 앱의 App Engineer 새 session으로 간다(받는 곳: 열린 session, 없으면 새 session). coding agent가 App Engineer에게 하는 말(막힘, 방향 확인)은 CLI → Router(보낸 쪽 coding agent session, 근거 ticket) → 맡긴 App Engineer session으로 가고 ledger에 쓰지 않는다(req-1491). 개발 진행은 따로 동기화하지 않는다. 돌고 있는지는 session 상태로, 자세한 진행은 사람이 터미널 탭에서 본다(req-1454).
5. 화면: snapshot을 읽고 bus를 받는다. 바뀜 알림이 오면 그 대상만 다시 읽는다.

## 7. 꺼졌다 켜질 때

- bus와 Gateway 구독은 사라진다. 화면은 다시 붙어 snapshot부터 읽는다.
- Reactor는 cursor 뒤의 fact부터 이어 반응한다. 반응은 idempotent라 두 번 일어나지 않는다.
- 돌던 lophn agent turn은 다시 켤 때 interrupted로 닫는다.
- coding agent는 adapter가 새 신호를 받기 전까지 unknown이다.
- coding agent session이 끝나면 token을 회수하고 그 session의 claim도 반납한다. 완료 보고 없이 끝났으면 그 사실이 fact로 남아 App Engineer에게 간다(req-1101).
- lophn이 꺼지면 터미널 탭의 coding agent process도 끝나 그 session이 끝난다. 그 session에 넣으려고 기다리던 입력은 버려지고, App Engineer는 "보고 없는 session 끝" fact로 안다.

## 8. 주인과 저장 (기록 모델)

| 사실 | 주인 | 다른 곳은 |
|---|---|---|
| 대화(message, tool call과 결과) | agent session 기록 | ID로 가리킨다 |
| coding agent의 대화 | 그 harness | 외부 session ID만 잇는다 |
| domain 상태 | 각 domain 표 | 읽는다 |
| 반응할 사실 | ledger | seq로 가리킨다(입력의 근거) |
| 앱 호출 기록(invocation) | apps. 쓰기, 외부 효과, 실패한 읽기, 앱 시작을 남기고 성공한 일반 읽기는 남기지 않는다(req-0893) | tool call 기록은 invocation ID를 가리킨다. write invocation에는 core가 남긴 changeset이 붙고, rewind는 시점 단위로 그것을 반대로 적용한다(`approval.md` 5장) |
| 앱 log | app-runtime. 앱마다 최근 일정 양 | invocation에 묶인 log는 그 invocation에서 읽는다(req-0940) |

## 9. 일부러 하지 않는 것

- 모든 domain 변경을 event type으로 만들기, 이력과 사후 감사.
- agent event의 저장과 replay.
- ledger를 화면이나 외부 구독자가 읽는 것.
- 반응 rule engine.
- lophn 사용자에게 hook을 여는 것.
- subagent event, model 호출 event.
- 앱이 자기 업무 사실을 lophn에 알리는 길(push). 필요해지면 따로 정한다. 당분간 Operator는 `interval` automation이나 read app-api로 읽는다.

## 10. 비워 둔 자리

- ~~Reactor handler와 approval~~: `approval.md`가 채웠다. handler는 intent를 만들어 Gate에 넣고, fact로 session을 여는 것은 reaction grant가 정한다.
- place 모델(Assignment), rewind(Revert).

## 11. 지금 코드와 달라지는 것 (리팩터링 session 몫)

- Bus를 새로 둔다. Gateway가 ledger 대신 bus를 받는다.
- ledger에는 fact만 쓴다. event type 약 150개가 fact 10개 안팎으로 준다. 지운 개념의 type(`Document*`, `Series*`, `Snapshot*` 등)과 agent 일생 type(`Run*`, `ToolCall*`, `ModelCall*`, `Message*`, `Session*`의 일생)은 ledger에서 빠진다.
- command 층이 바꾸는 대상을 선언하고 바뀜 알림을 자동으로 낸다.
- run 출처에 program(근거 fact)을 더한다.
- rewind가 tool call 기록 대신 invocation의 영수증을 읽는다(`packages/lophn-agent/revert/app-revert.ts`는 agent track).
