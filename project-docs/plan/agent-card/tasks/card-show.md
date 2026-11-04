# card-show

place 정보의 "Agents you can call"에 한 줄 목적을 싣고, notice 기준에 넣고, 사람 화면이 명함을 보인다.

- 단위: card (wave 3)
- 선행: card-check.
- 소유(이 task만 고친다):
  - `packages/core/agent-places/place/{place-data,place-info}.ts`(+test)
  - `packages/core/lophn-agent/prompt-assembly/{model,basis,turn-prompt}.ts`(+test)
  - `packages/shell/renderer/workspace/agents/**`, `packages/design/i18n/catalog/agents.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(place 정보, cache, notice)
  - 제품 결정: 계획 README 정한 것 1, 5
- 계약:
  - 쓰는 것: `card-read`의 명함 type과 `cardOf`
  - 내놓는 것: 없음

## 할 일

1. `PlaceAgent`(`prompt-assembly/model.ts:87`)에 `description`. `place-info.ts` `agentLines()`가 `- <name>: <description>`(없으면 이름만). 차이와 modality는 싣지 않는다.
2. notice 기준(`basis.ts` `agentLine()`)에 description을 넣는다. 안 넣으면 system 글이 notice 없이 바뀐다.
3. 사람 화면: agent 목록 카드(`agents-tab.tsx` `AgentCardView`)와 편집기에 명함(목적, runtime, modality, 답 방식, 차이). 편집기에 `modality` 고르기.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
