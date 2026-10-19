# dp-operator-skills

agent 정의의 `skills_off`(뺄 skill 이름)를 `skills`(받을 skill 이름)로 바꾼다. 비어 있으면 그 place가 받을 수 있는 skill을 다 받고, 이름이 있으면 그것만 받는다. prompt의 skill 목록과 `skill.read`는 받은 skill만 다룬다. 전역 설정의 `lophn-agent.extensions.skills_off`와 project 설정 file(`extensions.json`)의 `skills_off`는 다른 층의 끄기라 그대로 둔다.

- 단위: place-core (wave 2)
- 선행: dp-agents-core, dp-agent-roles-scope. 두 task가 같은 `lophn-agent/agents/`·`packages/core/lophn-agent/extensions/`·`register.ts`와 `agent-roles/tools/operator.ts`를 먼저 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/agent-values.ts`
  - `packages/protocol/lophn-agent/operators.ts`
  - `packages/core/lophn-agent/agents/`
  - `packages/core/lophn-agent/commands/`
  - `packages/core/lophn-agent/extensions/`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/agent-roles/tools/operator.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("skill은 목록(이름과 설명)만 prompt에 넣고 본문은 tool로 읽는다"), `project-docs/architecture/place-session.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agents`, `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > Operator skill", `project-docs/products/roadmap/domain.md`의 "skill"
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: agent 정의 frontmatter의 `skills?: string[]`(이름 목록, 중복 없음, nonblank). Operator 정의(`operatorDefinitionSchema`)와 built-in 정의(`builtinDefinitionSchema`)가 같은 칸을 쓴다. 정의 읽기의 `counts.skills`는 받는 skill 수다. `ResolvedAgent.skills`는 받는 skill 이름(환경 순서)이다.

## 할 일

1. `packages/protocol/lophn-agent/agent-values.ts`: `skillsOffSchema`(158째 줄)를 `skillsSchema`로, `frontmatterFields`·`frontmatterOutputFields`(186, 197째 줄)의 `skills_off`를 `skills`로 바꾼다. `operators.ts`의 `definitionKeys`(23째 줄)·`builtinKeys`(42째 줄)와 주석도 맞춘다. 옛 이름을 읽는 장치를 만들지 않는다(개발 data는 새로 만든다). built-in 정의가 같은 칸을 쓰는 것은 칸을 둘로 나누지 않으려는 선택이다(보고의 "정한 것").
2. `packages/core/lophn-agent/agents/resolve.ts`(`resolveAgent`의 `skillsOff`, 133~135째 줄): 받는 skill = `definition.skills`가 비었으면 `environment.skills` 전부, 아니면 `environment.skills` 중 고른 이름(환경 순서). 등록에 없는 이름은 무시한다. `sources.skills`는 `skills`가 비어 있지 않을 때 `agent`다. `packages/core/lophn-agent/agents/reads.ts`(58째 줄, `counts.skills`), `packages/core/lophn-agent/agents/definition-file.ts`(193째 줄 `EMPTY_DEFAULT_LISTS`와 칸 순서), `packages/core/lophn-agent/agents/validate.ts`의 칸 검사를 맞춘다.
3. `packages/core/lophn-agent/extensions/skill-read.ts`: `SkillSession.skills_off`(38째 줄)를 `skills`(고른 이름)로 바꾸고 `createSkillSnapshot`(65째 줄)이 고른 이름이 있으면 그 밖의 skill을 `enabled: false`로 둔다(`discoverSkills`에 `only` 인자를 더하거나 결과 entries를 거른다). `turnSkillReader`(192째 줄)의 `skills_off: []`도 맞춘다. 끈 skill은 목록에서 빠지고 `skill.read`가 `forbidden`이다(지금 규칙 그대로). `packages/core/lophn-agent/extensions/registry.ts`(89째 줄)는 전역·project 층의 끄기라 그대로다.
4. `register.ts`의 `skillsOffOf`(669째 줄, 쓰는 곳 694째 줄)를 `skillsOf`로 바꾸고 쓰는 곳(`commands/`의 `commandSkillsOf`에 넘기는 `selected`)을 맞춘다: 고른 이름이 있으면 그것만 `selected`.
5. `packages/core/agent-roles/tools/operator.ts`의 `operator.create` 설명문("contexts, skills_off, mcp_off and instructions")과 `operator.update` 입력(정의의 `.partial()`)에서 `skills_off`를 `skills`로 바꾼다.
6. 시험을 맞춘다: `packages/core/lophn-agent/agents/{resolve,commands,reads}_test.ts`, `packages/core/lophn-agent/extensions/skills_test.ts`에서 `skills_off`를 `skills`로 옮기고, "고른 것만 받는다 / 비면 다 받는다" 사례를 한 test에 둔다. 위험 test는 따로 쓰지 않는다.
7. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음:
  - `grep -rn "skills_off" packages/protocol/lophn-agent/agent-values.ts packages/protocol/lophn-agent/operators.ts packages/core/lophn-agent/agents packages/core/agent-roles` 가 0줄이다.
  - `grep -rn "skills_off" packages/core/lophn-agent/extensions packages/core/lophn-agent/register.ts`에는 전역 설정 `lophn-agent.extensions.skills_off`와 project 설정 file(`project-settings.ts`, `skills-handler.ts`, `skill-folders.ts`, `settings.ts`)의 것만 남는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `skillsOffSchema`
- 정한 것: built-in role(lophn, PM) 정의도 `skills` 칸을 쓴다 / 등록에 없는 고른 이름은 무시한다
- 넘길 줄: 화면의 skill 체크박스 의미는 `dp-shell-agents`가 바꾼다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
