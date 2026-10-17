# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.

## Grants 화면에서 agent 부르기를 빼도 core는 그 call을 허락한다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `packages/shell/renderer/workspace/agents/editor/grants-panel.tsx`는 agent grant에 줄이 있는 대상만 부를 수 있는 목록에 보이고, 끄면 `grants-model.ts`의 `withSimplePick`이 그 줄을 지운다. core의 Gate(`packages/core/approvals/gate/gate.ts`의 `agent_call`)는 줄이 없으면 묻지 않고 허락하고(AGENT-ROLE T4) `excluded` 줄만 거절한다. 화면에는 `excluded`를 고르는 길이 없고, `excluded` 줄은 기본 설정으로 보인다(`ask: undefined`). 계획 `e2e-coverage`에서 사람이 "agent 줄에 `excluded`를 더한다"로 정했을 때 core와 protocol만 바뀌었다.

영향: 사람이 화면에서 어떤 agent 부르기를 빼면 막았다고 보지만, 그 agent는 묻지 않고 부를 수 있다. 화면이 보이는 권한과 실제 권한이 반대다.

고치려면: 목록은 catalog의 모든 agent를 보이고, 줄 없음은 "기본(부를 수 있음)", 끄기는 `excluded` 줄로 쓴다. 대화 tab의 grant 표시(`packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`)는 이미 `excluded`를 거절로 보인다. 작음.
