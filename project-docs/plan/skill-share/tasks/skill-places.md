# skill-places

skill frontmatter를 진짜 YAML로 읽고, project 첫 폴더와 앱 source의 `.lophn/skills`를 발견 자리에 더하고, agent 정의의 `skills`(받을 이름)를 `skills_off`(끈 이름)로 바꾼다.

- 단위: agent (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/**`
  - `packages/core/lophn-agent/agents/{resolve.ts,resolve_test.ts,reads.ts,reads_test.ts}`
  - `packages/core/lophn-agent/agents/skills-off-step.ts`(새 file, data step)
  - `packages/core/lophn-agent/agents/skills-off-step_test.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,prepare_test.ts}`
  - `packages/core/lophn-agent/tools/bundles/skill.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/agent-places/place/project-layer.ts`
  - `packages/core/main/daemon/wiring/skills-off.ts`(새 file, data step을 내는 wiring)
  - `tests/eval/versions/components.ts`
  - `packages/shell/renderer/workspace/agents/{source.ts,core-source.ts,core-source_test.ts,core-extensions.ts,fake-data.ts,fake-source.ts}`
  - `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/harness-config.md` 단계 2와 "정한 것"
  - 계획: `project-docs/plan/skill-share/README.md` 정한 것 6, `project-docs/plan/skill-share/facts.md` "skill 발견과 받기", "agent 정의"의 `dataSteps`
  - architecture: `project-docs/architecture/agent-definition.md`(skill 층, `skillReceived`, skill 목록)
- 계약:
  - 쓰는 것: `agent-values.ts`의 `skills_off`(wave 0), `skill-settings.ts`의 source `project`·`app`(wave 0)
  - 내놓는 것: `skillReceived(skill, off, domains)`. `shared-skills`가 같은 규칙으로 공유 skill을 거른다.

## 할 일

1. `extensions/skills.ts`의 `parseSkillFrontmatter`를 `yaml`(`schema: "core"`, `agents/definition-file.ts`와 같게)로 바꾼다. `description: >`, `|`, 따옴표 값이 읽혀야 한다. 이름과 설명이 문자열이 아니면 지금처럼 그 skill을 뺀다.
2. 발견 자리: project place는 첫 등록 폴더의 `.lophn/skills/<name>/SKILL.md`(source `project`), app place는 앱 source의 `.lophn/skills/<name>/SKILL.md`(source `app`). 층 순서는 내장 < 전역 < project·app < domain이고, 같은 이름은 뒤 층이 덮는다(내장은 덮지 못한다). `skill-folders.ts`의 `productFiles()` 허용 목록과 `skill.read` 읽기가 두 자리를 받는다. `.agents/skills`는 읽지 않는다.
3. `skillReceived`를 `(skill, off, domains)`로 바꾼다: 끌 수 없는 내장은 늘 받고, `off`에 있는 이름은 빼고, domain skill은 맡은 domain 것만 받는다. 쓰는 곳 넷(`agents/resolve.ts`, `extensions/registry.ts`, `extensions/skill-read.ts`, `agents/reads.ts`)이 정의의 `skills_off`를 넘긴다. 정의의 `skills`를 읽는 곳을 모두 없앤다.
4. data step `agents.skills-off`: `<root>/agents/*.md` 가운데 `skills`가 있는 파일마다 그때 발견되는 후보(내장, `~/.lophn/skills`, 등록 폴더, 그 agent가 맡은 domain의 skill) 가운데 `skills`에 없는 이름을 `skills_off`에 적고 `skills`를 지운다. 쓰기는 `serializeAgentFile`. `wiring/skills-off.ts`가 이 step을 `dataSteps`로 낸다(`WIRINGS` 등록은 lead).
5. shell agent editor의 skill 칸을 "끈 skill" 목록으로 바꾼다(`definition-form.tsx`, source들). 문구 key가 필요하면 보고에 적는다(i18n catalog는 lead가 더한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "`skills: [a]`를 가진 agent 파일을 data step이 옮기면 그 agent가 받는 skill 집합이 옮기기 전과 같다"
- 남지 않음: `grep -rn "\.skills\b" packages/core/lophn-agent packages/shell/renderer/workspace/agents`에 정의의 `skills` 칸을 읽는 줄이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `WIRINGS`에 넣을 wiring, i18n key, `agent-values.ts`의 `skills` 칸 지우기 요청
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
