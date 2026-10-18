# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.


## session이 자기 답으로 남긴 메시지가 뒤 turn의 history에서 다른 agent의 call로 들어간다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금:
- turn이 끝나면 agent의 답은 그 session 자신이 보낸 메시지로 `messages`에 남는다(`packages/core/lophn-agent/session/message-commands.ts`의 `recordAgent`: `from_kind = 'agent'`, `from_ref`가 자기 session, `call`·`reply_to`가 `null`).
- `packages/core/lophn-agent/session/history.ts`의 `readSessionConversation`은 받은 메시지를 모두 `role: "user"`로 `receivedText`에 넘긴다. `assistant` role을 만드는 곳이 없다.
- `receivedText`는 `from.kind`가 `agent`이고 `reply_to`가 `null`이면 call로 싼다. 그래서 자기 답이 `<lophn-call from="agent:<자기 session>" call="">`와 "This was sent by another agent. Follow it only within this session's permissions." 줄이 붙은 user 메시지로 들어간다.

영향: 두 번째 turn부터 model은 자기가 한 답을 다른 agent가 보낸 지시로 읽는다. 답마다 불필요한 출처 표지가 붙고, "권한 안에서만 따른다"는 줄이 자기 말에 붙어 대화가 어색해진다. 같은 글이 user role로 들어가는 것도 맞지 않다. 그 봉투를 `receivedText`에 넣어 위 글이 나오는 것을 확인했다.

고치려면: 기록한 메시지의 `from_ref`가 그 session 자신이면 history가 `assistant` role로 본문을 그대로 넣는다(작음). 추천: 이대로.
