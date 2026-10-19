# de-shell-operator-domains

**사람이 `de-drafts`의 `domain-operator-*` page 가운데 모양을 고른 뒤에 띄운다(lead가 아래 "고른 모양"을 채운다).** Operator 편집 화면에서 domain을 고르게 하고(비우면 그 그릇의 전부), Skills 칸이 고른 domain의 skill만 보이게 하고, grant 화면의 "붙일 수 있는 tool" 규칙을 domain 기준으로 다듬는다(고른 domain의 tool은 모두, 다른 domain은 public만).

- 단위: shell-domains (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/`
  - `packages/design/wording/catalog/agents.ts`
  - `packages/design/wording/catalog/agents.placeholders.ts`
  - `tools/wireframes/mock/agents-data.ts`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `tools/wireframes/pages/screens/agent-setup/`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/agent-definition.md`("agent 정의의 `skills`는 받을 skill을 이름으로 고른다", "다른 project 앱의 비공개 tool은 …")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agents`, `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > Operator 좁히기, 화면"
  - 본보기(화면): 사람이 고른 `de-drafts`의 `domain-operator-*` page, `tools/wireframes/pages/screens/agent-settings.tsx`와 `agent-setup/`
  - 본보기(코드): `packages/shell/renderer/workspace/agents/editor/{definition-form,grants-model,grants-panel}.tsx|ts`, `core-source.ts`, `source.ts`
- 계약:
  - 고른 모양: `domain-operator-b`(Domains checkbox 목록, Skills는 고른 domain별로 묶음). 앱 Operator(`domain-operator-app`)는 A로 그려져 있지만 같은 B 모양을 앱 place에 쓴다(지침 층 안내만 다르다). 사람이 2026-10-19에 골랐다.
  - 쓰는 것: Operator 정의의 `domains`(`operatorDefinitionSchema`), core read `domain.list`, `AppTool.domain`(tool의 domain 이름), `ReadAgentDefinition`의 `definition.domains`, skill 목록의 `domain`(`de-agents-domains`가 낸 `SkillEntry.domain`을 `skills` read가 싣는다면 쓴다. 싣지 않으면 domain별 skill 목록은 `domainList` + 각 domain의 skill read로 읽는다)
  - 내놓는 것: `AgentsSource`에 `domains(place)`(그 place 그릇의 active domain 목록). `appsFor(apps, agentDomains)`(`editor/grants-model.ts`)는 agent가 고른 domain(없으면 그릇의 전부)에 든 domain의 tool은 모두, 그 밖은 public만 남긴다.

## 할 일

1. 편집 화면: `editor/definition-form.tsx`에 고른 Draft(`domain-operator-b`)의 Domains 칸을 올린다(checkbox 목록, 하나도 고르지 않으면 "All domains of this project/app"). Skills는 고른 domain별로 묶는다. 값은 정의의 `domains`(id 목록)로 저장하고, 읽을 때 지금 그릇에 없는 id는 칸에서 빼고 안내 한 줄을 보인다. `core-source.ts`가 `domains`를 읽고 쓰고, `source.ts`와 `fake-source.ts`/`fake-data.ts`에 `domains(place)`를 더한다.
2. Skills 칸: 고른 domain의 skill만 목록에 보인다. 이미 고른 이름이 목록 밖이면(domain을 바꿨다) 칸에서 빼고 저장 전에 알린다.
3. grants: `grants-model.ts`의 `appsFor`를 위 계약대로 바꾼다. `GrantApi`에 `domain`(이름)을 싣고(`core-grants.ts`가 `tools[].domain`을 읽는다) 앱의 domain 이름 → id는 `domains(place)`가 아니라 앱의 `domainList`로 얻는다(앱 place 밖 앱은 읽을 수 없으니 public만 남는다). `grants-model_test.ts`를 새 규칙으로 쓴다.
4. wording: Draft의 `domain` 영역 key는 읽기만 한다(그 catalog는 `de-shell-domain-list`만 고친다). 새 key는 `agents` 영역에 더하고 `deno task wording`으로 생성물을 맞춘다.
5. wireframe: 고른 page를 `agent-settings.tsx`/`agent-setup/`의 Operator 편집 page에 반영한다(고르지 않은 Draft는 건드리지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "domain D1만 고른 agent에게 D1의 비공개 tool은 grant 화면에 나오고, 같은 앱의 D2·다른 앱의 비공개 tool은 나오지 않는다. public tool은 어느 domain 것이든 나온다. 고른 domain이 없으면 그릇의 모든 domain을 고른 것으로 본다" — `packages/shell/renderer/workspace/agents/editor/grants-model_test.ts`
- 남지 않음: 없음
- (화면) `deno task wireframes`가 되고 gallery의 Operator 편집 page가 Domains 칸으로 그려진다. `deno run -A packages/shell/renderer/build.ts`가 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

## lead가 더함

- wording catalog `domain.ts`는 같은 wave의 `de-shell-domain-list`만 고친다(orchestrate: catalog는 한 worker에게만). 이 task는 그 영역 key를 쓰기만 하고 새 key는 `agents` 영역에 둔다.
