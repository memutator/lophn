# de-agents-domains

agent 정의에 `domains`를 실제로 쓴다(저장 검사, 읽기, resolve)와, skill이 project 층 대신 domain 층에서 발견되게 한다. Operator가 domain을 고르면 `ResolvedAgent.domains`가 그 domain id 목록이 되고(안 고르면 그릇의 active domain 전부), `skills`는 그 domain들의 skill 가운데서 고른 것이 된다. skill 폴더는 `<data>/domains/<dom>/skills/`다.

- 단위: harness (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/agents/`
  - `packages/core/lophn-agent/extensions/`
  - `packages/core/lophn-agent/commands/`
  - `packages/core/lophn-agent/register.ts`
  - `packages/protocol/lophn-agent/{agent-values,agent-definitions,operators,skill-settings}.ts`
  - `packages/core/agent-roles/place/project-layer.ts`
  - `packages/core/main/daemon/wiring/{lophn-agent-team,lophn-agent-extensions}.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`("agent 정의의 `skills`", "skill은 목록만 prompt에"), `project-docs/architecture/place-session.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agents`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > Operator 좁히기", `project-docs/products/roadmap/domain.md`의 "domain이 가진 것"(skill 줄)
  - 본보기(코드): `packages/core/lophn-agent/agents/resolve.ts`(`receivedSkills`, `ResolvedAgent`), `agents/validate.ts`(`checkOperator`), `extensions/skills.ts`(`discoverSkills`, `skillReceived`, `mergeSkillLayers`), `extensions/skills-sync.ts`, `extensions/skill-folders.ts`(`productSkillStores`), `extensions/skill-read.ts`, `extensions/registry.ts`
- 계약:
  - 쓰는 것: `de-domain-core`의 `domainList` read와 `packages/core/domains/lookups.ts`의 `domainIdsOfOwner`, `packages/protocol/domains/paths.ts`의 `domainSkillsFolder`, `de-place-restore`가 둔 `AvailableSkill.domain`·`SkillEntry.domain`·`ResolvedAgent.domains`
  - 내놓는 것
    - `ResolvedAgent.domains`는 **구체 id 목록**이다: Operator가 고른 `domains`와 그 place 그릇의 active domain의 교집합, 고르지 않았으면 그릇의 active domain 전부(id 순). PM·App Engineer·lophn도 같은 규칙이다(lophn은 place가 없어 `[]`).
    - `AvailableSkill`·`SkillEntry`의 `domain`은 domain 층 skill이면 그 domain id, 아니면 null이다. `SkillSource`에 `"domain"`이 더해진다(`"project"`는 지운다).
    - `AgentLookups`에 `domains(place: Place | null): readonly string[]`(place 그릇의 active domain id)가 생긴다.

## 할 일

1. 저장·읽기: `agents/definition-file.ts`가 `domains`를 정해진 칸 순서에 넣어 쓰고 읽는다(중복 거절은 schema 몫). `agents/validate.ts`의 `checkOperator`는 `definition.domains`의 각 id가 `place` 그릇의 domain(`lookups.domains(place)`)이 아니면 issue `{field: "domains.<i>", code: "unknown"}`로 거절한다(`AGENT_DEFINITION_ISSUE_CODES`에 코드가 없으면 `agent-values.ts`에 더한다). `agents/commands.ts`·`reads.ts`가 `domains`를 그대로 실어 나른다(`agent-definitions.ts`의 읽기 모양에 `effective.domains`를 더한다).
2. resolve: `agents/resolve.ts`의 `ResolveEnvironment`에 그릇의 domain id를 받아 위 규칙으로 `domains`를 만들고, `receivedSkills`가 고른 domain의 skill만 후보로 하고(`skill.domain === null`인 전역·내장 skill은 그대로) 그 안에서 `skills` 이름 고르기를 적용한다. `ResolvedAgent`의 hash 재료에 `domains`가 든다(`RESOLVED_FIELDS`). `agents/layers.ts`의 `resolveTurnAgent`와 `lophn-agent/register.ts`의 `agentLookups`가 `domains`를 환경에 넣는다. `PlaceLookups`에 `domainIds(sql, place)`를 더하고 `wiring/lophn-agent-team.ts`가 `packages/core/domains/lookups.ts`의 `domainIdsOfOwner`로 꽂는다.
3. skill 층: project 층 skill 폴더(`<data>/projects/<prj>/skills`)를 domain 층으로 바꾼다. `agent-roles/place/project-layer.ts`는 이름은 그대로 두고 domain의 skill 폴더를 `domainSkillsFolder(root, domain)`로 주는 규칙(`DomainSkillLayer`)을 더한다. 이 task의 코드는 `ProjectLayer.skillsFolder`를 더 쓰지 않지만 지우지 않는다(`place-folders-glue.ts`·`place-data.ts`가 아직 쓴다. `de-place-info`가 옮긴 뒤 cleanup이 지운다). `extensions/skills.ts`의 `SkillDiscoveryInput.project_store`를 `domain_stores: readonly {domain: string, folder: string}[]`로, `extensions/skills-sync.ts`의 `SkillSources.project`를 같은 목록으로 바꾸고 후보에 `domain`을 단다. 층 순서는 내장 < 전역 < domain이고, 같은 이름이 여러 domain에 있으면 domain 이름이 앞서는 것이 이긴다(정한 것). `extensions/registry.ts`의 `skills(place)`·`skill-folders.ts`의 `productSkillStores`·`registeredSkillEntries`와 `skill-read.ts`의 snapshot은 place의 domain 목록을 읽어(agent runtime 쪽은 machine 자격의 `domainList` read, core 쪽은 `lookups.domains`) 쓴다. project 층의 `extensions.json`(MCP 서버, 끈 skill 이름)은 그대로다.
4. 내장 skill: `protocol/lophn-agent/skill-settings.ts`의 `SKILL_SOURCES`를 `builtin | global | domain`으로, `BUILTIN_SKILLS`의 `kinds-yaml`을 PM과 App Engineer 둘 다 갖게 `role`을 `roles` 목록으로 바꾸고 설명의 "project"를 "domain"으로 고친다(`declaredBuiltin`, `builtinForRole`, `commands/registry.ts`의 `ORIGIN_RANK`를 따라 고친다). `kinds-yaml` skill 본문은 `de-kinds-domain`이 고친다.
5. `registeredSkillEntries`(`extensions/skill-folders.ts`)는 이미 받는 `machine`으로 place 그릇의 `domainList`를 읽어 domain 층을 만든다. 그래서 호출하는 `main/agent-runtime/product-driver.ts`(skill 발견 부분, 이 task 소유 밖)의 호출 모양은 바꾸지 않는다. `main/daemon/wiring/lophn-agent-extensions.ts`가 새 층 규칙을 받는다. 앱 그릇(app place)의 agent는 project 층 설정(`extensions.json`)이 없고 그 앱의 domain skill만 갖는다.
6. 이 task는 prompt를 조립하는 `run-loop/prepare.ts`(`resolved.skills.includes(entry.name)` 줄)를 고치지 않는다. `SkillEntry.domain`이 있으면 `de-turn-domains`가 그 줄에서 domain도 대조한다.
7. 시험: `agents/resolve_test.ts`, `agents/commands_test.ts`, `extensions/skills_test.ts`를 새 층·domain 규칙에 맞춘다. 앱 place 사례는 `de-place-restore`가 되살렸다.

## 알아 둘 것

- agent runtime의 machine 자격으로 `domainList`를 읽는 길은 `de-turn-domains`가 `RUNTIME_MACHINE_ROUTES`에 연다. 이 task의 단위 test는 fake machine으로 돈다.

## 정한 것

- `domains`가 가리키는 id는 저장 때 한 번 검사한다. 그 뒤 domain이 보관되면 resolve의 교집합이 그 id를 빼므로 agent는 시작한다(오류로 멈추지 않는다).
- 같은 skill 이름이 두 domain에 있으면 domain `name`이 사전순으로 앞서는 쪽이 이긴다. 이름과 domain을 같이 목록에 보이는 일은 하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "Operator가 domain 하나를 고르면 `ResolvedAgent.domains`가 그 id 하나이고, 받는 skill에 다른 domain의 skill이 없다. 전역·내장 skill은 그대로 받는다" — `packages/core/lophn-agent/agents/resolve_test.ts`
  - "정의가 그 place 그릇의 것이 아닌 domain id를 고르면 저장이 거절된다" — `packages/core/lophn-agent/agents/commands_test.ts`
- 남지 않음: `grep -rn "project_store" packages/core/lophn-agent`가 0줄이고, `grep -rn "projectLayer.skillsFolder\|layer.skillsFolder" packages/core/lophn-agent`가 0줄이다(`ProjectLayer.skillsFolder` 정의와 `agent-roles/place`·`main/daemon`의 쓰는 곳은 남는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `ProjectLayer.skillsFolder`(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄: `SkillSource` 변경으로 고친 shell file:줄이 있으면 적는다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
