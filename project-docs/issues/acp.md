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
