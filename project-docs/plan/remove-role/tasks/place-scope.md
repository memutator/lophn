# place-scope

place 종류가 정하는 범위를 옮긴다: file 범위와 rewind 쓰기 폴더, 받는 domain, 지침 층 읽기 규칙, prompt의 place 정보(부를 수 있는 agent 목록), 내장 skill 고르기, 지침을 place 종류로 고르기. prompt 층 이름 `role`도 바꾼다.

- 단위: places (wave 2)
- 선행: place-tools. 같은 hub file(`prepare.ts`, `product-driver.ts`, `register.ts`)을 이어서 고친다.
- 소유(이 task만 고친다):
  - `packages/core/agent-places/place/{place-folders,place-folders_test,place-data,place-info,place-info_test,instruction-rules,instruction-rules_test,project-layer,data-folder,data-folder_test,artifact-list}.ts`
  - `packages/core/agent-places/roles/prompts.ts` (place 종류로 고르기만)
  - `packages/core/main/daemon/{place-folders-glue,place-folders-glue_test,agent-domains}.ts`
  - `packages/core/lophn-agent/instructions/{files,turn,turn_test,read_test}.ts`
  - `packages/core/lophn-agent/extensions/{skills,skills_test,skill-read,skill-folders,registry}.ts`
  - `packages/core/lophn-agent/commands/{reads,registry}.ts`
  - `packages/core/lophn-agent/prompt-assembly/{model,summary,turn-prompt,basis}.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/main/daemon/wiring/{instructions-registration,lophn-agent-extensions,lophn-agent-team,secrets}.ts`
  - `packages/core/apps/usage/ports.ts`
  - `tests/support/wire/binding.ts`, `tests/support/loop/harness.ts`, `tests/live/suite.ts` (넘길 줄: prompt 층 이름)
  - `tests/eval/versions/components.ts`, `tests/eval/experiment/variant/texts.ts` (넘길 줄: 지침 고르기 함수)
  - `tests/e2e/file-write_test.ts` (넘길 줄: 지침 규칙 함수)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/lophn-agent/extensions/{skills-handler,mod}.ts`
  - `packages/core/lophn-agent/models/{binding_test,user-info_test}.ts`
  - `tests/eval/experiment/assembly/{prefix,prefix_test}.ts`
  - `tests/eval/versions/versions_test.ts`
  - `packages/core/apps/usage/{users,reads}.ts`
  - `packages/core/lophn-agent/agents/{resolve,layers}.ts`
  - `packages/core/lophn-agent/prompt-assembly/layers.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "session과 place 종류"(받는 domain, file 범위, 내장 skill, place 종류별 지침), "주소와 넘기기"(workflow 참가자의 `workflows/`), "저장과 test"(위험 test), "뼈대 검토"(prompt 층 이름). 앞 task brief `tasks/{contract-agent,contract-session,agents-core,sessions-core,place-tools}.md`의 "내놓는 것". 앞 task가 실제로 바꾼 것은 plan branch에서 `git log --oneline main..HEAD`와 그 diff로 본다.
  - architecture: `project-docs/architecture/place-session.md` "지키는 것"의 file tool 범위 줄과 그 아래 줄들(base, `placeScope`, rewind 쓰기 폴더), `project-docs/architecture/domain.md` "흐름"의 turn 줄과 "지키는 것"(prompt·tool·file 범위의 단위는 맡은 domain, `DOMAIN.md`는 맡은 domain의 것만 읽는다, rewind 쓰기 폴더는 넉넉히, job·flow caller의 domain 거르기, 사용 관계의 쓰는 쪽), `project-docs/architecture/agent-definition.md`의 "agent 정의의 `domains`와 `skills`", "place 정보에는 잘 안 바뀌는 목록만", "project place의 PM에게는 `Workflows folder:`", "lophn의 place 정보에는 domain 지도", `project-docs/architecture/workflow.md`("project의 `workflows/`는…"), `project-docs/architecture/kinds.md` "지키는 것"(kind 글, `Folder:` 줄), `project-docs/architecture/artifact.md` "쓰는 것은 그 domain을 맡은 agent뿐이다".
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`(이 module, 이름은 lead가 고친다), `lophn-agent`의 `agents`·`run-loop`·`agent-tools`. `project-docs/module-catalog.yaml`의 `packages/core/agent-roles` 줄 notes(지금 `agent-places`).
  - 코드(이 task가 고칠 것): `packages/core/agent-places/place/place-folders.ts`의 `PlaceFacts`·`placeScope`, `place-data.ts`의 `readPlaceData`·`placeData`·`ROLE_LINE`, `place-info.ts`의 `PlaceData`·`ROLE_LABEL`·`placeInfo`·`agentLines`, `instruction-rules.ts`의 `mayReadOtherProject`, `roles/prompts.ts`의 `rolePrompt`, `packages/core/main/daemon/place-folders-glue.ts`의 `placeFoldersOf`, `packages/core/main/daemon/agent-domains.ts`의 `agentDomainPorts`, `packages/core/apps/usage/ports.ts`의 `UsagePorts`, `packages/core/lophn-agent/instructions/files.ts`의 `SessionRow`·`InstructionReadDeps`·`readInstruction`, `instructions/turn.ts`의 `readTurnInstructions`, `extensions/skills.ts`의 `builtinForRole`·`discoverSkills`, `extensions/registry.ts`의 `ExtensionRegistry.skills`, `extensions/skill-read.ts`의 `createSkillSnapshot`·`turnSkillReader`, `extensions/skill-folders.ts`의 `registeredSkillEntries`, `commands/reads.ts`의 `CommandSession`, `register.ts`의 `agentLookups`·`globalSkillNames`·`chosenOf`·`createCommandReads` 조립, `prompt-assembly/model.ts`의 `TurnLayerKind`·`BlockedReason`·`PlaceAgent`, `basis.ts`의 `agentLine`, `turn-prompt.ts`의 `TurnPromptInput.role_prompt`·`CACHED`, `summary.ts`의 compact 요청 층, `run-loop/prepare.ts`의 `PreparerDeps.rolePrompt`·`skills`와 그 호출, `main/agent-runtime/product-driver.ts`의 `rolePrompt`·`skills`·`turnSkillReader` 꽂기.
  - 코드(읽기만): `packages/protocol/lophn-agent/places.ts`(`PlaceKind`, `placeKindOf`, `AgentId`, `AgentAtPlace`), `packages/protocol/lophn-agent/skill-settings.ts`(`BUILTIN_SKILLS[].places`), `packages/protocol/lophn-agent/agent-definitions.ts`(`agentList`, `AgentRow`), `packages/core/lophn-agent/agents/resolve.ts`(`workingDomains`, `ResolvedAgent.domains`), `packages/core/lophn-agent/session/model.ts`(`loadSession`, `placeOf`), `packages/core/apps/usage/{users,reads}.ts`, `packages/core/apps/calls/gate.ts`(`agentDomainsOf`).
- 계약:
  - 쓰는 것: `place-tools`의 `PlaceKind` 표와 harness port 이름. `contract-agent`의 `agentList`, `BUILTIN_SKILLS.places`. `contract-session`의 `agentCallSendable`(부를 수 있는 session 목록).
  - 내놓는 것:
    - file 범위(README "file 범위는 place 종류로 정한다"): home은 지금 lophn과 같다. project는 지금 PM 범위에서 domain 폴더를 받은 domain의 것으로 좁히고 `workflows/`를 쓴다. app은 지금 AE 범위에서 같은 방법으로 좁힌다. rewind 쓰기 폴더는 그릇의 domain 폴더 전부다.
    - 받는 domain: 정의의 `domains`가 비면 place 그릇의 active domain 전부, 있으면 그 가운데 그릇에 있는 것만(0개일 수 있다), home은 0개다. flow의 앱 tool 호출도 이 규칙을 쓴다.
    - harness port 이름: `placePrompt(kind)`(지금 `rolePrompt(role)`), `skills(place, kind)`. 지침 file은 이 task 동안 지금 `roles/<role>/prompt.md`를 home → lophn, project → project-manager, app → app-engineer로 고른다(`place-prompts`가 옮기고 다시 쓴다).
    - prompt 층 이름 `role`은 `place_kind`, turn prompt 입력 `role_prompt`는 `place_kind_prompt`다.
    - 부를 수 있는 agent 목록은 모든 agent(lophn과 사람이 만든 agent)이고 role 줄(`ROLE_LINE`, `ROLE_LABEL`)이 없다.

## 할 일

place 종류는 session의 place 하나로 정한다: `placeKindOf(place)`(null이면 `home`). 이 task의 어느 file도 role, agent 정의 꼴, `AgentRef`를 보고 가르지 않는다. 앞 task(`agents-core`, `sessions-core`, `place-tools`)가 이 task의 file에 남긴 넘길 줄(옛 role 값을 꾸며 넘기는 줄)은 여기서 지운다. 앞 task가 이미 바꾼 꼴(예: `ResolvedAgent`, `loadSession` 행, `UsagePorts`의 agent 꼴)은 그대로 쓴다.

1. **file 범위 규칙**(`packages/core/agent-places/place/place-folders.ts`). 근거: README "file 범위는 place 종류로 정한다", `place-session.md` file tool 범위 줄.
   - `PlaceFacts.role`을 지운다. 종류는 `facts.place`로 가른다. `domains` 항목은 `{ id, folder }`만 둔다(`artifactsFolder`는 범위에 더 쓰지 않는다).
   - `placeScope`:
     - home(`place === null`): `{ read: [...allProjectFolders], write: [] }`. 지금 lophn 갈래와 같다.
     - project: 사람의 project 폴더(position 순) + `facts.domains`의 폴더 + `workflowsFolder`(null이 아니면). read와 write가 같고 `base`는 지금 규칙(첫 사람 폴더, 없으면 `dataFolder`).
     - app: 앱 source(있으면) + `facts.domains`의 폴더. read와 write가 같고 `base`는 같은 규칙.
   - role 비교, Operator 갈래(`artifacts/`만 쓰기, 앱 source 읽기만), "서로의 place에서는 아무것도 열리지 않는다" 갈래를 지운다. 범위를 좁히는 것은 호출하는 쪽이 `facts.domains`에 무엇을 넣느냐다: turn은 받은 domain만(2번), rewind는 그릇의 domain 전부(9번).
   - 주석을 새 규칙으로 고친다(앱 data·release 사본과 `<data>/agents/`는 어느 place 종류에도 열지 않는다는 줄은 남긴다).
2. **turn의 범위와 place 정보 재료**(`place-data.ts`). 근거: README "받는 domain", `domain.md` turn 줄, `agent-definition.md` "place 정보에는 잘 안 바뀌는 목록만".
   - `ResolvedAgent`에서 `place`, `name`, `domains`만 읽는다. `role`, `agent`, `canonicalize`를 쓰지 않는다.
   - `place !== null`이면 그릇의 active domain 가운데 `resolved.domains`(받은 domain, `agents-core`의 `workingDomains` 결과)에 든 것만 domain 줄·kind 글·artifact 목록·`scopeDomains`에 넣는다. `PlaceDomain.folder`는 폴더를 만들었으면 늘 싣는다(Operator의 `folder: null` 갈래를 지운다).
   - home이면 지금 lophn 갈래(project·앱 목록, domain 지도, package, 모든 project 폴더 읽기)를 그대로 쓴다. 갈림 조건만 `role === "lophn"`에서 `place === null`로 바꾼다.
   - project place면 종류만 보고 `files.workflowsFolder`를 만들고(`ensureDir`) 범위와 place 정보에 싣는다(지금은 PM만). 근거: README "`workflows/`는 그 project place의 session이 쓴다".
   - 부를 수 있는 agent 목록: `agentList`(`contract-agent`)를 한 번 읽어 `issues`가 빈 줄의 `name`만 `PlaceAgent`로 싣는다. 자기 자신도 빼지 않는다(다른 place의 자기에게 call할 수 있다. 새 앱 흐름은 home의 lophn이 앱 place의 lophn을 부른다). `ROLE_LINE`, `callSendable` 읽기, `agentDefinitionList`, PM·AE 후보를 만들던 project·앱 목록 읽기와 `add`·`labelOf`를 지운다. 아래 "정한 것" 1.
   - `placeData(call, resolved, files)`는 `placeInfo(placeKindOf(resolved.place), place, KIND_TEXT_BUDGET)`를 부른다.
3. **place 정보 글**(`place-info.ts`). 근거: README "이름에서 role 낱말을 뺀다", 계약 "role 줄이 없다".
   - `ROLE_LABEL`을 지운다. `PlaceData.self`는 `{ name }`이고 첫 줄은 `You are <name>.`다. `Place:` 줄들은 그대로다(home은 `Place: none`).
   - `placeInfo(kind: PlaceKind, data, budget)`: home이면 Projects, Apps, domain 지도 절을 싣는다(지금 `role === "lophn"`). 나머지 절(Domains, Artifacts, Kinds)은 종류와 상관없이 data대로 싣는다.
   - `agentLines`: 머리 줄은 call 주소가 agent 이름과 place라는 것을 한 줄로 말한다(예: `Agents you can call (use the name as \`to.agent\` of a call; add \`place\` for a project or an app, none for no place)`). 줄은 `- <name>`이고 이름순이다.
   - 주석의 "PM만", "Operator에게는 열리지 않는다"를 place 종류 말로 고친다.
4. **prompt 조립의 이름**(`packages/core/lophn-agent/prompt-assembly/`). 근거: README "뼈대 검토" prompt 층 이름, 계약.
   - `model.ts`: `TurnLayerKind`의 `"role"`을 `"place_kind"`로, `BlockedReason`의 `"role_missing"`을 `"place_kind_missing"`으로("정한 것" 3). `PlaceAgent`는 `{ name: string }`이다.
   - `turn-prompt.ts`: `TurnPromptInput.role_prompt` → `place_kind_prompt`, `CACHED`와 층 목록의 `"role"` → `"place_kind"`, 막힘 message를 고친다.
   - `basis.ts`: `agentLine`은 이름만이다. `SeenBasis.agents` 주석도 고친다.
   - `summary.ts`: compact 요청의 층 이름을 `"place_kind"`로 바꾼다.
   - 넘길 줄: `tests/support/loop/harness.ts`(`role_prompt`), `tests/support/wire/binding.ts`·`tests/live/suite.ts`(`layer: "role"`).
5. **지침을 place 종류로 고르기**. 근거: 계약 harness port 이름, README "place 종류별 지침은 지금 role 지침에서 시작한다".
   - `packages/core/agent-places/roles/prompts.ts`: `rolePrompt(role)`을 `placePrompt(kind: PlaceKind)`로 바꾼다. home → `lophn/prompt.md`, project → `project-manager/prompt.md`, app → `app-engineer/prompt.md`. `operator/prompt.md`는 읽지 않는다(file 자체는 `place-prompts`가 옮기고 지운다). `PRODUCT_INSTRUCTIONS` 글과 file 자리는 건드리지 않는다.
   - `run-loop/prepare.ts`: `PreparerDeps.rolePrompt` → `placePrompt(kind: PlaceKind)`. `build()`는 `deps.placePrompt(placeKindOf(resolved.place))`의 글을 `place_kind_prompt`로 넣는다.
   - `main/agent-runtime/product-driver.ts`: `placePrompt`를 꽂는다.
   - 넘길 줄: `tests/eval/versions/components.ts`(`ROLE_SET`·`ROLES`를 protocol의 `PLACE_KINDS`로, `readRole`·`measureInstruction`·`roleByText`를 종류로, `placePrompt`로 읽는다. component 이름은 `instruction:home|project|app`이 된다. `VariantTexts.role_prompts` 칸 이름은 `tests/eval/versions/registry.ts` 것이라 그대로 두고 key만 종류다), `tests/eval/experiment/variant/texts.ts`(SCRIPT가 `placePrompt`와 종류 목록을 쓴다).
6. **지침 층 읽기 규칙**. 근거: `domain.md` "`DOMAIN.md`는 맡은 domain의 것만 읽는다", README "file 범위"의 home은 지금 lophn과 같다.
   - `instruction-rules.ts`: `mayReadOtherProject(kind: PlaceKind)` = `kind === "home"`. `mayReadDomain`은 그대로 둔다(그릇 규칙. 받은 domain 밖은 turn이 읽기 요청을 내지 않는다). `agentFilePathOf`는 `agents-core` 것이라 건드리지 않는다.
   - `instructions/files.ts`: `SessionRow`를 `{ agent: AgentId; place: Place | null }`로 바꾸고 `sessions-core`가 바꾼 `loadSession`·`placeOf`로 만든다. agent 층은 `agents-core`가 바꾼 `agentFilePathOf` 꼴로 부른다. 다른 project 읽기는 `deps.mayReadOtherProject(placeKindOf(session.place))`이고 거절 message는 `only a home session reads another project's instructions`다. `InstructionReadDeps`의 type과 주석("lophn만", "role")을 고친다.
   - `instructions/turn.ts`: `readTurnInstructions(deps, session: { kind: PlaceKind }, domains)`. project 층은 home일 때 비운다(지금 `role === "lophn"`). `prepare.ts`의 호출은 `{ kind: placeKindOf(session.place) }`다.
   - `wiring/instructions-registration.ts`: 주석의 "role 규칙"을 고친다.
   - `tests/e2e/file-write_test.ts`: 이 task가 `instruction-rules.ts`의 export를 바꿔 import가 깨질 때만 맞춘다. 그 밖(session 여는 꼴)은 `e2e-agents`가 고친다.
7. **내장 skill 고르기**. 근거: README "내장 skill은 place 종류로 준다", `contract-agent`의 `BUILTIN_SKILLS[].places`.
   - `extensions/skills.ts`: `builtinForRole(name, role)` → `builtinForPlace(name, kind: PlaceKind | null)`(`builtin.places`를 본다. null은 사람 화면이라 모두). `discoverSkills`의 options는 `{ kind: PlaceKind | null; off }`. 주석을 고친다.
   - `extensions/registry.ts`: `skills(place: AgentPlace, kind: PlaceKind | null)`, `skillKey`도 종류로.
   - `extensions/skill-read.ts`: `SkillSession.role` → `kind`. `turnSkillReader`의 session은 `{ id, place }`이고 종류는 `placeKindOf(place)`다.
   - `extensions/skill-folders.ts`: `registeredSkillEntries(machine, stores, kind)`.
   - `register.ts`: `agentLookups.skills`는 받은 place에서 `placeKindOf`로 종류를 정한다(place가 null이면 `globalSkillNames(sql, layers)`가 `"home"`으로 거른다). `AgentLookups`의 type(`packages/core/lophn-agent/agents/ports.ts`)은 `agents-core` 것이다. 아직 둘째 인자가 `Role`이면 type은 고치지 말고 구현에서 그 인자를 쓰지 않고 보고의 "계약 바꾸기 요청"에 적는다. `createCommandReads`의 skills와 `chosenOf`는 session의 `agent: AgentId`와 place로 고른 skill과 받는 domain을 낸다(받는 domain은 `agents-core`가 내놓은 place를 받는 셈을 쓴다).
   - `commands/reads.ts`: `CommandSession` = `{ agent: AgentId; place: Place | null }`. `commands/registry.ts`는 role 말이 없으면 그대로 둔다.
   - `prepare.ts`: `skills?(place, kind: PlaceKind)`과 두 호출(prompt skill 목록, resolve 전 skill 목록). `product-driver.ts`: `skills: (place, kind) => registeredSkillEntries(…, kind)`, `turnSkillReader`에 넘기는 session 꼴.
   - `wiring/lophn-agent-team.ts`·`secrets.ts`·`lophn-agent-extensions.ts`: `PROJECT_LAYER`·`BUNDLED_SKILLS_ROOT`는 이름이 그대로라 import는 그대로다. 주석의 "role 규칙", "role 층"만 고친다(`agent-places` 층).
8. **받는 domain을 쓰는 사용 관계와 호출 Gate**(`packages/core/main/daemon/agent-domains.ts`, `packages/core/apps/usage/ports.ts`). 근거: README "받는 domain", 계약 "flow의 앱 tool 호출도 이 규칙을 쓴다", `domain.md` "사용 관계의 쓰는 쪽"과 job·flow caller 줄.
   - `UsagePorts`의 끝 모양(`place-tools`가 이미 바꾼 칸은 그 꼴을 그대로 두고 없는 것만 더한다):
     - `sessionDomains(session): { kind: PlaceKind; domains: string[] } | null`: session의 place 종류와 그 session이 받는 domain.
     - `agentDomains(agent: AgentAtPlace): string[]`: 그 agent가 그 place에서 받는 domain. place가 null이면 `[]`, 아니면 `workingDomains(그릇의 active domain id, 정의의 domains)`. 정의를 못 찾으면 `[]`(막는 쪽). 정의는 `agents-core`가 내놓은 읽기로 찾는다(지금 `placeDepsOf(sql).operators.operator(id)`). job·flow caller의 Gate(`apps/calls/gate.ts`의 `agentDomainsOf`, `wiring/apps.ts`가 이 함수를 꽂는다)가 이 규칙을 쓴다.
     - `chosenDomains(agent: AgentId): string[]`: 정의의 `domains` 가운데 active domain. 고르지 않았으면 `[]`. 할당으로 세는 사용 관계가 쓴다("정한 것" 2).
     - `domainOf`는 그대로다.
   - `agentDomainPorts`의 `switch (agent.role)`와 PM·AE 갈래를 지운다.
   - `apps/usage/users.ts`의 할당 몫은 `ports.chosenDomains(agent)`를, `apps/usage/reads.ts`의 읽기 검사는 `ports.sessionDomains(actor.id)?.kind !== "home"`을 쓴다. 이 두 file은 아래 12번이다.
9. **rewind 쓰기 폴더**(`place-folders-glue.ts`). 근거: README "rewind의 쓰기 폴더는 지금처럼 그릇의 domain 폴더 전부로 넉넉히 잡는다".
   - `sessions`에서 `place_kind`, `place_id`만 읽는다(agent는 보지 않는다). 없는 session이면 `[]`. `facts.domains`는 그릇의 active domain 전부, `allProjectFolders`는 `[]`, 나머지 재료는 지금과 같고 `placeScope(facts).write`를 낸다. home은 `[]`다.
   - `ROLES` import와 "모르는 role이면" 갈래, Operator 주석을 지운다.
10. **자리 함수 정리**(`data-folder.ts`, `project-layer.ts`, `artifact-list.ts`).
    - `agents-core`가 정의를 `<data>/agents/<id>.md`로 옮긴 뒤 쓰는 곳이 없는 함수(`placeAgentsFolder` 등)를 지우고 `data-folder_test.ts`의 그 줄을 뺀다. 남은 자리는 test가 그대로 본다(사람 data의 자리가 바뀌면 설정을 잃는다).
    - `projectsDataArea`의 "사람의 agent 정의와 project 설정" 주석, `project-layer.ts`의 "role 몫" 주석을 고친다. `artifact-list.ts`는 role 말이 없으면 그대로 둔다.
11. **test**(write-test skill). 새 test file은 만들지 않는다. 있는 test를 새 규칙으로 고치거나 지운다.
    - `place-folders_test.ts`(위험 test): test 하나에 표로 본다. 이름 "place 종류마다 쓰기 폴더는 그 그릇의 폴더와 받은 domain 폴더뿐이다". home은 write `[]`이고 read는 모든 project 폴더, project는 project 폴더 + facts의 domain 폴더 + `workflows/`(앱 source 없음), app은 앱 source + facts의 domain 폴더(project 폴더·`workflows/` 없음), 폴더 없는 project는 base가 data 폴더. 지금의 Operator test 둘과 lophn test는 이 표로 합친다.
    - `place-info_test.ts`: 첫 test를 "받은 domain이 A뿐인 session의 place 정보와 쓰기 범위에는 A의 것만 있다"로 고친다(app place, `domains: [DOM_A]`: 쓰기는 `["/src/ledger", "/d/<DOM_A>"]`, 글에 beta·secret·b-page가 없다. 받은 domain이 둘이면 둘 다 있다). workflows test는 지운다(place-folders_test의 표가 본다). domain 지도 test(비공개 tool이 지도에 안 실린다)는 home session으로 바꿔 남긴다. fake 응답의 `/calls/sendable`는 빼고 `agentList` 응답을 넣는다.
    - `place-folders-glue_test.ts`(위험 test): "project·app session의 rewind 쓰기 폴더는 자기 그릇의 폴더와 그 그릇의 domain 폴더 전부뿐이다"로 고친다. `sessions` 표는 `sessions-core`의 열 꼴로 만들고, 다른 그릇의 domain·앱 source·project 폴더가 들어오지 않는 것과 home session이 `[]`인 것을 본다.
    - `instructions/read_test.ts`(경계 test): "home session만 다른 project의 LOPHN.md를 읽는다"로 고친다. session은 `sessions-core`가 바꾼 열 꼴로 넣는다(home, project A, project C, app). 표의 결과는 지금과 같다. domain 층 test는 열 꼴만 고친다.
    - `instructions/turn_test.ts`: 인자를 `{ kind: "project" }`로만 고친다.
    - `instruction-rules_test.ts`: `mayReadOtherProject` test를 지운다(한 줄 비교이고 read_test가 본다). `agentFilePathOf` test는 `agents-core` 것이라 둔다.
    - `extensions/skills_test.ts`: role로 쓴 경우를 종류로 바꾼다. "a skill that names a role…" test는 "내장 skill은 선언한 place 종류의 prompt와 `/` 메뉴에만 뜬다"로 고친다.
12. **소유 줄에 없는데 이 task의 바꿈으로 깨지는 file**(뼈대 검토 보고 대상). 띄우기 전에 lead가 소유에 넣는다. 넣지 않았으면 고치지 말고 보고의 "계약 바꾸기 요청"에 적는다.
    - `packages/core/lophn-agent/extensions/skills-handler.ts`(`discoverSkills`의 `{ role: null }` → `{ kind: null }`), `packages/core/lophn-agent/extensions/mod.ts`(`builtinForRole` 다시 내놓기).
    - `packages/core/lophn-agent/models/{binding_test,user-info_test}.ts`(`layer: "role"`).
    - `tests/eval/experiment/assembly/{prefix,prefix_test}.ts`(`prefix.ts`가 첫 층에 붙이는 이름 `"role"`이 제품의 `cache_boundaries[].after`와 같아야 test가 통과한다. `prefix_test.ts`의 `role_prompt`).
    - `tests/eval/versions/versions_test.ts`(`rolePrompt` import, `texts.role_prompts`의 key를 종류로).
    - `packages/core/apps/usage/{users,reads}.ts`(8번).

## 정한 것 (brief를 쓴 agent, 2026-10-28)

1. **place 정보의 agent 목록은 `agentList`의 이름뿐이다.** 열린 session과 place는 싣지 않는다. 이유: agent 이름이 전역에 하나라 주소 `{agent, place?}`에는 이름만 있으면 되고, place는 일이 어느 그릇의 것인지로 보내는 쪽이 정한다. 열린 session 목록은 자주 바뀌어 place 정보에 넣지 않는다는 규칙(`agent-definition.md`)과 맞는다. `callSendable`·`agentCallSendable`을 읽지 않으면 `router-core`가 먼저 합쳐졌는지에 기대지 않는다(계약 "쓰는 것"의 `agentCallSendable`은 쓰지 않는다).
2. **할당으로 세는 사용 관계는 정의가 `domains`로 고른 domain만 센다.** 이유: 정의가 전역이 되어 "고르지 않음"은 session을 연 place의 그릇 전부를 뜻하고 특정 domain을 가리키지 않는다. 그런 agent의 할당을 모든 domain의 사용으로 세면 lophn처럼 할당받은 agent 하나가 지도에서 모든 domain을 쓰는 쪽으로 나온다. 실제 호출(invocation)은 그 session이 받은 domain으로 그대로 센다.
3. **`BlockedReason`의 `role_missing`은 `place_kind_missing`이다.** 저장되지 않는 안쪽 값이고(`run-loop/turn.ts`는 `input_over_budget`만 가른다), 끝남 grep이 role 뜻을 남기지 않는다(README "뼈대 검토").
4. **`PlaceFacts`에서 role 칸을 빼고 종류를 `place`로 정한다.** 이유: 종류는 place에서 나오는 값이라 칸을 따로 두면 둘이 어긋날 수 있다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "place 종류별 file 범위: home session은 어느 폴더에도 쓰지 못하고, project·app session은 자기 그릇의 폴더와 받은 domain의 폴더(rewind는 그릇의 domain 폴더 전부) 밖에 쓰지 못한다". `place-folders_test.ts`, `place-info_test.ts`, `place-folders-glue_test.ts`의 위 이름 test가 있고 통과한다. 경계 test `instructions/read_test.ts`("home session만 다른 project의 LOPHN.md를 읽는다")와 `extensions/skills_test.ts`(내장 skill은 선언한 place 종류에만)는 옮겨 고쳐 통과한다.
- 남지 않음(모두 0줄):
  - `grep -rnw "Role\|ROLE_LINE\|ROLE_LABEL\|rolePrompt\|builtinForRole" packages/core/agent-places/place/{place-folders,place-data,place-info,instruction-rules,data-folder,project-layer}.ts packages/core/agent-places/roles/prompts.ts packages/core/lophn-agent/instructions packages/core/lophn-agent/extensions packages/core/lophn-agent/commands packages/core/lophn-agent/prompt-assembly packages/core/lophn-agent/run-loop/prepare.ts packages/core/lophn-agent/register.ts packages/core/main/agent-runtime/product-driver.ts packages/core/main/daemon/{agent-domains,place-folders-glue}.ts packages/core/apps/usage`
  - `grep -rn "role_prompt\|role_missing\|layer: \"role\"" packages tests/support tests/live tests/eval/experiment/assembly/prefix_test.ts`
  - `grep -rn '"role"' packages/core/lophn-agent/prompt-assembly tests/eval/experiment/assembly/prefix.ts`
  - `grep -rn "project_manager\|app_engineer\|\"operator\"" packages/core/agent-places/place/{place-folders,place-folders_test,place-data,place-info,place-info_test,instruction-rules_test}.ts packages/core/main/daemon/{agent-domains,place-folders-glue,place-folders-glue_test}.ts packages/core/lophn-agent/instructions packages/core/lophn-agent/extensions/skills_test.ts`
  - `grep -rn "Project Manager\|App Engineer\|Operator" packages/core/agent-places/place/{place-folders,place-data,place-info}.ts packages/core/main/daemon/{agent-domains,place-folders-glue}.ts packages/core/lophn-agent/instructions packages/core/lophn-agent/prompt-assembly packages/core/apps/usage/ports.ts`

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
