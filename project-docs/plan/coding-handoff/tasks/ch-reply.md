# ch-reply

coding agent가 `lophn message send`로 물으면 App Engineer가 글로만 답해 터미널에 닿지 않는 bug를 (가)로 고친다. 봉투에 답하는 길 한 줄을 넣고, App Engineer 지침에 같은 길을 적고, `message send --help`에 refs 모양을 적는다. 근거는 `project-docs/issues/coding-agent.md`의 "coding agent의 message에 App Engineer가 글로만 답하면 터미널에 가지 않는다". calendar-mvp 첫 run은 App Engineer가 `to:{role:"coding_agent", place}`로 한 번 실패한 뒤 `to:{session}`으로 답해 끝났고, 저장되지 않은 calendar-diagnose run은 글로만 답해 `coding_inputs`가 비고 coding agent가 `Stop` 뒤 11분을 기다리다 lead가 멈췄다. App Engineer가 답할지 무엇을 답할지는 여전히 App Engineer가 정한다. core는 글을 대신 보내지 않는다.

- 단위: ch-reply (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/{input-text.ts,input-text_test.ts}`
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
  - `packages/coding-agent/cli/help.ts`
  - `packages/protocol/coding-agent/message.ts`
  - `project-docs/architecture/{coding-agent.md,agent-call.md}`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`(51행 받은 turn과 뒤 이력은 같은 함수, cache), `coding-agent.md`(25행 흐름도, 83행 "사람은 coding agent와 직접 이야기하지 않는다")
  - 코드: `packages/core/apps/tickets/coding/message.ts` `applyMessage`(coding agent가 보낸 입력의 유일한 출처. `close-call.ts`의 완료·claim 알림은 `from: program`의 reaction이라 `callText`를 타지 않는다)
- 계약:
  - 쓰는 것: `call` tool(`packages/core/lophn-agent/tools/bundles/call.ts`)의 `to:{session}`과 `reply:"conversation"`. 코드는 이미 참이다. `withCodingSessions.find`(`packages/core/main/daemon/wiring/router-registration.ts`)가 `coding_sessions` 표의 ended 아닌 session을 `transport:"harness"`로 찾고, Router `resolve`가 `open_session`으로 풀어 `transport.deliver`가 `CodingTransport.send`로 PTY에 넣는다. 고치지 않는다.
  - 내놓는 것: `callText`의 새 줄. 입력 종류가 아니라 `input.from.kind === "coding_agent"`로 정한다(이유: coding agent가 보낸 입력은 지금 message 하나뿐이고, `receivedText`가 이미 저장하는 `from`만으로 두 길이 같은 bytes를 만든다. `reply` 같은 새 칸을 봉투에 더하지 않는다).

## 할 일

1. `input-text.ts` `callText`: `"This was sent by another agent. …"` 줄 바로 뒤, `reply === "result"` 힌트 앞에 `input.from.kind === "coding_agent"`일 때 한 줄을 더한다. 꼴은 `Plain text does not reach its terminal. To answer, use call with to:{session:"<from.session>"} and reply:"conversation".` 정확한 문구는 정하되, `fromText`처럼 `from.session`을 그대로 넣고 한 줄이다. 상수 문구는 만들지 않고 `result` 힌트 옆에 같은 꼴로 둔다(근거: agent-call.md 51행).
2. `input-text_test.ts`의 "받은 turn의 입력과 뒤 turn의 history는 …" test(이미 `receivedText`와 `inputText` 같은 글을 본다)에 `from: {kind:"coding_agent", session}` 경우를 한 번 더 넣어 같은 글이고 session id가 들어 있음만 본다. 새 test를 만들지 않는다. 이 file 말고 봉투 bytes를 pin한 test는 없다(`grep -rn "This was sent by another agent\|answer with the reply tool" packages tests`로 확인).
3. `app-engineer/prompt.md`의 "The coding agent may message you…" 항목: 메시지는 `<lophn-call from="coding_agent:ses_…">`로 오고, 글로 답하면 터미널에 가지 않으며, `call`에 `to:{session:"<that session id>"}`, `reply:"conversation"`으로 답한다고 적는다. 사람에게 한 요약은 coding agent에게 가지 않는다는 것도 한 줄로 쓴다. `to:{role:"coding_agent", place}`는 새 ticket 맡기기 전용이라 답에 쓰지 않는다고 짚는다.
4. `lophn message send --help`: `help.ts` `fieldsOf`가 JSON schema의 `type`("array")만 보여 준다. `fieldsOf`가 property의 `description`을 읽어 help 줄 끝에 ` - <description>`으로 붙이고, `protocol/coding-agent/message.ts`의 `refs`에 `.describe("ticket IDs, e.g. [\"tkt_…\"]")`를 단다. 다른 command는 description이 없어 그대로다.
5. 문서: `coding-agent.md`에 메시지 답이 터미널에 가는 길(App Engineer의 `call` `to:{session}` `reply:"conversation"` → Router → PTY, 글 답은 가지 않음)을 83행 근처 결정이나 25행 흐름도에 한 줄로 적는다. `agent-call.md` 51행에 coding agent가 보낸 call의 봉투는 답하는 길 줄을 더 싣고 `from`으로 두 길이 같다는 것을 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(2번은 기존 test에 경우 하나를 더한다. 봉투 bytes가 두 길에서 어긋나면 cache가 깨지는 규칙이다).
- lead에게(eval 갱신): `tests/eval/versions/files.ts` `classifyPath`로 `input-text.ts`는 `runtime`(`packages/core/lophn-agent/` 전체 hash), `app-engineer/prompt.md`는 `instruction`, `help.ts`·`message.ts`는 `core`를 올린다. `call.ts`는 안 건드려 `tool`은 그대로다. `runtime`·`core`가 올라 기존 run은 거의 모두 낡는다. 이 task는 `tests/eval`을 건드리지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(줄 문구, help 표기)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: `session.list`(`listSendable`)는 열린 coding session을 보여 주지 않고 `queued_coding`만 준다. 그래서 App Engineer는 봉투의 id로만 답할 수 있다(이 task는 그대로 둔다). 없으면 "없음"
