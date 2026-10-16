# places-sessions-conversation

session 기록(대화)을 ledger event 없이 session 표에 쓰고 읽게 하고, 사람이 부르는 Compact를 새 규칙(같은 model이 요약하고 새 이력은 최신 판 prefix, 요약, 최근 사람 메시지 몇 개)으로 맞춘다. `correction`을 `steer`로 바꾸는 session 쪽 이름도 여기서 끝낸다.

- 단위: places-sessions (wave 3)
- 선행: places-sessions-session (`messages` 표의 새 열과 `AgentSessionRow`를 쓴다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/{compact,compactor,message-body,body-read,history,answer-links,session-title}.ts`
- 읽을 것:
  - spec: S4 6장 "compact"(같은 model, 최신 판 prefix + 요약 + 최근 사람 메시지) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S1 3·6·11·12장(대화는 session 기록, agent event는 메모리, ledger에 쓰지 않는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I2.4#31`, `I2.8#12`
  - 요구: req-0361(compact) — `/home/pyosechang/projects/lophn/project-docs/requirements/core-lophn-agent.yaml`
  - 지금 코드: `session/{compact,compactor,history}.ts`, `prompt-assembly/{summary,compaction}.ts`(읽기만. agent-definition 소유)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/sessions.ts`의 compact input·route(모양이 그대로이므로 옛 것을 그대로 쓴다), `agent-sessions.ts`, `inputs.ts`의 `receivedEnvelopeSchema`, `core/events/ports.ts`(compact 시작·끝 agent event는 Bus). prompt-assembly가 내놓는 요약 규칙(`summary.ts`)과 prefix 재조립 함수.
  - 내놓는 것: 다른 단위가 기대는 새 export 없음. 옛 export는 이름을 바꾸지 않는다.

## 할 일

1. 대화 기록 저장 (`I2.8#12`):
   - 대화(message, tool call, model call, compact 경계)는 session 기록이다. 저장 모양은 문서에 정해진 것이 없다. 추천: 지금 표(`messages`, `tool_calls`, `model_calls`, `sessions`의 compaction 열)를 그대로 session 기록 표로 쓰고, 그 표에 쓰는 command들이 함께 쓰던 ledger event(`Message*`, `ToolCall*`, `ModelCall*`, `Session*`)를 걷어낸다(S1 12장). 이 선택을 보고 "정한 것"에 적는다.
   - 이 task는 `session/compact.ts`, `message-body.ts`, `history.ts`의 emit을 걷어낸다. `message-commands.ts`와 `run-loop/commands.ts`(router), `tools/commands.ts`(agent-tools), `session/commands.ts`(places-sessions-session)의 emit은 각자 걷는다.
   - 읽는 쪽(`history.ts`의 `readSessionConversation`, `body-read.ts`)이 ledger event를 읽고 있으면 표를 읽게 바꾼다. 본문은 지금처럼 blob이다.
2. Compact (`I2.4#31`):
   - 사람이 요청한다 → runtime이 요약 model call을 한다 → 끝까지 성공한 call을 구간과 함께 session에 이어 요청을 끝낸다. 이 세 걸음의 command는 그대로 둔다.
   - 바뀌는 것: 요약은 "같은 model에 요약 지시를 보내 요약을 받는다". Workspace의 "Model for summaries" 설정이 우선이고 비면 session agent의 model이다(그 설정이 이미 그렇다면 건드리지 않는다). 새 이력은 "최신 판으로 다시 만든 prefix + 요약 + 최근 사람 메시지 몇 개"이다. 옛 `SummaryParts` 여섯 부분 구조와 재축소(`COMPACT_RESHRINK_MAX`)가 지금 코드에 있으면 새 규칙에 필요 없는 만큼 걷어낸다. prefix 재조립은 prompt-assembly(agent-definition)의 함수를 부른다. 그 함수가 아직 없으면 compact가 쓰는 입구를 하나만 `compactor.ts`에 선언해 두고 보고한다.
   - compact 경계는 session 기록에 남긴다. `CompactStarted`·`CompactEnded` agent event는 Bus에 낸다(S1 6장).
   - 원문은 어느 경우에도 지우지 않는다(지금 규칙 그대로).
3. 이름 (`correction` → `steer`):
   - `session-title.ts`의 `titleOnReceive` 입력 `mode: "request" | "correction"`을 `delivery: "next_turn" | "steer"`로 바꾼다. steer 메시지는 제목을 정하지 않는다는 규칙은 그대로다.
4. test: 만들지 않는다. compact는 model이 끼는 부분이라 품질은 eval이 잰다. 결정적인 판정이 새로 생기지 않는다.

- (lead가 더함, places-sessions-session이 넘긴 것) `sessionCompactRequests`(`protocol/lophn-agent/sessions.ts`)의 출력이 아직 `assignment: asg…`·`work_place`다. 새 session에는 이것을 줄 수 없어 handler가 빈 목록을 돌려주고 compact가 막혀 있다. 출력을 `agent: agentRefOutputSchema`, `place: placeOutputSchema.nullable()`로 바꾸는 계약 고침을 lead에게 요청하고(이 task가 바꿔도 되는 한 줄 계약 고침이다. 보고에 적는다), `session/compactor.ts`의 `Request`와 assignment 읽기를 이 모양으로 바꿔 compact를 되살린다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "correction\|SessionCompact.*Event\|ledger event" packages/core/lophn-agent/session/{compact,compactor,message-body,body-read,history,answer-links,session-title}.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: ledger event를 읽던 helper, `SessionCompactRequested`·`SessionCompacted`·`SessionCompactFailed`의 ledger 쪽 쓰임(protocol 정의는 cleanup이 지운다)
- 정한 것: 대화 기록 표를 그대로 두는 것, compact 요약 구조를 줄인 정도, prefix 재조립 입구
- 계약 바꾸기 요청(wave 3): 없음

- (lead가 더함, agent-definition-models가 넘긴 것) `session/compactor.ts`의 `summaryChoice`가 handler가 없어진 `modelDefaultsRead`를 불러 null이 되고 compact가 멈춘다. `summaries` 읽기를 지우고 session model을 쓴다(spec: 같은 model). `session/compact.ts`의 `usesSummariesModel`이 지운 `agent_model_defaults` 표를 읽는다. 걷는다. 같은 file의 `summaryCall`이 `events`의 `ModelCallStarted`를 join한다. 이 event는 더 나가지 않으니 `model_calls.started_seq`로 바꾼다.
