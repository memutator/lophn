# acp

lophn ACP(App Context Protocol)의 모양과 reducer. `project-docs/architecture/acp.md`.

## ACP session 모양이 lophn 값 목록 둘을 옮겨 적은 사본을 가진다

```yaml
kind: defect
modules: [packages/protocol]
```

지금: `packages/protocol/acp/session.ts`가 `valueLayers`(`AgentValueLayer`, `agent-definitions.ts`의 `AGENT_VALUE_LAYERS`)와 `COST_KINDS`(`model-call-values.ts`)를 값으로 옮겨 적었다. 원본을 import하면 shell main tsc(`noUncheckedIndexedAccess`)가 `models.ts`·`resolved-model.ts`의 import 사슬까지 읽고 거기서 깨진다.

영향: 원본에 층이나 비용 종류가 하나 늘면 ACP의 `model.layer`나 `usage.costs[].kind`가 그 값을 거절해 snapshot 검사가 실패하거나 화면이 그 값을 못 그린다. 두 목록을 같이 고쳐야 하는 것을 아는 사람만 피한다.

고치려면:
- 두 목록을 import 사슬이 짧은 leaf file(`packages/protocol/lophn-agent/` 아래 값만 든 file)로 옮기고 원본과 `session.ts`가 둘 다 그것을 import한다. 작음. 추천.

## 팀 자식의 질문 카드가 부모가 답해도 취소로 보인다

```yaml
kind: bug
modules: [packages/core/main, packages/protocol, packages/sdk, packages/shell/renderer]
```

지금: 팀 자식(`spawned_by` 있음)의 `ask` tool 결과는 부모가 답하면 `{outcome: "parent_reply", message}`다(`packages/protocol/lophn-agent/ask-tool.ts`). ACP의 질문 항목 outcome은 `submitted | human_message | cancelled` 셋뿐이라 `packages/core/main/daemon/wiring/acp-build.ts`의 질문 detail이 나머지를 `cancelled`로 낸다. 같은 셋이 `packages/protocol/acp/items.ts`, `packages/protocol/acp/state.ts`, `packages/sdk/agent/acp-types.ts`, `packages/shell/renderer/conversation/agent-tab-source.ts`에 있다.

영향: 사람이 자식 탭을 열면 부모가 답한 질문이 취소된 것으로 보인다. agent는 답을 받아 일을 이었는데 화면은 멈춘 것처럼 읽힌다.

고치려면:
- ACP 질문 outcome에 `parent_reply`를 더하고 카드에 "부모가 답함"과 답 글을 보인다. 위 file들과 `packages/sdk/agent`를 같이 고쳐 `sdk-note`가 걸린다. 중간. 추천.
- 그대로 두고 문서(`acp.md`)에만 적는다. 지금 상태다.
