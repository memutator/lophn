# agent call 아키텍처 (2026-10-14)

사람(원문 그대로): "lophn agent protocol을 별도로 추상화를 해야할까 왜냐하면 장기적으로 봤을 때 void 처럼 그냥 부르기만 하고 끝내는거나 현재 열려 있는 세션(agent)에만 보내는거나 서로 협력하는 거나 비동기로 호출한다거나 그런 식으로 진짜 약간 프로그래밍 함수처럼 그런 것들이 필요할 것 같거든?" → "그리고 그 protocol 에서의 event, approval은 기존 모양대로 가고 그러면 좀 깔끔하겠지?" → "ㄱㄱ" → "app engineer <-> coding agent도 이 프로토콜을 쓰면 되겠는데? 물론 완전 막 같을 수는 없을 거 같기는 한데"

상태: 사람 확인(2026-10-14). 13장의 정한 것을 따른다.

> **옮겨 감 (2026-10-15):** 이 문서는 `../specs/agent-call.md`(S3)로 옮겨 갔다. 그 뒤 바뀐 것: `sent` 상태를 뺀다(Router가 행 만들기와 입력 넣기를 한 번에 한다). 봉투의 `open`(여는 방식) 칸을 빼고 나중으로 둔다. decline tool과 `declined` 상태를 뺀다(맡지 않을 때도 reply로 이유를 보낸다). close tool은 lophn agent끼리의 conversation과 함께 나중으로 옮긴다. 이 문서와 S3가 다르면 S3를 따른다.

재료: `../research/agent-call-a2a.md`(A2A v1.0.0), `../research/agent-call-frameworks.md`(OpenAI Agents SDK, LangGraph, AutoGen, CrewAI, Hermes, Claude Code), `../research/agent-call-actors.md`(Erlang/OTP, Akka, Orleans, EIP, Temporal), `event.md`, `approval.md`, `../../products/AGENT-ROLE.md`, 지금 코드(`packages/core/lophn-agent/tools/handoff`).

## 1. 한 줄

agent 사이의 모든 부름은 **call** 하나의 모양이다. call은 Router로 받는 session에 입력을 넣는 것이고, 받는 곳, 여는 방식, 답 방식은 봉투의 칸으로 고른다. 보낸 쪽은 기다리며 막히지 않는다.

## 2. 축 넷

| 축 | 값 | 선례 |
|---|---|---|
| 받는 곳 | **새 session**(role과 place로 고른다) / **열린 session**(session ID) / **열린 session, 없으면 새 session**(놓치면 안 되는 것만) / **끝난 session**(session ID로 되살려 보냄, 나중) | A2A의 id 없음·`taskId`, Erlang `spawn`과 pid, Claude subagent resume, harness의 `--resume` |
| 여는 방식 | **tab**(shell의 session 탭) / **tui**(터미널 탭의 TUI) / **headless**(화면 없이 뒤에서). 새 session이나 끝난 session을 열 때만 고른다 | Hermes CLI·TUI·gateway, `claude -p`, `codex exec` |
| 답 | **없음**(cast) / **결과 하나**(call) / **대화**(둘 중 하나가 닫을 때까지 주고받음) | AutoGen `publish_message`·`send_message`, Erlang `cast`·`call`, Akka `ignoreRef`, A2A `INPUT_REQUIRED` |
| 보낸 쪽 | 늘 막히지 않는다. 답은 보낸 session의 새 입력으로 온다 | Akka `ask`의 pipeToSelf, Hermes `completion_queue`, Claude cross-session messaging |

- **끝난 session**은 archive되었거나 멈춘 session을 그 대화 기록 그대로 되살려 입력을 넣는 것이다. 보내는 쪽이 이 값을 골랐을 때만 되살린다. 열린 session으로 보냈는데 닫혀 있으면 되살리지 않고 failed(`closed`)다. 지금은 두지 않고 자리만 둔다.
- **여는 방식**은 session을 어디에 보이게 띄우는지다. 답 방식이나 권한과는 따로다. 기본은 Settings에 두고, 맡기는 agent가 판단으로 바꾼다(req-1080의 실행 옵션과 같은 모양). 지금 lophn agent는 tab, coding agent는 tui로만 연다(req-1091). headless와 lophn agent의 tui는 나중에 lophn CLI가 생기면 쓴다.

- 동기 호출(보낸 turn이 결과를 기다림)은 두지 않는다. subagent이고, 분 단위 turn에는 맞지 않는다(Erlang `call` 5초, Orleans의 turn 점유).
- 새 session을 열지, 열린 session에 보낼지는 보내는 쪽이 고른다. "있으면 보내고 없으면 연다"를 기본으로 두지 않는다. session을 열 때마다 token이 들기 때문이다(Orleans virtual actor를 그대로 쓰지 않는 이유).
- **열린 session, 없으면 새 session**은 보내는 쪽이 명시적으로 고를 때만 쓴다. 맡긴 session에 돌아가야 하지만 버려지면 안 되는 사실이 그 경우다. 예: coding agent의 완료 보고, claim 만료, 보고 없는 session 끝을 Reactor가 맡긴 App Engineer에게 보낼 때, 그 session이 닫혀 있으면 그 앱의 App Engineer 새 session으로 보낸다.

## 3. 봉투

| 칸 | 뜻 |
|---|---|
| `call` | call ID. Router가 만든다 |
| `from` | 보낸 쪽: 사람, program(근거 domain event seq), agent session |
| `to` | 새 session이면 role과 place, 열린 session이나 끝난 session이면 session ID, "열린 session, 없으면 새 session"이면 둘 다 |
| `open` | 새 session이나 끝난 session을 열 때: `tab`, `tui`, `headless`. 비우면 Settings 기본 |
| `reply` | `none`, `result`, `conversation` |
| `body` | 맡기는 글 |
| `refs` | 근거 링크: ticket, problem, 파일 경로, 보낸 session |
| `reply_to` | 답이나 대화 메시지일 때, 어느 call에 대한 것인지 |
| `dedup` | 보낸 쪽 tool call ID. 같은 요청을 다시 보내도 call이 하나만 생긴다 |

- 보낸 쪽의 대화 원문은 넘기지 않는다. `body`와 `refs`만 간다(OpenAI handoff의 history 전달을 쓰지 않는 이유).
- 받는 이름은 정확히 맞아야 한다. 비슷한 이름으로 짐작하지 않는다(CrewAI fuzzy 매칭을 쓰지 않는 이유).

## 4. call의 상태

```
sent ──▶ accepted ──▶ done        (결과를 받음, 또는 대화가 닫힘)
  │          ├──────▶ declined    (받은 agent가 맡지 않겠다고 함, 이유와 함께)
  │          ├──────▶ failed      (받은 session이 결과 없이 끝남)
  │          └──────▶ cancelled   (보낸 쪽이나 사람이 취소)
  └──────────────────▶ failed     (배달 실패: not_found, not_allowed, closed)
```

- 끝난 call은 다시 열지 않는다. 이어지는 일은 새 call이다(A2A task immutability).
- 실패는 조용히 버리지 않는다. 이유(`not_found`, `not_allowed`, `closed`, `receiver_ended`)를 붙여 보낸 session에 새 입력으로 돌려준다(Akka dead letter를 쓰지 않는 이유, Erlang monitor `DOWN`처럼).
- `reply: none`인 call도 배달 실패는 돌려준다. 결과만 돌려주지 않는다.
- timeout은 두지 않는다. "아직 일하는 중인지"는 받은 session의 상태(running, waiting, idle)로 본다.
- 배달은 한 번까지다. 자동 재시도는 하지 않는다. 입력 하나가 turn 하나, 곧 token이기 때문이다.
- harness session(coding agent)의 실패와 결과는 예외다. 완료 보고, claim 만료, 보고 없는 session 끝은 domain event → Reactor 한 길로만 App Engineer에게 가고, 그 handler가 call 상태도 함께 닫는다. 같은 사실이 Router의 실패 알림으로 한 번 더 가지 않는다(`event.md` 6장 4).

**상태를 두는 곳:** call 표(`agent_calls`) 하나를 domain 상태로 둔다. 칸은 call, from, 받는 session, reply, 상태, dedup, 시각이다. 행은 agent가 보낸 call과 답을 기다리는 call(result, conversation)에만 생긴다. 사람의 메시지는 봉투만 쓰고 행을 두지 않는다. program의 reaction은 중복을 Reactor의 idempotency(domain event seq)가 막으므로, 답을 기다리지 않으면 행을 두지 않는다. 표가 있어야 꺼졌다 켜진 뒤 늦게 온 답의 짝을 찾고, 같은 요청을 두 번 만들지 않는다. 내용(`body`)은 받는 session 기록에 있다. 화면은 call을 대화 안에서 보이고, 사람이 누를 때 이 표를 읽어 그때의 상태를 보인다(req-1506, `../specs/event.md` 8장). 상태가 바뀔 때 따로 알리지 않는다. ledger에는 쓰지 않는다.

## 5. 답 방식별 흐름

**none (cast)**
1. 보낸 agent가 call tool을 부른다. tool은 call ID를 바로 돌려주고 turn은 이어진다.
2. Router가 받는 곳을 고르고, 보낸 쪽의 grant로 Gate를 거쳐 받는 session에 입력을 넣는다(accepted). grant는 보낸 쪽마다 다르다: agent는 agent grant(Router에서), program은 reaction grant(Reactor handler에서, Router에 오기 전), 사람은 Gate가 없다. 열린 session으로 보낼 때도 그 session의 agent로 판정한다.
3. 받은 agent가 일한다. 보낸 쪽에는 아무것도 돌아가지 않는다. call은 accepted에서 바로 done이 된다.

**result (call)**
1~2는 같다.
3. 받은 agent가 끝나면 reply tool로 결과를 보낸다(`reply_to` = call). Router가 보낸 session에 새 입력으로 넣는다. call은 done이다.
4. 받은 agent가 맡지 않으면 decline tool로 이유를 보낸다. call은 declined이고 이유가 보낸 session에 간다.
- 결과는 받은 agent가 직접 보내야 한다. lophn agent session은 저절로 끝나지 않아 program이 끝을 모르기 때문이다.

**conversation**
1~2는 같다.
3. 양쪽 모두 reply tool로 메시지를 보낼 수 있다. 각 메시지는 상대 session의 새 입력이 된다.
4. 한쪽이 close tool로 닫는다(마지막 결과를 붙일 수 있다). call은 done이다.
5. 닫힌 call에 온 메시지는 `closed` 이유와 함께 보낸 쪽에 돌아간다(Hermes `missed_steer`처럼 조용히 버리지 않는다).

**받는 session이 돌고 있을 때:** 입력은 기다렸다가 다음 turn에 들어간다. 사람의 메시지와 같은 줄이다.

**취소:** 보낸 쪽이나 사람이 call을 취소하면 call은 cancelled가 되고, 받은 session에 취소 입력이 간다. 받은 agent는 정리하거나 무시한다. 그 뒤 그 call에 온 답은 `closed`로 돌아간다(Temporal처럼 요청으로서의 취소).

**한쪽 session이 끝날 때:**
- 받은 session이 archive되거나 지워지면 열린 call은 failed(`receiver_ended`)가 되고 보낸 쪽에 알린다.
- 보낸 session이 없어지면 답은 받은 session에만 남는다.

## 6. 받는 곳 고르기

- `to`가 새 session이면, Router가 role과 place로 받을 agent 하나를 고른다(`../../products/AGENT-ROLE.md` 5.2의 표). 고른 agent가 없으면 failed(`not_found`)다.
- `to`가 열린 session이면 그 session ID로 바로 보낸다. 닫혔으면 failed(`closed`)다.
- `to`가 "열린 session, 없으면 새 session"이면, 그 session이 열려 있으면 거기로, 닫혔으면 같은 role과 place의 새 session을 열어 보낸다.
- `to`가 끝난 session이면(나중) 그 session을 기록 그대로 `open` 방식으로 되살려 보낸다. session이 지워졌으면 failed(`not_found`)다.
  - 되살리면 `SessionStarted`를 다시 내고 되살림을 적는다. session 허락과 대기 중이던 권한 요청은 돌아오지 않는다(req-0319).
  - coding agent session을 되살리면 token과 claim은 새로 받는다. 끝난 call은 다시 열지 않으므로 새 call이다. ticket은 같다.

**여는 방식에 따라 달라지는 것**
- 여는 방식의 뜻은 transport마다 다르다. lophn agent는 어느 방식이든 core의 run-loop에서 돌고, tab, tui, headless는 어느 화면이 붙느냐일 뿐이다(Gateway의 snapshot과 bus는 어느 client든 같다). coding agent는 띄우는 방식과 신호를 받는 길이 바뀐다.
- tab과 tui는 사람이 그 session을 보고 끼어들 수 있다. headless는 화면이 없다. 사람은 session 목록에서 보고, 필요하면 tab이나 tui로 다시 열어 본다.
- headless session에서 "물음"이 나와도 lophn agent의 request는 toast와 모든 session의 대기 목록으로 보이니 사람이 거기서 답한다(`approval.md` 4장). coding agent의 harness 권한 물음은 TUI에서만 답할 수 있어서, headless로 띄울 때는 미리 허락 모드로 띄운다(정할 것 5).
- coding agent의 신호는 tui면 hook으로, headless면 harness의 JSON stream으로 받는다. 둘 다 adapter가 같은 agent event로 바꾼다. headless는 session 동안 process가 살아 있는 streaming 모드(`claude -p --input-format stream-json`, `codex app-server` 등)로만 띄운다. turn마다 process가 끝나는 비대화 실행(`claude -p` 한 번, `codex exec`)은 쓰지 않는다. process 종료를 session 끝으로 보아 claim 반납과 "보고 없는 끝"이 turn마다 잘못 돌기 때문이다(`event.md` 7장). streaming 모드가 없는 harness는 headless로 열지 않는다.

## 7. 두 층: protocol과 transport

위의 봉투, 축, 상태, 받는 곳 고르기는 모두가 같이 쓴다. 배달하는 길만 transport마다 다르다.

| | lophn session | harness session(coding agent) |
|---|---|---|
| 새 session 열기 | run-loop가 새 session을 연다. 여는 방식은 붙는 화면일 뿐이다. tab(지금), tui와 headless는 lophn CLI가 생기면 | harness adapter가 띄우고 첫 prompt(ticket)를 넣는다. tui는 터미널 탭(지금, req-1091), headless는 streaming 모드(나중) |
| 끝난 session 되살리기(나중) | session 기록을 읽어 run-loop가 이어 간다 | harness의 resume(`claude --resume`, `codex resume` 등) |
| 입력 넣기 | run-loop 입력함 | tui는 PTY, headless는 stream 입력. idle일 때만 넣는다. 기다리던 입력은 lophn이 꺼지면 session과 함께 버려지고, App Engineer는 "보고 없는 session 끝" fact로 안다 |
| 답 받기 | reply, decline, close tool | CLI: 완료 보고(결과), 메시지(대화)(req-1216, 1491) |
| 끝을 알기 | 받은 agent가 보고해야 안다 | hook과 process 종료로도 안다. 완료 보고, claim 만료, 보고 없는 끝은 domain event → Reactor 한 길로 App Engineer에게 가고, 그 handler가 call을 닫는다 |
| 권한 | 받은 agent의 grant(Gate) | harness 자기 권한과 coding token 범위(req-1052) |
| call ID | Router가 만든다 | ticket과 그 claim이 call에 묶인다 |

App Engineer ↔ coding agent는 이 protocol의 conversation 모양이다. 맡기기(새 session, conversation) → 메시지를 주고받음 → 완료 보고로 닫힘. 완료 보고는 ticket 상태도 바꾸고 fact로 남는다. 검증이 이어져야 하고 꺼졌다 켜져도 남아야 하기 때문이다(event.md 5장).

나중에 다른 종류의 agent(예: 원격 A2A agent)가 붙으면 transport 하나를 더한다.

## 8. event와 approval에 얹히는 곳

**event** (`event.md`): 새 통로가 없다.
- call 배달과 답은 모두 Router 입력이다. 받는 session에서는 agent event `MessageReceived`로 보이고 봉투가 입력에 붙는다.
- program의 reaction도 call이다: `from` = program(근거 domain event seq), `to` = 새 session, `reply` = none.
- 사람의 메시지도 같은 봉투를 쓴다: `from` = 사람, `to` = 열린 session이나 새 session, `reply` = none. `agent_calls`에 행은 두지 않는다.
- 맡긴 session에 돌아가야 하는 domain event(coding agent의 완료 보고 등)는 Reactor가 "열린 session, 없으면 새 session"으로 보낸다.
- call은 대화라 ledger에 쓰지 않는다. 예외는 domain 사실이 함께 생기는 경우다(ticket의 완료 보고).

**approval** (`approval.md`): 새 종류가 없다.
- 다른 agent를 부르는 것은 Gate의 대상 하나다. 대상은 agent, 효과는 read, agent grant의 기본은 묻지 않음이다(req-1493).
- 사람이 물음으로 바꿔 두었으면 turn gate 길을 탄다.
- 받은 agent는 자기 grant로만 일한다. 받은 메시지는 허락이 아니다. program이 지키는 것은 이것 하나다.
- "보낸 쪽이 거절당한 일을 다른 agent에게 돌려 시키지 않는다"는 agent 지침에 둘 규칙이다. 같은 결과를 노린 요청인지는 의미 판단이라 program이 결정적으로 막을 수 없다.

## 9. 말 정리

| 지금 쓰는 말 | 이 protocol에서 |
|---|---|
| handoff(넘기고 끝) | call: 새 session, `reply: none` |
| escalate(맡기고 결과 받음) | call: 새 session, `reply: result` |
| App Engineer가 coding agent에게 ticket을 맡김 | call: 새 harness session, `reply: conversation` |
| coding agent의 메시지(req-1491) | 그 conversation 안의 메시지 |
| program의 reaction | call: program이 보냄, `reply: none` |
| 사람에게 올림 | call이 아니다. 사람은 session이 아니다. session 안에서 묻는다. **escalate는 이 뜻으로만 쓴다** |

## 10. MVP와 나중

| | MVP | 나중 |
|---|---|---|
| 받는 곳 | 새 session, 열린 session | 끝난 session 되살리기 |
| 여는 방식 | lophn agent는 tab, coding agent는 tui | headless, lophn agent의 tui(lophn CLI) |
| 답 | none, result. conversation은 App Engineer ↔ coding agent에서 | lophn agent끼리의 conversation |
| transport | lophn session, harness session | 원격 agent |
| 그 밖 | 취소, dedup, 실패 이유 | 만료 시각, 대화 길이 상한 |

## 11. 일부러 하지 않는 것

- 동기 호출, subagent, 기본 timeout.
- "있으면 보내고 없으면 연다"를 기본으로 두는 것.
- 조용히 버리기(dead letter), 자동 재시도.
- 보낸 쪽 대화 원문 넘기기, 이름 짐작.
- 병렬로 넘긴 것 가운데 하나만 실행하기(OpenAI, AutoGen). 여러 call은 각각 독립이다.
- Hermes의 durable queue, stall 감시, orphan 회수를 한꺼번에 만드는 것.

## 12. 지금 코드와 달라지는 것 (리팩터링 session 몫)

- `packages/core/lophn-agent/tools/handoff`와 `packages/protocol/lophn-agent/handoffs.ts`: 고정 방향 표(Operator 금지), 칸 넷(무엇, 왜, 제외, 기대 결과), 문서 고정 판 근거, 사람 요청에서 이어진 run만, run 단위 → call 봉투, grant 판정, session 단위로 바꾼다. dedup은 살린다.
- `agent_calls` 표, call·reply·decline·close·cancel tool을 새로 둔다.
- coding agent 쪽은 ticket·claim·완료 보고·CLI 메시지를 call 상태에 잇는다.

## 13. 정한 것 (2026-10-14, 사람: "ㄱㄱ")

1. ~~`declined`를 따로 둔다. 받은 agent가 "내 일이 아니다"라고 이유와 함께 돌려준다(req-1502).~~ 뒤집힘(2026-10-15, S3 11장 4): declined를 두지 않고 reply로 이유를 보낸다.
2. call 표(`agent_calls`)를 둔다. 늦게 온 답의 짝 찾기, dedup, 화면의 call 상태를 위해서다.
3. lophn agent끼리의 conversation은 나중이다. 지금은 App Engineer ↔ coding agent만.
4. handoff·escalate를 call의 말로 바꾼다. escalate는 사람에게 올리는 것에만 쓴다. req-1490과 `products/AGENT-ROLE.md`를 고쳤다.
5. headless coding agent의 harness 권한 물음은 headless를 실제로 열 때 정한다. 그때 기본은 미리 허락 모드다.

요구: req-1490(고침), req-1499~1505(agent-sessions), req-1506(shell).
