# dp-grants-public-ui

agent grant 편집기가 다른 project 앱의 tool은 공개(`public`)인 것만 붙일 수 있게 보인다. 같은 project 앱은 지금처럼 모든 tool이 보인다. 앞 task(`dp-public-filter`)가 실행 때 tool 목록에서 비공개 tool을 빼므로 이 화면이 그 목록과 어긋나지 않게 하는 일이다. 새 화면을 그리지 않는다.

- 단위: public-tools (wave 2)
- 선행: dp-public-filter. 같은 규칙(앱 project와 agent place의 비교, `public`)을 쓴다. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 알려 준 뒤 띄운다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/editor/grants-panel.tsx`
  - `packages/shell/renderer/workspace/agents/editor/grants-model.ts`
  - `packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`
  - `packages/shell/renderer/workspace/agents/fake-data.ts`
  - `packages/shell/renderer/workspace/agents/fake-source.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/approval.md`(agent grant), `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 본보기(화면): `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`(grants 화면)
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 다른 project의 tool"
  - 쓰는 규칙: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: core 읽기 `apps/list`의 `project`(`dp-app-project`)와 `apps/blueprint`의 tool 선언·`public` 칸(`domain-tools` 계약. 읽기 이름은 지금 `core-grants.ts`가 쓰는 `"apps", "blueprint"`다)
  - 내놓는 것: `GrantApp`(`source.ts`)에 `project`(앱의 project id)가 있고, `GrantCatalog.apps`는 편집 중인 agent의 place project와 같은 앱이면 모든 tool을, 다르면 `public` tool만 담는다.

## 할 일

1. `core-grants.ts`의 `appCatalog`(25째 줄)가 앱의 `project`와 tool의 `public`을 읽는다. 편집하는 agent의 place project(편집기가 이미 아는 `place`)와 앱의 project를 비교해 다르면 비공개 tool을 뺀다. place가 없는 agent(lophn)는 모든 앱이 다른 project다. `source.ts`의 `GrantApp`에 `project` 한 칸을 더한다(이 file은 앞 wave의 `dp-shell-agents`가 고쳤고 merge된 뒤다).
2. 이미 붙어 있는 entry가 가리키는 다른 project 앱의 비공개 tool은 화면에서 "더 이상 쓸 수 없음"으로 표시할 필요가 없다 — 실행 때 목록에서 빠진다. 편집기가 그 entry를 지우지는 않는다.
3. `fake-data.ts`/`fake-source.ts`에 두 project의 앱을 하나씩 두어 gallery와 test가 같은 규칙을 보게 한다.
4. `grants-model_test.ts`에 사례 하나(다른 project의 비공개 tool이 catalog에 없다)를 더한다. 새 test 파일을 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(실행 때의 걸러내기는 `dp-public-filter`의 위험 test가 본다. 이 화면은 그 규칙을 보이는 것뿐이다)
- 남지 않음: 없음
- (화면) `deno task wireframes`가 된다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 이미 붙은 entry는 지우지 않는다
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
