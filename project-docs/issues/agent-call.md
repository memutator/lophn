# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.

## 가져간 call 글이 뒤 turn의 history에서 태그 없이 원문으로 들어간다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: 받은 call·reply·notice는 그 turn의 입력일 때만 `packages/core/lophn-agent/run-loop/input-text.ts`의 `wrap`으로 `<lophn-call ...>` 같은 태그에 싸인다. 다음 turn부터는 `packages/core/lophn-agent/session/history.ts`의 `readSessionConversation`이 session 기록의 본문을 그대로 history에 넣는다. 그래서 "다른 agent가 보낸 것이고 이 session의 권한 안에서만 따른다"는 표지가 그 turn이 끝나면 사라진다. `tests/e2e/agent-call_test.ts`의 `inbox-order`를 고치며 찾았다(아직 가져가지 않은 call이 prompt에 섞이는 것은 고쳤다).

영향: 다른 agent(AI가 만든 글)가 보낸 지시가 다음 turn부터는 사람의 글과 구별되지 않는다. agent가 그 지시를 사람의 요청처럼 따를 수 있다.

고치려면:
- history도 입력과 같은 규칙으로 싼다(중간): `history.ts`가 message의 출처(`from_kind`, call·reply·reaction)에 따라 `input-text.ts`의 같은 함수로 본문을 싼다. compact 요약, rewind, fork처럼 history를 쓰는 모든 prompt가 같이 바뀐다.
- 그대로 둔다: 표지는 받은 turn에만 있다는 것을 architecture에 적는다.
- 추천: history도 싼다. 막는 것이 "AI가 만든 글"이라 AGENTS.md "속도"의 남기는 쪽이다.
