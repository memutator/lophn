# hs-history-role

뒤 turn의 history를 만들 때, session이 자기 답으로 남긴 메시지를 `assistant` role로 본문 그대로 넣는다. 지금은 모든 받은 메시지를 user role로 넣고, 자기 답을 다른 agent의 call로 싸서 model이 자기 말을 남의 지시로 읽는다.

- 단위: hs-history-role (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/history.ts`
  - `packages/core/lophn-agent/session/history_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-call.md`의 "session이 자기 답으로 남긴 메시지가 뒤 turn의 history에서 다른 agent의 call로 들어간다"
  - architecture: `project-docs/architecture/agent-call.md`, `project-docs/architecture/agent-definition.md`(turn 조립, history)
  - 코드: `packages/core/lophn-agent/session/history.ts`의 `readSessionConversation`(받은 메시지를 `heard`에 `role: "user"`로 넣는 곳, 본문을 `receivedText`로 싸는 곳), `packages/core/lophn-agent/session/message-commands.ts`의 `recordAgent`(자기 답을 `from_kind = 'agent'`로 남긴다), `packages/core/lophn-agent/run-loop/input-text.ts`의 `receivedText`·`callText`, `packages/protocol/lophn-agent/calls.ts`(agent 보낸 쪽은 `{ kind: "agent", session }`)
- 계약:
  - 쓰는 것: `ReceivedMessage`, `SessionMessage`(role `user | assistant`)
  - 내놓는 것: 없음(내부 동작)

## 할 일

1. `readSessionConversation`에서 받은 메시지의 `from`이 `{ kind: "agent", session: <이 session> }`이면 `role: "assistant"`로 두고, 본문 글을 `receivedText`로 싸지 않고 그대로 넣는다. 글이 비면 넣지 않는다(카드뿐인 답).
2. 그 밖의 메시지는 지금처럼 user role과 `receivedText`다.
3. `run-loop/input-text.ts`의 `callText`에 있는 "`reply`가 null이면 call이 아닌 기록(session이 자기 답으로 남긴 메시지)" 갈래가 이제 쓰이지 않는지 본다. 쓰이지 않으면 그 file은 이 task의 소유가 아니므로 지우지 말고 보고의 "안 쓰게 된 export"에 적는다.
4. history를 쓰는 다른 곳(Compact: `input.request === null`)도 같은 함수를 쓰는지 확인한다. 따로 고칠 것이 있으면 보고한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(하나, `history_test.ts`. 이미 있으면 거기에 더한다): "session이 자기 답으로 남긴 메시지는 history에서 assistant role의 본문 그대로이고, 다른 agent가 보낸 call은 user role의 call tag다." 가장 싼 층(메모리 read stub)으로 본다. 앞선 fix가 이 길을 깨뜨린 적이 있다(AGENTS.md "두 번 이상 고친 버그"에 가깝다).
- 남지 않음: 없음.

## 보고

- 바꾼 file, 통과한 check
- 안 쓰게 된 export(`callText`의 null 갈래 등)
- 정한 것: 문서에 답이 없어 정한 것
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
