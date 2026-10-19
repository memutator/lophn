# dp-roles-public

wave 3이 만든 신호를 agent 지침에 쓴다. lophn은 지도(project마다 이름, 목적, 앱의 공개 tool, 설치한 package, 사용 관계)를 보고 재사용과 경계를 넘는 판단을 한다. PM은 다른 project의 공개 tool만 보고 쓰고, 공개 tool이 바뀌거나 막혔다는 reaction을 받으면 자기 skill을 다시 보고, 다른 project에서 난 package bug는 주인 project의 PM에게 `call`로 넘긴다. 지침(글)만 고친다.

- 단위: public-tools (wave 3)
- 선행: 없음. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 알려 준 뒤 띄운다. 쓰는 신호의 모양은 `dp-public-event`(event 이름), `dp-lophn-map`(지도 글), `dp-package-owner`(`owner_project`)가 정한다. 같은 wave에서 도는 task라 brief에 적힌 이름을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
  - `packages/core/agent-roles/roles/lophn/prompt.md`
  - `packages/core/agent-roles/roles/lophn/guides/roles-and-grants.md`
  - `packages/core/agent-roles/roles/operator/prompt.md`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 조립), `project-docs/architecture/agent-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > lophn 지도 / 다른 project의 tool / 공개 tool을 바꾸는 release / package 주인", `project-docs/products/roadmap/domain.md`의 "role", "skill", "MCP server와 경계, 여러 domain을 쓰는 agent"
- 계약:
  - 쓰는 것: 새 reaction `PublicToolsChanged`(`<lophn-reaction>` 사실. `change`가 `changed`면 자기 앱이나 쓰는 다른 project 앱의 공개 tool이 바뀐 것, `blocked`면 release가 막힌 것), 지도 글, `package.get`의 `owner_project`
  - 내놓는 것: 각 role의 지침 글

## 할 일

1. `packages/core/agent-roles/roles/lophn/prompt.md`: "What you do"에 지도를 쓰는 항목을 더한다: 새 앱이나 변경을 청받으면 지도에서 다른 project의 공개 tool이나 package가 이미 있는지 먼저 본다(없으면 새로). 다른 project의 tool을 쓰는 grant는 사람이 준다고 쓴다. 경계를 넘는 판단(경계 자르기, 재사용, export, package로 빼기)은 lophn이 이유를 붙여 제안하고 사람이 정한다. 같은 package나 tool을 쓰는 project가 둘 이상이면 그 사실을 지도에서 알아본다(program이 따로 알리지 않는다). "Project instructions are not in your prompt" 줄은 그대로 둔다.
2. `packages/core/agent-roles/roles/project-manager/prompt.md`(앞 wave에서 합쳐진 글): 다음을 더한다. 다른 project의 tool은 `public`인 것만 보인다고 쓴다. 자기 Operator에게 다른 project의 공개 tool을 쓰게 하려면 grant를 제안하는 것까지가 PM의 일이고 grant는 사람이 준다. `<lophn-reaction>`이 `PublicToolsChanged`이면: `changed`면 자기 skill이 그 tool을 부르는지 읽고 skill을 고친다(자기 앱의 tool이 바뀐 것이면 자기 Operator들도 확인한다), `blocked`면 막힌 이유(다른 project가 쓰는 공개 tool을 지움)를 읽고 tool을 되살리는 ticket을 만들거나, 지우기로 하면 사용하는 project의 PM에게 `call`로 알린 뒤 사람에게 올린다. 공개 tool을 만들거나 바꾸는 ticket에는 "공개는 약속이다"를 적게 한다. package bug: 다른 project의 앱이 쓰는 package에서 난 problem이면 `package.get`의 `owner_project`의 PM에게 `call`한다(`to:{role:"project_manager", place:{project:<이름>}}`, 답 없음). 직접 고치지 않는다.
3. `packages/core/agent-roles/roles/operator/prompt.md`, `packages/core/agent-roles/roles/lophn/guides/roles-and-grants.md`: 다른 project의 공개 tool을 grant 받아 쓸 수 있고 그 tool이 바뀌면 PM이 알려 줄 수 있다는 한 줄을 더한다(guide는 사람이 읽는 설정 설명이라 "다른 project의 비공개 tool은 grant 목록에 나오지 않는다"를 쓴다).
4. 위험 test는 두지 않는다(글이다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "App Engineer\|app_engineer" packages/core/agent-roles/roles`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 문장의 순서와 위치
- 넘길 줄: `packages/core/agent-roles/roles/project-manager/prompt.md`는 `domain-kinds`도 context 절을 다시 쓴다. 새 항목만 더했다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
