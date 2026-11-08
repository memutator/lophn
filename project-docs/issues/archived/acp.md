# acp (닫음)

## 팀 자식의 질문 카드가 부모가 답해도 취소로 보인다

```yaml
kind: bug
modules: [packages/core/main, packages/protocol, packages/sdk, packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 팀 자식(`spawned_by` 있음)의 `ask` tool 결과는 부모가 답하면 `{outcome: "parent_reply", message}`다(`packages/protocol/lophn-agent/ask-tool.ts`). ACP의 질문 항목 outcome은 `submitted | human_message | cancelled` 셋뿐이라 `packages/core/main/daemon/wiring/acp-build.ts`의 질문 detail이 나머지를 `cancelled`로 낸다. 같은 셋이 `packages/protocol/acp/items.ts`, `packages/protocol/acp/state.ts`, `packages/sdk/agent/acp-types.ts`, `packages/shell/renderer/conversation/agent-tab-source.ts`에 있다.

영향: 사람이 자식 탭을 열면 부모가 답한 질문이 취소된 것으로 보인다. agent는 답을 받아 일을 이었는데 화면은 멈춘 것처럼 읽힌다.

고치려면:
- ACP 질문 outcome에 `parent_reply`를 더하고 카드에 "부모가 답함"과 답 글을 보인다. 위 file들과 `packages/sdk/agent`를 같이 고쳐 `sdk-note`가 걸린다. 중간. 추천.
- 그대로 두고 문서(`acp.md`)에만 적는다. 지금 상태다.

닫음: ACP 질문 outcome에 `parent_reply`와 부모의 답 글 `reply`를 더했다. 자식 탭의 카드는 "Answered by the parent"와 그 글을 보인다.
