# S3. agent call

상태: **확인됨** (2026-10-15). 설계는 `../architecture/agent-call.md`(사람 확인)에서 왔다. 11장은 이 spec을 쓰며 다시 따져 사람 확인을 받은 것이다.

## 1. 범위

agent 사이의 모든 부름이 따르는 protocol이다. 봉투, 받는 곳, 답 방식, 상태, 그리고 그것을 배달하는 두 transport를 정한다. event의 길은 S1, grant 판정은 S2, harness transport의 자세한 것(띄우기, hook, token, CLI)은 S6, 받는 agent를 role과 place로 고르는 표는 `../../products/AGENT-ROLE.md` 5.2와 S8이 맡는다.

## 2. 한 줄

agent 사이의 모든 부름은 **call** 하나의 모양이다. call은 Router로 받는 session에 입력을 넣는 것이고, 받는 곳과 답 방식은 봉투의 칸으로 고른다. 보낸 쪽은 기다리며 막히지 않는다(req-1499).

| 지금 쓰던 말 | call로 |
|---|---|
| handoff(넘기고 끝) | 새 session, `reply: none` |
| escalate(맡기고 결과 받음) | 새 session, `reply: result` |
| App Engineer가 coding agent에게 ticket을 맡김 | 새 harness session, `reply: conversation` |
| coding agent의 메시지(req-1491) | 그 conversation 안의 메시지 |
| program의 reaction | program이 보냄, `reply: none` |
| 사람에게 올림 | call이 아니다. session 안에서 묻는다. escalate는 이 뜻으로만 쓴다 |

## 3. 봉투

| 칸 | 뜻 |
|---|---|
| `call` | call ID. Router가 만든다 |
| `from` | 보낸 쪽: 사람, program(근거 domain event seq), agent session |
| `to` | 새 session이면 role과 place, 열린 session이면 session ID, "열린 session, 없으면 새 session"이면 둘 다 |
| `reply` | `none`, `result`, `conversation` |
| `body` | 맡기는 글 |
| `refs` | 근거 링크: ticket, problem, 파일 경로, 보낸 session |
| `reply_to` | 답이나 대화 메시지일 때, 어느 call에 대한 것인지 |
| `dedup` | 보낸 쪽 tool call ID. run-loop의 tool 자동 재시도가 call을 두 번 만들지 않게 한다(11장 3) |

- 보낸 쪽의 대화 원문은 넘기지 않는다. `body`와 `refs`만 간다(req-1505).
- 받는 이름은 정확히 맞아야 한다. 비슷한 이름으로 짐작하지 않는다.

## 4. 받는 곳

| `to` | 하는 일 | 닫혀 있으면 |
|---|---|---|
| 새 session | Router가 role과 place로 받을 agent 하나를 고르고 새 session을 연다 | 해당 없음. 고를 agent가 없으면 failed(`not_found`) |
| 열린 session | 그 session ID에 입력을 넣는다 | 새로 열지 않고 failed(`closed`) |
| 열린 session, 없으면 새 session | 열려 있으면 거기, 닫혀 있으면 같은 role과 place의 새 session | 새 session을 연다 |

- 새 session을 열지 열린 session에 보낼지는 보내는 쪽이 고른다(req-1500). "있으면 보내고 없으면 연다"를 기본으로 두지 않는다. session을 열 때마다 token이 든다.
- "열린 session, 없으면 새 session"은 보내는 쪽이 명시적으로 고를 때만 쓴다. 맡긴 session에 돌아가야 하지만 버려지면 안 되는 것이 그 경우다. coding agent의 완료 보고, claim 만료, 보고 없는 끝(Reactor가 보냄, S1)과 coding agent의 메시지(CLI, req-1491)가 이 값으로 맡긴 App Engineer에게 간다.
- 받는 session이 돌고 있으면 call과 답은 기다렸다가 다음 turn에 들어간다. 사람의 메시지도 기본은 같고, 사람만 steer를 골라 도는 turn의 다음 model 요청 앞에 넣을 수 있다(req-1509). call에는 steer가 없다(9장).
- 한 session의 입력함에 사람 메시지와 call·답이 함께 쌓이면 사람 메시지가 먼저다(2026-10-15 결정).
- 앱 줄에 서 있던 coding agent 맡기기는 메모리에 있다. lophn이 꺼졌다 켜지면 그 call은 failed(이유: lophn 재시작)로 보낸 쪽에 돌아간다. 조용히 버리지 않는다(2026-10-15 결정).

## 5. 답 방식과 상태

```
accepted ──▶ done        (답을 받음, 완료 보고로 대화가 닫힘, 또는 reply: none)
    ├──────▶ failed      (받은 session이 답 없이 끝남: receiver_ended)
    └──────▶ cancelled   (보낸 쪽이나 사람이 취소)
failed (배달 실패: not_found, not_allowed, closed) ── Router에서 바로
```

| `reply` | 흐름 |
|---|---|
| `none` | 받는 session에 입력이 들어가면 accepted이고 곧 done이다. 결과는 돌아가지 않는다. 배달 실패는 돌아간다 |
| `result` | 받은 agent가 끝나면 reply tool로 답을 보낸다(done). 맡지 않을 때도 reply로 이유를 보낸다. lophn agent session은 저절로 끝나지 않아 program이 끝을 모르므로 답은 받은 agent가 직접 보내야 한다 |
| `conversation` | 지금은 App Engineer ↔ coding agent만 쓴다. App Engineer는 reply tool로, coding agent는 CLI 메시지로 주고받는다. coding agent의 완료 보고로 닫힌다(done, 7장). App Engineer가 먼저 멈추게 하려면 cancel이다 |

- 실패는 조용히 버리지 않는다. 이유를 붙여 보낸 session에 새 입력으로 돌려준다(req-1501).
- 받는 곳이 coding agent이고 그 앱에 coding session이 이미 돌면, Router가 맡기기를 그 앱의 줄에 세우고 call은 accepted로 기다린다. 앞 session이 끝나면 다음 것을 연다(S6, req-1516). 받는 session이 돌 때 입력이 다음 turn을 기다리는 것과 같은 생각이다.
- 끝난 call은 다시 열지 않는다. 이어지는 일은 새 call이다.
- 닫힌 call에 늦게 온 답이나 메시지는 늦게 보낸 쪽(받은 agent)에 reply tool의 결과로 `closed`와 함께 돌아간다(req-1503).
- 취소하면 받은 session에 취소 입력이 간다. 받은 agent는 정리하거나 무시한다(req-1503).
- 받은 session이 archive되거나 지워지면 열린 call은 failed(`receiver_ended`)다. 보낸 session이 없어지면 답은 받은 session에만 남는다.
- timeout과 자동 재시도는 없다. 일하는 중인지는 받은 session의 상태로 본다. 입력 하나가 turn 하나, 곧 token이다.

**상태를 두는 곳:** `agent_calls` 표. 칸은 call, from, 받는 곳(`to`의 role과 place, 또는 session), 받는 session, reply, 상태, 실패 이유, dedup, 시각이다. 행은 agent가 보낸 call에만 생긴다. 사람의 메시지는 봉투만 쓰고, program의 reaction은 Reactor의 idempotency(domain event seq)가 중복을 막으므로 행을 두지 않는다. 표는 꺼졌다 켜진 뒤 늦게 온 답의 짝 찾기와, 화면에서 call을 누를 때 그때의 상태 읽기(req-1506)에 쓴다. 내용(`body`)은 받는 session 기록에 있다. Ledger에는 쓰지 않는다.

**화면:** call은 대화 안에서 보인다. 받은 session의 메시지에 보낸 쪽 chip이 붙고, 보낸 session에는 call tool 블록과 그 call에 이어진 답 메시지가 남는다. 누르면 읽는다. 상태가 바뀔 때 따로 알리지 않는다(S1 8장).

## 6. grant

- 다른 agent를 부르는 것은 Gate의 대상 하나다. 대상은 agent, 효과는 read, agent grant의 기본은 묻지 않음이다(S2). 열린 session으로 보내도 그 session의 agent로 판정한다. grant 밖이면 failed(`not_allowed`).
- 보낸 쪽마다 보는 grant가 다르다: agent는 agent grant(Router에서), program은 reaction grant(Reactor handler에서, Router에 오기 전), 사람은 Gate가 없다.
- 받은 agent는 자기 grant로만 일한다. 받은 메시지는 허락이 아니다. program이 지키는 것은 이것 하나다.
- "거절당한 일을 다른 agent에게 돌려 시키지 않는다"는 agent 지침의 규칙이다(S4). 같은 결과를 노린 요청인지는 의미 판단이라 program이 막을 수 없다.

## 7. 두 transport

봉투, 받는 곳, 상태는 모두가 같이 쓴다. 배달하는 길만 다르다.

| | lophn session | harness session(coding agent) |
|---|---|---|
| 새 session 열기 | run-loop가 새 session을 연다. shell의 session 목록에 뜬다(S1) | harness adapter가 터미널 탭에 TUI로 띄우고 첫 prompt(ticket)를 넣는다(S6) |
| 입력 넣기 | run-loop 입력함 | PTY. idle일 때만 넣는다. lophn이 꺼지면 기다리던 입력은 session과 함께 버려진다 |
| 답 받기 | reply tool | CLI: 완료 보고(결과), 메시지(대화)(req-1216, 1491) |
| 끝을 알기 | 받은 agent가 reply로 답해야 안다 | hook과 process 종료로도 안다. 완료 보고, claim 만료, 보고 없는 끝은 domain event → Reactor 한 길로 App Engineer에게 가고 그 handler가 call을 닫는다. 같은 사실이 Router의 실패 알림으로 한 번 더 가지 않는다 |
| 권한 | 받은 agent의 grant(Gate) | harness 자기 권한과 coding token 범위(S6) |
| call과 묶이는 것 | session | ticket과 그 claim |

App Engineer ↔ coding agent는 conversation이다. 맡기기(새 harness session) → 메시지를 주고받음 → 완료 보고로 닫힘. 완료 보고는 ticket 상태도 바꾸고 domain event로 남는다. 검증이 이어져야 하고 꺼졌다 켜져도 남아야 하기 때문이다.

## 8. tool

lophn agent가 call을 다루는 tool이다. 입력 schema는 S4 3장에 있다.

| tool | 하는 일 |
|---|---|
| call | 봉투를 만들어 Router에 넣고 call ID를 바로 돌려준다 |
| reply | `reply_to`에 답이나 대화 메시지를 보낸다 |
| cancel | 자기가 보낸 끝나지 않은 call을 취소한다 |

- 맡지 않을 때도 reply로 이유를 보낸다. 따로 tool이나 상태를 두지 않는다(11장 4). 이 규칙은 agent 지침(S4)에 둔다.
- 대화를 닫는 tool은 lophn agent끼리의 conversation과 함께 나중에 둔다(11장 5).

## 9. 나중

| | 지금 | 나중 |
|---|---|---|
| 받는 곳 | 새 session, 열린 session, 열린 session·없으면 새 session | 끝난 session 되살리기(기록 그대로 이어 열기. 되살리면 `SessionStarted`를 다시 내고, session 허락과 대기 request는 돌아오지 않는다) |
| 여는 방식 | lophn agent는 shell, coding agent는 터미널 탭 TUI | headless(streaming 모드로만), lophn CLI가 생기면 lophn agent의 tui |
| 답 | none, result. conversation은 App Engineer ↔ coding agent | lophn agent끼리의 conversation과 그것을 닫는 close tool |
| transport | lophn session, harness session | 원격 agent |
| 도는 turn에 넣기 | 없음. call과 답은 다음 turn | 보내는 쪽이 고르는 steer option. 지금은 부르는 쪽이 없다. 생각을 바꾸면 cancel하고 다시 call한다 |

## 10. 지울 옛 것과 하지 않는 것

**지울 옛 것**
- `packages/core/lophn-agent/tools/handoff`와 `packages/protocol/lophn-agent/handoffs.ts`: 고정 방향 표(Operator 금지), 칸 넷(무엇, 왜, 제외, 기대 결과), 문서 고정 판 근거, 사람 요청에서 이어진 run만, run 단위 → call 봉투, grant 판정, session 단위.
- `agent_calls` 표와 8장의 tool을 새로 둔다. coding agent 쪽은 ticket, claim, 완료 보고, CLI 메시지를 call 상태에 잇는다.

**하지 않는 것**
- 동기 호출, subagent, 기본 timeout.
- "있으면 보내고 없으면 연다"를 기본으로 두기.
- 조용히 버리기, 자동 재시도.
- 보낸 쪽 대화 원문 넘기기, 이름 짐작.
- 병렬로 넘긴 것 가운데 하나만 실행하기. 여러 call은 각각 독립이다.
- durable queue, stall 감시, orphan 회수를 한꺼번에 만들기.

## 11. 다시 따진 것

1. 확인함(사람 "ㄱㄱ", 2026-10-15): **`sent` 상태를 뺀다.** 설계 문서는 `sent → accepted`를 두었다. 그런데 Router는 call 행을 만들고 받는 session에 입력을 넣는 것을 한 번에 한다. 배달 실패는 그 자리에서 failed가 된다. 받는 session이 돌고 있어 입력이 다음 turn을 기다리는 것도 이미 받은 것(accepted)이다. agent grant가 물음이면 call이 만들어지기 전에 보낸 쪽 turn이 허락을 기다린다(S2). 그래서 `sent`인 채로 머무는 때가 없다.
2. 확인함(같은 때): **봉투에서 `open`(여는 방식) 칸을 뺀다.** 설계 문서는 `open: tab, tui, headless`를 두었다. 지금은 lophn agent는 shell로만, coding agent는 TUI로만 열려서 값이 transport마다 하나뿐이다. 9장 "나중"에 축으로 남기고, headless나 lophn CLI가 생길 때 칸을 더한다. MVP 이전이라 나중에 더해도 호환 부담이 없다. coding agent를 띄우는 실행 옵션(harness, model)은 봉투가 아니라 S6이 다룬다(req-1080).
3. 확인함: **`dedup`은 남긴다.** run-loop에는 tool 자동 재시도가 있다(`packages/core/lophn-agent/run-loop/retry.ts`). 읽기 tool과 중복 효과가 없다고 보장된 쓰기 tool은 일시 실패 뒤 같은 tool call로 한 번 더 부른다. call은 Gate에서 read라 이 재시도 대상이고, 첫 시도가 실제로는 call을 만들고 실패로 돌아오면 재시도가 call과 session을 하나 더 만든다. `dedup`(tool call ID)이 이것을 막는다(req-1504).
4. 확인함(사람 "ㄱㄱ", 2026-10-15): **decline tool과 `declined` 상태를 뺀다.** 설계 문서 13장 1을 뒤집는다. declined와 done을 나눠서 program이 다르게 하는 일이 없다. 보낸 쪽은 어느 쪽이든 받은 agent의 글을 새 입력으로 받고, 그것이 "맡지 않겠다"인지 읽는 것은 보낸 agent의 의미 판단이다. 이 상태로 움직이는 Reactor handler나 domain event도 없다. 화면에서도 답 메시지가 그 call에 이어 보이므로(req-1506) 상태 글자는 같은 것을 한 번 더 보일 뿐이다. coding agent의 CLI에도 거절이 없다. req-1502와 req-1506을 고쳤다.
5. 확인함(같은 때): **close tool을 나중으로 옮긴다.** 지금 conversation은 App Engineer ↔ coding agent뿐이다. coding agent는 lophn tool이 아니라 CLI 완료 보고로 끝내고 Reactor가 call을 닫는다. App Engineer가 먼저 멈추게 하는 것은 cancel이다. 지금 부르는 쪽이 없고 요구도 없다. 그래서 tool은 call, reply, cancel 셋이다.
6. 확인함(사람 "ㄱㄱ", 2026-10-15): **도는 turn에 오는 입력.** 조사(`../research/non-human-input.md`)에서 harness 대부분은 도는 turn을 끊지 않고 다음 model 요청 앞에 붙였다. 사람 메시지는 기본으로 쌓아 두었다가 다음 turn에 넣고, 사람이 steer를 고르면 도는 turn에 넣는다(req-1509). call, 답, 알림은 다음 turn에 넣는다. call의 steer option은 부르는 쪽이 없어 나중이다(9장).
