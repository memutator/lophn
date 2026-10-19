# dp-coding-text

coding agent 쪽 문구에서 App Engineer를 Project Manager로 바꾼다. coding agent가 ticket을 맡기고 메시지를 보내는 상대, app template의 AGENTS.md, 두 skill(`lophn-build-app`, `lophn-repair`)의 안내가 대상이다. 동작은 바뀌지 않는다(메시지가 가는 곳은 `dp-place-events`가 바꾼다).

- 단위: role-merge (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`
  - `packages/coding-agent/cli/commands/package.ts`
  - `packages/coding-agent/cli/commands/message.ts`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `packages/protocol/coding-agent/message.ts`
  - `packages/protocol/coding-agent/ticket/claims.ts`
  - `packages/protocol/coding-agent/ticket/values.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > PM이 App Engineer의 일을 맡는다", `project-docs/products/AGENT-ROLE.md`의 K4, T20
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: coding agent가 보는 안내문의 "App Engineer"가 모두 "Project Manager"다. `lophn message send`의 도움말은 "일을 맡긴 Project Manager에게 메시지를 보낸다"다.

## 할 일

1. 위 file의 "App Engineer"를 "Project Manager"로 바꾼다. 줄: `lophn-build-app/SKILL.md` 17, 32, 43, 61, 85, 95, 138째 줄, `lophn-repair/SKILL.md` 34, 45, 72째 줄, `packages/coding-agent/cli/commands/package.ts` 1째 줄, `packages/coding-agent/cli/commands/message.ts` 1, 5째 줄, `AGENTS.md.tmpl` 26, 41째 줄, `packages/protocol/coding-agent/{message.ts 1째 줄, ticket/claims.ts 135째 줄, ticket/values.ts 75째 줄}`.
2. 안내문이 "앱의 담당 agent"가 새 project의 PM임을 암시하게 읽히지 않는지 훑는다. 문장 뜻을 바꾸지 않는다.
3. 위험 test는 두지 않는다. 이 문구를 단언한 test가 있으면(`grep -rn "맡긴 App Engineer" packages`) 새 문구로 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "App Engineer\|app_engineer" packages/coding-agent packages/core/apps/packages/template packages/protocol/coding-agent`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄: `packages/coding-agent/*`는 `domain-tools`도 고친다(CLI·skill 문구). 해당 줄만 고쳤다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
