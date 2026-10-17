# grants-excluded

Grants 화면의 agent 부르기를 core의 규칙(줄 없음 = 기본 허락, `excluded` = 거절)에 맞춘다. 지금은 끄면 줄을 지워 오히려 허락이 된다.

- 단위: grants-excluded (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/editor/grants-panel.tsx`
  - `packages/shell/renderer/workspace/agents/editor/grants-model.ts`
  - `packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`(새 file)
  - wording catalog에 key를 더하는 것(새 문구가 필요할 때만)
- 읽을 것:
  - 이슈: `project-docs/issues/approval.md`의 "Grants 화면에서 agent 부르기를 빼도 core는 그 call을 허락한다"
  - architecture: `project-docs/architecture/approval.md`(agent grant 설정 `never`·`ask`·`excluded`, agent call은 줄이 없어도 허락)
  - 제품 결정: `project-docs/products/AGENT-ROLE.md`의 T4
  - 코드: `packages/core/approvals/gate/gate.ts`의 `agent_call`, `packages/protocol/approvals/grants.ts`(agent 줄의 `setting: excluded | never | ask`, 없으면 기본), `grants-panel.tsx`의 `callable`(지금은 줄이 있는 agent만)과 그 `GrantRow`, `grants-model.ts`의 `withSimplePick`·`agentEntryOf`, 대화 tab의 표시 `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`(이미 `excluded`를 거절로 보인다)
  - `.claude/skills/write-test/SKILL.md`, `.claude/skills/ui-design/SKILL.md`(화면 모양을 바꾸면), AGENTS.md "속도"
- 계약: 쓰는 것 `AgentGrantEntry`(protocol). 내놓는 것 없음.

## 할 일

1. 부르기 목록은 catalog의 모든 agent(`catalog.agents`)를 보인다. 줄이 없으면 "기본"(부를 수 있음, 기본 묻기)이다.
2. 켜고 끄기: 끄면 그 agent의 줄을 `setting: "excluded"`로 쓴다(줄을 지우지 않는다). 다시 켜면 기본으로 돌아간다(줄을 지우거나 고른 묻기 설정의 줄). `excluded` 줄은 꺼진 것으로 보인다.
3. 설정 고치기 줄(`settings`)은 지금 규칙(줄이 없으면 설정 고치기 없음)이 맞으면 그대로 둔다. 바꾸지 않는다.
4. 계산은 `grants-model.ts`의 순수 함수로 두고 test한다.

## 끝남

- `deno task check:full`이 통과한다. renderer build(`deno run -A packages/shell/renderer/build.ts`)가 된다.
- 위험 test(`grants-model_test.ts`): "agent 부르기를 끄면 그 agent의 줄이 `excluded`로 남고, 줄 없는 agent는 켜진 것으로 읽힌다"
- `deno task wireframes`가 되면 그 화면이 그려지는지 본다(gallery에 Grants page가 있으면).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 고치기 전 실패: 위험 test가 고치기 전 코드에서 실패한 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
