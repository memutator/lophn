# agents-core

agent 정의를 전역 하나의 꼴(`<data>/agents/<id>.md`, profile 이미지는 그 옆)로 바꾸고 새 `agents/*` route와 할당 route(`assignmentGet`·`assignmentSet`)를 구현한다. lophn은 고정 id의 내장 정의로 이름·profile을 바꾸지 못하고 지우지 못한다. project·앱을 등록할 때 agent를 만들지 않는다. tool `operator.create`·`operator.update`는 `agent.create`·`agent.update`가 된다.

- 단위: agents (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/agents`
  - `packages/core/agent-places/agents`
  - `packages/core/agent-places/tools/{operator,operator_test,operator-place,operator-place_test,mod}.ts` (operator tool을 옮기고 place 검사를 지운다)
  - `packages/core/agent-places/tools/{agent,agent_test}.ts` (새 file)
  - `packages/core/agent-places/tool-lists.ts` (tool 이름 둘만)
  - `packages/core/agent-places/place/{instruction-rules,instruction-rules_test}.ts` (정의 파일 자리 `agentFilePathOf`만)
  - `packages/core/approvals/assignment`
  - `packages/core/approvals/{approvals,ports}.ts` (넘길 줄: 할당 port의 agent)
  - `packages/core/apps/calls/gate.ts` (넘길 줄: 할당 port의 agent)
  - `packages/core/lophn-agent/extensions/{mcp-snapshot,mcp-toolkit,mcp-toolkit_test,mcp-tool-requests}.ts`
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
  - `packages/core/lophn-agent/tools/app-toolkit.ts` (넘길 줄: 할당 읽기)
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/main/daemon/wiring/{lophn-agent,lophn-agent-team,lophn-agent-registration,approvals,operator-mcp}.ts`
  - `packages/core/projects/{ports,register}.ts`
  - `packages/core/projects/registry/{commands,ports,registry_test}.ts`
  - `packages/core/main/tool-names_test.ts`
  - `tests/eval/versions/files.ts` (넘길 줄: tool file 경로)
  - `tests/e2e/file-write_test.ts` (넘길 줄: `agentFilePathOf`)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
  - `packages/core/approvals/gate/{judge,judge_test}.ts`
  - `packages/core/apps/usage/{users,users_test}.ts`
  - `packages/core/agent-places/place/place-info_test.ts`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "agent와 정의" 전부, "session과 place 종류"의 "받는 domain", "저장과 test", "뼈대 검토"(`AgentId`, `ROLE_TABLE`·`AgentRoleTable`, wave 2와 3을 함께 올린다). roadmap `project-docs/products/roadmap/remove-role.md` "지금 코드"의 "정의 자리", "자동 생성".
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-agent.md`(이 task가 쓰는 이름과 칸 전부. 특히 `RESERVED_DOMAIN_NAMES`에 `agent`를 더하고 `operator`를 남긴 것). 뒤 task brief `tasks/sessions-core.md`·`tasks/place-tools.md`·`tasks/place-scope.md`의 "내놓는 것"(이 task가 남긴 다리를 그들이 지운다).
  - architecture: `project-docs/architecture/agent-definition.md`의 "Profile", "지키는 것"의 "Operator 정의 층의 MCP server는…", "Operator 정의의 `skip`은…", "agent 정의는 lophn data에 있어 file tool이 닿지 않는다", "Operator 정의를 만들고 고치는 tool은 할당을 주지 못한다", "agent 정의의 `domains`와 `skills`는…". `project-docs/architecture/approval.md`의 "흐름" 할당 줄과 "지키는 것"의 "agent는 자기 할당을 넓히지 못한다", 할당 revision. `project-docs/architecture/domain.md`(받는 domain의 셈). `project-docs/architecture/layers.md`(core 층).
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent` › `agents`, `agent-roles`(이 module. 이름은 lead가 고친다), `approvals`, `projects`, `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`(지금 `agent-places`) notes, `packages/core/approvals`, `packages/core/projects`.
  - 규칙: `tools/check-deps.ts`. core 층은 바닥(`approvals` 등) < harness(`lophn-agent`) < `agent-places`·feature module(`apps`, `projects` 등) < `main`이고 아래 층은 위 층을 import하지 못한다. harness-domain 규칙은 `packages/core/lophn-agent/` 아래 test 아닌 file에 `"project_manager"`·`"app_engineer"`·`"operator"` 글을 막는다. `.claude/skills/write-test/SKILL.md`.
  - 코드(고칠 것). 지금 자리는 `packages/core/agent-roles/…`이고 wave 1 `agent-places-rename`이 file·export 이름을 그대로 `packages/core/agent-places/…`로 옮긴다. 아래는 옮긴 뒤 자리다.
    - 정의: `packages/core/lophn-agent/agents/`의 `store.ts`(`createAgentStore`, `AgentSlot`, `operatorIds`), `inspect.ts`(`AgentContext`, `Loaded`, `loadAgent`, `findOperator`, `listOperators`, `nameOf`, `profileOf`, `domainsOf`, `operatorIdOf`), `definition-file.ts`(`parseAgentFile`, `serializeAgentFile`, `checkDefinition`), `validate.ts`(`checkOperator`, `checkBuiltin`, `duplicateName`), `commands.ts`(`createAgentCommands`), `reads.ts`(`createAgentReads`, `rowOf`, `effectiveModel`), `resolve.ts`(`resolveAgent`, `ResolvedAgent`, `workingDomains`), `layers.ts`(`resolveTurnAgent`), `profile-asset.ts`, `ports.ts`(`AgentDeps`, `AgentLookups`, `PlaceLookups`), `caller.ts`(`agentCallerRule`), `role-table.ts`(`AgentRoleTable`), `mod.ts`, test 다섯(`commands_test`, `reads_test`, `resolve_test`, `definition-file_test`, `caller_test`).
    - role 층: `packages/core/agent-places/agents/{role-table,role-table_test,ensure,app-engineer,operator-directory}.ts`, `packages/core/agent-places/tools/{operator,operator_test,operator-place,operator-place_test,mod}.ts`, `packages/core/agent-places/tool-lists.ts`(`ROLE_WRITE_TOOLS`, `TOOL_ORDER`), `packages/core/agent-places/place/instruction-rules.ts`(`agentFilePathOf`).
    - 할당: `packages/core/approvals/assignment/{store,reads,commands,commands_test,usage,schema,registration}.ts`, `packages/core/apps/calls/gate.ts`(`CallGateDeps.assignmentOf`, `callAllowed`), `packages/core/main/daemon/wiring/approvals.ts`(`assignmentOf`), `packages/core/lophn-agent/tools/app-toolkit.ts`(`createAppToolkit`의 `assignment`).
    - MCP: `packages/core/lophn-agent/extensions/mcp-snapshot.ts`(`OperatorMcpEntry`, `McpSnapshotDeps.operators`), `mcp-toolkit.ts`(`McpToolkitDeps.operatorRef`, `operatorLayer`, `listTools`), `mcp-tool-requests.ts`, `packages/core/main/daemon/wiring/operator-mcp.ts`(`readOperatorMcp`).
    - 조립: `packages/core/lophn-agent/register.ts`(`LophnAgentPorts`, `createLophnAgent`, `agentDeps`, `operatorMcpServers`, `chosenOf`, `agentProfileHandlers`, 명령·읽기 목록, `uploadRoutes`, `files`), `packages/core/main/agent-runtime/product-driver.ts`(`callerDomains`, `productToolkit`, `createMcpToolkit`의 `operatorRef`, `roles: ROLE_TABLE`), `packages/core/main/daemon/wiring/{lophn-agent,lophn-agent-team,lophn-agent-registration}.ts`, `packages/core/lophn-agent/run-loop/runtime-access.ts`(`RUNTIME_MACHINE_ROUTES`).
    - project 등록: `packages/core/projects/ports.ts`(`ProjectManagerProvisioning`), `projects/registry/ports.ts`(`projectManagerProvisioningPort`), `projects/registry/commands.ts`(register의 `manager`), `projects/registry/registry_test.ts`(`setup`의 port와 `managers`), `projects/register.ts`(주석).
  - 코드(읽기만): `packages/protocol/lophn-agent/{places,agent-values,agent-definitions,operators,mcp-settings}.ts`, `packages/protocol/approvals/assignment.ts`(contract-agent가 더한 꼴), `packages/core/lophn-agent/places/{ports,unwired,mod}.ts`(`OperatorDirectory`, `OperatorInfo.place`, `UNWIRED_PLACE_DEPS`), `packages/core/lophn-agent/run-loop/prepare.ts`·`packages/core/lophn-agent/session/compactor.ts`(`resolveTurnAgent`에 `roles`를 넘긴다), `packages/core/agent-places/place/{place-data,data-folder}.ts`(`ResolvedAgent`를 읽는다, `lophnAgentsFolder`), `packages/core/main/daemon/wiring/{apps,secrets}.ts`(`loadAssignment`, `readOperatorMcp`를 꽂는다), `packages/core/apps/usage/users.ts`(`appAssignees`), `packages/core/approvals/gate/judge.ts`(`AgentAssignment`를 받는다), `packages/shell/main/desktop/core/routes.ts`(`AGENT_ASSIGNMENT_ROUTES`).
- 계약:
  - 쓰는 것: `contract-agent`의 `AgentId`, `LOPHN_AGENT_ID`, `LOPHN_AGENT_NAME`, `AgentDefinition`, `AGENT_ROUTES`(`agentList`, `agentRead`, `agentCreate`, `agentChange`, `agentDelete`, `agentProfileImageUpload`, `agentProfileImageRead`), `ASSIGNMENT_ROUTES`(`assignmentGet`, `assignmentSet`), 넓힌 `ListMcpTools.agent`.
  - 내놓는 것:
    - core 안 정의 읽기(`resolveAgent`, `loadAgent`와 그 port)는 `AgentId`로 받는다. 정의 자리는 모든 agent가 `<data>/agents/<id>.md`다. agent 이름은 전역에 하나이고 `lophn`은 예약이다. `ensureLophn`만 남고 PM·AE 정의 만들기(`projectManagerProvisioningPort`, `ensureProjectManager`, `withAppEngineer`)는 없다.
    - `ROLE_TABLE`·`AgentRoleTable`(정의 자리 규칙)은 role 칸이 없어진다. 남는 칸이 있으면 role 낱말을 뺀 이름으로 바꾸고 없으면 지운다(보고에 적는다).
    - 표 `agent_assignments.agent`는 `AgentId` 글이다. 할당, 정의 층 MCP server, `skip`은 사람만 정한다(agent가 `agent.create`·`agent.update`로 주면 거절).
    - 옛 `AgentRef`를 쥔 호출자(session 쪽, turn 길)는 임시 함수 `agentIdOfRef`(lophn → `"lophn"`, operator → 그 id, PM·AE → null)로 부른다. `packages/core/lophn-agent/agents/mod.ts`가 내놓고 `place-tools`가 마지막 사용처를 옮긴 뒤 지운다.
    - tool 이름 `agent.create`·`agent.update`. 어느 place 종류 목록에 드는지는 `place-tools`가 정한다(README: 셋 모두).
    - 등록할 것(lead): registry에서 `AGENT_DEFINITION_ROUTES`를 `AGENT_ROUTES`로, `AGENT_ASSIGNMENT_ROUTES`를 `ASSIGNMENT_ROUTES`로 바꾼다. 이 뒤로 옛 정의·할당 route를 부르는 화면, shell main 알림, e2e, eval은 wave 3까지 돌지 않는다.

## 할 일

agent를 가리키는 값은 `AgentId`(`"lophn"` 또는 `agt_…`)다. 정의 file은 모든 agent가 `<data>/agents/<id>.md`, 올린 이미지는 `<data>/agents/<id>/avatar.<ext>`다(README "정의 꼴은 하나다"). 이 task 동안 session은 아직 옛 꼴(`AgentRef`)이다. session 쪽은 `sessions-core`, turn 길은 `place-tools`가 옮긴다. 그 사이 옛 `AgentRef`를 쥔 곳은 아래 1번의 다리 하나만 쓴다.

1. **다리 `agentIdOfRef`**(계약 "내놓는 것"). `packages/core/lophn-agent/agents/mod.ts`가 내놓는다(작은 file을 새로 두고 mod.ts가 다시 내놓아도 된다).
   - `agentIdOfRef(ref: AgentRef): AgentId | null`: `role`이 `lophn`이면 `LOPHN_AGENT_ID`, `"agent" in ref`이면 `ref.agent`, 나머지(PM·AE)는 null.
   - harness file이라 role 이름 글(`"operator"` 등)을 쓰지 않고 위처럼 칸으로 가른다(`tools/check-deps.ts` harness-domain).
   - 쓰는 곳은 옛 `AgentRef`를 받는 자리뿐이다: `layers.ts`, `register.ts`의 `chosenOf`, `product-driver.ts`, `apps/calls/gate.ts`, `wiring/approvals.ts`. `approvals`는 바닥 층이라 harness를 import하지 못한다. 그래서 할당의 다리는 wiring에 둔다(7번).
2. **저장소와 읽기 모양**(`lophn-agent/agents/{store,inspect,ports}.ts`). 근거: README "정의 꼴은 하나다", "lophn은 고정 id를 가진 내장 정의다".
   - `store.ts`: 자리는 하나다. `createAgentStore(files, root)`. slot은 `{ folder: <root>/agents, file: <id>.md }`이고 `slotOf(id)` 같은 함수 하나로 만든다. `operatorIds(place)`를 `agentIds()`(그 폴더의 `agt_…`.md, 이름순)로 바꾼다. harness는 `agent-places/place/data-folder.ts`를 import하지 못하므로 `<root>/agents`는 store가 직접 만든다. `data-folder.ts`의 `placeAgentsFolder`·`lophnAgentsFolder`는 `place-scope`가 정리한다.
   - `inspect.ts`:
     - `AgentContext = { lookups, store }`. `Loaded = { agent: AgentId; slot; file; definition: AgentDefinition | null; issues }`(`ref`, `role`, `place`를 지운다).
     - `loadAgent(context, id)`: lophn은 file이 없어도 agent다(definition null). `agt_…`는 file이 없으면 null이다.
     - `listAgents(context)`: lophn이 첫 줄이고 `agentIds()` 순이다.
     - `nameOf(loaded)`: lophn은 `LOPHN_AGENT_NAME`, 나머지는 정의의 name(file이 틀렸으면 id). `profileOf(loaded)`: lophn은 `LOPHN_PROFILE`, 나머지는 정의의 profile, 없으면 `AGENT_DEFAULT_PROFILE`.
     - `domainsOf(context, loaded, place: Place | null)`: `workingDomains(lookups.domains(place), 정의의 domains)`. home(null)이면 `lookups.domains(null)`이 빈 목록이라 0개다(README "받는 domain").
     - `findOperator`, `listOperators`, `operatorIdOf`를 지운다.
     - profile 상수 `LOPHN_PROFILE`(`{ kind: "character", shape: "square", color: "coral" }`)과 `AGENT_DEFAULT_PROFILE`(`{ kind: "character", shape: "arch", color: "sage" }`)은 지금 `ROLE_TABLE`의 lophn·Operator 값이다. `inspect.ts`가 이미 `resolve.ts`를 import하므로 두 상수는 `resolve.ts`에 둔다(거꾸로 두면 순환이다).
   - `ports.ts`: `AgentDeps = { files, lookups(sql), dataRoot? }`(`roles`, `operatorPlaceAllowed`를 지운다). `AgentLookups`에서 쓰지 않게 된 칸(`places()` 등)을 지운다. `skills(place, role)`의 꼴은 `place-scope`가 바꾸므로 그대로 둔다. `PlaceLookups`도 쓰지 않게 된 칸만 지운다.
   - `caller.ts`·`caller_test.ts`(`agentCallerRule`)를 지운다. 근거: README "`operatorPlaceAllowed`는 지운다. 정의가 place에 속하지 않으니 검사할 그릇이 없다". agent 자격도 모든 정의를 읽고 만들고 고친다.
   - 새 `directory.ts`: `createAgentDirectory(open: (sql) => Result<AgentContext>)`는 `(sql) => AgentDirectory`를 낸다. `AgentDirectory = { agent(id: AgentId): AgentInfo | null; agents(): readonly AgentInfo[] }`, `AgentInfo = { id: AgentId; name: string; domains: readonly string[]; skip: boolean }`. lophn은 늘 있다. 틀린 file은 name이 id, domains가 빈 목록, skip이 false다(지금 Operator 조회와 같다). `mod.ts`가 내놓는다. `sessions-core`가 session 여는 검사와 이름 풀기에 쓴다. 이것이 `agent-places/agents/operator-directory.ts`를 대신한다(4번).
3. **정의 file 검사**(`definition-file.ts`, `validate.ts`). 근거: README "agent 이름은 전역에 하나이고 `lophn`은 예약이다", contract-agent `AgentDefinition`.
   - `definition-file.ts`: 꼴은 `agentDefinitionSchema` 하나다(`operatorDefinitionSchema`·`builtinDefinitionSchema`·`AgentRoleTable`을 쓰지 않는다). 검사 대상은 `{ agent: AgentId }`다.
     - lophn file은 name·profile 칸을 갖지 않는다. 있으면 그 칸이 `not_allowed`다. 읽을 때 name은 `LOPHN_AGENT_NAME`으로 채워 `AgentDefinition`을 낸다. 쓸 때는 name·profile을 빼고 쓴다(아래 "정한 것" 1).
     - lophn이 아닌 agent는 name이 필수이고, `agentNameKey(name) === agentNameKey(LOPHN_AGENT_NAME)`이면 `reserved_name`이다.
     - 본문은 누구도 필수가 아니다("정한 것" 2). 크기 상한 검사는 그대로다.
   - `validate.ts`: `checkOperator`·`checkBuiltin`을 하나(`checkAgent({ context, agent, definition })`)로 합친다(`definition-file.ts` 안의 `checkDefinition`과 이름이 겹치지 않게 한다). file 모양 검사 위에 이름 겹침만 더한다: `listAgents`의 다른 agent(틀린 file은 건너뛴다)와 `agentNameKey`가 같으면 `name` `duplicate`.
     - 정의의 `domains` id가 그릇에 있는지 보던 검사를 지운다("정한 것" 3).
4. **lophn 고정과 등록 때 만들기 지우기**. 근거: README "등록할 때 agent를 만들지 않는다", "뼈대 검토" `ROLE_TABLE`, 계약 "`ensureLophn`만 남고".
   - `agent-places/agents/ensure.ts`: `ensureLophn(deps)`만 남긴다. `<root>/agents/lophn.md`가 없으면 빈 file을 쓴다(지금과 같다). `ensureProjectManager`, `ensureAppEngineer`를 지운다. 새 `createAgentStore` 꼴을 쓴다.
   - `agent-places/agents/{app-engineer,role-table,role-table_test,operator-directory}.ts`를 지운다. `ROLE_TABLE`의 칸(이름, 기본 profile, 자리, 목록 순서, 예약 이름)은 모두 2·3번으로 옮겨 남는 칸이 없다. 보고의 "정한 것"에 "지웠다"고 적는다.
   - `lophn-agent/agents/role-table.ts`(`AgentRoleTable`)도 지운다. `prepare.ts`·`compactor.ts`가 이 type을 import한다. 11번을 본다.
   - project 등록: `projects/ports.ts`의 `ProjectManagerProvisioning`, `projects/registry/ports.ts`의 `projectManagerProvisioningPort`, `projects/registry/commands.ts` register의 port 읽기·`unwired("project manager")`·`manager.create`와 그 주석을 지운다. `registry_test.ts`의 `setup`에서 port와 `managers`, 두 test의 `managers` 판정을 뺀다. `projects/register.ts`의 "Project Manager를 만드는 port" 주석을 지운다. `projects/registry/mod.ts`의 re-export 한 줄은 지운 이름을 가리키던 줄이라 뺀다(orchestrate review의 예외).
   - `wiring/lophn-agent.ts`: `withAppEngineer`, `ensureAppEngineer`, `ROLE_TABLE`과 writer 감싸기를 지운다. `start`의 `ensureLophn`은 그대로다. `agentProfileHandlers(readers, root)`. uploads·fileStreams의 key는 `agentProfileImageUpload`·`agentProfileImageRead`다(resource·method가 옛 것과 같다).
   - `wiring/lophn-agent-registration.ts`: `projectManagerProvisioningPort`·`ensureProjectManager`와 그 port를 지운다(`createCoreRegistration`은 빈 `ports`를 낸다. 같은 file이 place 환경을 놓으므로 file은 둔다). `operators`에는 `UNWIRED_PLACE_DEPS.operators`(빈 조회)를 넣는다("정한 것" 5).
   - `wiring/lophn-agent-team.ts`: `operatorPlaceAllowed`, `ROLE_TABLE`, `createOperatorDirectory`를 지운다. `agentDirectory = createAgentDirectory(agent.openAgents)`와 `agentMcpServers`를 내놓는다.
5. **route 구현**(`commands.ts`, `reads.ts`, `profile-asset.ts`, `register.ts`). 근거: contract-agent `AGENT_ROUTES`, README "lophn은… 이름과 profile은 바꾸지 못하고, 지우지 못한다(`forbidden`)", "할당, 정의 층 MCP server, skip은 여전히 사람만 정한다".
   - `reads.ts`:
     - `agentList`(input `{}`): `listAgents` 순서로 `AgentRow`(`{ agent, name, profile, model, issues, counts }`). model은 정의 → 전역 기본이다(home이라 project 층이 없다). counts는 home에서 센다: skill은 `lookups.skills(null, "lophn")`, MCP는 `lookups.mcp(null)`에서 `mcp_off`를 뺀 수다("정한 것" 4).
     - `agentRead`(input `{ agent, place? }`): place가 있는데 없는 place면 `not_found`, agent가 없으면 `not_found`. `effective`: name(lophn은 source `global`, 나머지 `agent`), profile(정의에 있으면 `agent`, 아니면 `global`), model(정의 → place가 project면 project 층 → 전역), domains(`domainsOf(context, loaded, place ?? null)`). lophn은 file이 없으면 definition·hash가 null이다.
     - 부른 쪽 범위 검사(`agentCallerRule`)는 없다.
   - `commands.ts`: `agentCreate`·`agentChange`·`agentDelete` 셋이다(`changeBuiltin`을 지운다). 순서는 지금처럼 입력 검사 → CAS → 쓰기다.
     - create: `{ id, definition }`. 이미 있으면 `conflict`. `checkAgent` 뒤 쓰고 남은 `avatar.*`를 지운다.
     - change: `{ agent, definition }`, compare `hash`(lophn은 file이 없으면 null). 없는 agent는 `not_found`, hash가 다르면 `conflict`. lophn이면 `definition.name`이 `LOPHN_AGENT_NAME`이 아니거나 profile이 있고 `LOPHN_PROFILE`과 다르면 `forbidden` "lophn's name and profile are fixed"이고, 쓸 때 name·profile을 뺀다.
     - delete: lophn이면 `forbidden` "lophn cannot be deleted". 아니면 지금처럼 CAS 뒤 file과 `avatar.*`를 지운다.
     - 사람만 쓰는 칸: `parseActor(ctx.actor)?.kind === "agent"`이면 create에 `mcp_servers`나 `skip`이 있거나, change에서 두 칸이 저장된 값과 다르면 `forbidden`이다(contract-agent "agent가 주면 core가 거절한다"). agent tool은 저장된 값을 합쳐 보내므로 걸리지 않는다.
   - `profile-asset.ts`: `agentProfileImageUpload`·`agentProfileImageRead`(input `agent: AgentId`). 판정은 `agentRead`로 읽은 정의의 profile이다. lophn이면 `forbidden`(profile이 고정이다). 폴더는 `<root>/agents/<id>/`. `ProfileAssetDeps`에서 `roles`를 뺀다.
   - `register.ts`: `LophnAgentPorts`에서 `operatorPlaceAllowed`, `roles`를 지운다. 명령 목록은 `agentCommands.create, change, delete`, 읽기는 `agentReads.list, read`(writer·reader 두 목록 모두). `uploadRoutes`·`files`는 `agentProfileImageUpload`·`agentProfileImageRead`. `agentProfileHandlers(readers, dataRoot)`. `chosenOf(sql, agent: AgentRef, place)`는 `agentIdOfRef`로 id를 얻고(null이면 빈 값) `domainsOf(…, place)`를 쓴다. 부르는 곳은 `session.place`를 넘긴다. `discoverSkills`와 `extensionRegistry(...).skills`의 role 인자는 `place-scope`가 바꾸므로 그대로 둔다.
6. **resolve와 turn 읽기**(`resolve.ts`, `layers.ts`). 근거: 계약 "`resolveAgent`, `loadAgent`와 그 port는 `AgentId`로 받는다".
   - `resolveAgent` 입력: `agent: AgentId`, `role: Role`(그대로 `ResolvedAgent.role`에 담는다. `prepare.ts`·`place-data.ts`가 아직 읽고 `place-tools`가 place 종류에서 채운다), `place`, `definition: AgentDefinition | null`, model 층, `tools`, `environment: { skills, mcp, domains }`(`default_profile`과 `roles`를 지운다).
     - `rolePlaceFits` 검사를 지운다. `agt_…`인데 정의가 없으면 `not_found`.
     - name은 lophn이면 `LOPHN_AGENT_NAME`(source `global`), 나머지는 정의의 name(source `agent`). profile은 `profileOf`와 같은 규칙이다.
     - `ResolvedAgent.agent`는 `AgentId`다.
   - `layers.ts`의 `resolveTurnAgent`:
     - session은 지금처럼 옛 `agentSessionRead`로 읽는다(turn 길은 `place-tools`가 옮긴다).
     - `agentIdOfRef(session.agent)`가 null이면 `cannot("target_unavailable", "agent_missing")`.
     - 정의는 `agentRead`에 `{ agent: id, place }`(place가 null이면 칸을 뺀다)로 읽는다. `not_found`면 `agent_missing`, issues가 있으면 `agent_invalid`.
     - role은 `session.agent.role`, place는 `session.place`다. 정의 층 MCP server는 agent 누구든 정의의 `mcp_servers`다(lophn 포함).
     - 입력의 `roles`를 지운다(11번).
   - `runtime-access.ts`: `RUNTIME_MACHINE_ROUTES`의 `agentDefinitionRead`를 `agentRead`로, `agentAssignmentGet`을 `assignmentGet`으로 바꾼다(`assignmentGet`은 이름 글이 같다).
7. **할당**(`approvals/assignment`, `wiring/approvals.ts`, `apps/calls/gate.ts`, `tools/app-toolkit.ts`, `product-driver.ts`). 근거: 계약 "표 `agent_assignments.agent`는 `AgentId` 글이다", `approval.md` "agent는 자기 할당을 넓히지 못한다".
   - `store.ts`: key는 `AgentId` 글 그대로다(canonical JSON이 아니다). `loadAssignmentRow(sql, agent: AgentId)`, `loadAssignment(sql, agent: AgentId): Result<Assignment>`, `saveAssignment(tx, agent: AgentId, …)`. `schema.ts`는 SQL을 그대로 두고 머리 주석만 고친다. 개발 data는 지운다(AGENTS.md "호환성").
   - `reads.ts`·`commands.ts`·`registration.ts`: route는 `assignmentGet`·`assignmentSet`. 사람만 쓰는 검사는 그대로다.
   - `usage.ts`: `AppAssignee.agent: AgentId`. 줄의 agent는 `agentIdSchema`로 읽는다(JSON.parse를 하지 않는다).
   - `wiring/approvals.ts`의 `assignmentOf(agent: AgentRef)`: `agentIdOfRef`가 null이면 `ok({ agent, entries: [] })`, 아니면 `loadAssignment` 결과의 entries로 `{ agent, entries }`를 낸다. `approvals/{approvals,ports}.ts`는 옛 `AgentAssignment` 꼴을 그대로 받으므로 고치지 않는다(`place-tools`가 `AgentId`로 옮긴다).
   - `apps/calls/gate.ts`: `CallGateDeps.assignmentOf(agent: AgentId): Result<Assignment>`. 그러면 `wiring/apps.ts`의 `(agent) => loadAssignment(link.sql, agent)`가 고치지 않고 맞는다. 두 부르는 곳은 `agentIdOfRef(caller.agent)`로 id를 얻고 null이면 entries 없는 할당으로 판정한다. judge에 넘기는 꼴은 11번을 본다. 주석의 "PM"을 "flow instance의 creator"로 고친다.
   - `tools/app-toolkit.ts`: `assignment(agent: AgentRef): Promise<Result<Pick<Assignment, "entries">>>`. `product-driver.ts`는 `agentIdOfRef`로 id를 얻어 `assignmentGet`을 읽는다(null이면 entries 없음).
8. **정의 층 MCP server**(`extensions/{mcp-snapshot,mcp-toolkit,mcp-toolkit_test,mcp-tool-requests}.ts`, `register.ts`, `wiring/operator-mcp.ts`, `product-driver.ts`). 근거: `agent-definition.md` "Operator 정의 층의 MCP server는 그 Operator의 turn과 MCP 목록에만 닿는다"(Operator가 agent로 바뀐다), contract-agent "lophn도 정의 층 MCP server를 갖는다".
   - `OperatorMcpEntry`를 `AgentMcpEntry = { agent: AgentId; server: McpRuntimeServer }`로 바꾼다. 정의가 전역이라 server는 `runtimeServerOfLayer(server, null)`로 만든다.
   - `register.ts`의 `operatorMcpServers`를 `agentMcpServers`로 바꾼다. `listAgents`의 모든 agent(lophn 포함)를 보고 틀린 file은 건너뛴다.
   - `mcp-snapshot.ts`의 `operators?` 칸 이름과 `wiring/operator-mcp.ts`의 `readOperatorMcp` 이름은 `wiring/secrets.ts`(place-scope 소유)가 부르므로 그대로 둔다. 값의 type만 바뀐다. 이름을 남긴 까닭을 보고의 "넘길 줄"에 적는다.
   - `mcp-toolkit.ts`: `McpToolkitDeps.operatorRef`를 지운다. 정의 층 읽기는 `agentRead`에 `{ agent }`. `listTools(place, agent: AgentId | null)`. `product-driver.ts`의 `createMcpToolkit`에서 `operatorRef`를 뺀다.
   - `mcp-toolkit_test.ts`: deps의 `operatorRef`를 빼고 test 이름의 "Operator"를 "agent"로 바꾼다(판정은 그대로).
   - `mcp-tool-requests.ts`: contract-agent가 type을 넓혔다. 남은 Operator 주석만 고친다.
9. **tool**(`agent-places/tools/*`, `agent-places/tool-lists.ts`, `tests/eval/versions/files.ts`). 근거: README "`operator.create`·`operator.update`는 `agent.create`·`agent.update`가 된다", `agent-definition.md` "Operator 정의를 만들고 고치는 tool은 할당을 주지 못한다".
   - 새 `agent.ts`의 `AGENT_TOOLS`(`operator.ts`의 손질을 옮긴다).
     - `agent.create`: 입력은 `agentDefinitionSchema`에서 `mcp_servers`·`skip`을 빼고 `domains`를 이름 목록(`domainNameSchema[]`)으로 바꾼 strict 꼴이다(name, profile, model, skills, domains, mcp_off, body). place 칸이 없다. routes `[domainList, agentCreate]`. domain 이름은 `domainList`에 `{ status: "active" }`(owner 없이)로 읽어 이름으로 id를 찾는다. 자격이 보는 domain만 나온다(`domains/reads.ts`의 `visible`). 없으면 `invalid` "domain <name> not found". id는 `ctx.ids.newId("agt")`.
     - `agent.update`(`defer: true`): 입력은 `agent`(바꿀 agent의 이름)와 고칠 칸(profile, model, skills, domains, mcp_off, body)의 partial이다. 이름 바꾸기는 없다(지금 `operator.update`와 같다). routes `[agentList, agentRead, domainList, agentChange]`. `agentList`에서 `agentNameKey`가 같은 줄을 찾고(없으면 `not_found`), `agentRead`로 정의와 hash를 읽어(틀린 file이면 `invalid`), 보낸 칸만 덮어 `agentChange`에 보낸다. lophn은 file이 없으면 정의 `{ name: "lophn", body: "" }`, hash null에서 시작한다.
     - 설명은 role과 place 말 없이 짧게 쓴다(예: "Create an agent. Give its name, profile, model, skills, domains (domain names), mcp_off and instructions (body). Its grants, MCP servers and skip default are set by the person."). 글 다듬기는 `place-prompts`가 한다.
   - `operator.ts`, `operator_test.ts`, `operator-place.ts`, `operator-place_test.ts`를 지운다. `mod.ts`는 `OPERATOR_TOOLS` 대신 `AGENT_TOOLS`를 모은다. export 이름 `ROLE_AGENT_TOOLS`는 `main/agent-tools.ts`(place-tools 소유)가 import하므로 그대로 둔다.
   - `tool-lists.ts`: `ROLE_WRITE_TOOLS`와 `TOOL_ORDER`의 `operator.create`·`operator.update`를 `agent.create`·`agent.update`로 바꾼다. 목록의 모양은 `place-tools`가 바꾼다. `RESERVED_DOMAIN_NAMES`에 `agent`가 있어 `main/tool-names_test.ts`가 그대로 통과한다.
   - `tests/eval/versions/files.ts`: `TOOL_FILES`의 `agent-places/tools/operator.ts`를 `agent.ts`로 바꾼다(`versions_test.ts`가 tool 정의 file을 찾는다).
10. **정의 file 자리**(`agent-places/place/{instruction-rules,instruction-rules_test}.ts`, `tests/e2e/file-write_test.ts`). 근거: README "자리는 `<data>/agents/<id>.md`".
    - `agentFilePathOf(root, session: { role, operator, place })`의 꼴은 그대로 둔다(`lophn-agent/instructions/files.ts`가 그 꼴로 넘긴다). lophn이면 `<root>/agents/lophn.md`, operator id가 있으면 `<root>/agents/<id>.md`, 그 밖은 null이다. `ROLE_TABLE`, `rolePlaceFits`, `agentRefOfColumns` import를 지운다.
    - `instruction-rules_test.ts`의 "정의 file 경로" test를 지운다(한 줄 변환). `mayReadOtherProject` test는 `place-scope` 것이라 둔다.
    - `tests/e2e/file-write_test.ts`: 쓰기를 막아야 하는 정의 file 경로를 lophn 것(`agentFilePathOf(run.home, { role: "lophn", operator: null, place: null })`)으로 바꾼다. 그 밖(session 여는 꼴)은 `e2e-agents`가 고친다.
11. **소유 줄에 없는데 이 task의 바꿈으로 깨지는 file**(뼈대 검토 보고 대상). 띄우기 전에 lead가 소유에 넣는다. 넣지 않았으면 그 file은 고치지 않는다. 대안이 적힌 줄은 그 대안으로 가고, 대안이 없는 줄(`users.ts`, `users_test.ts`, `place-info_test.ts`)은 check가 깨지므로 할 수 있는 데까지 하고 commit 없이 보고한다. 어느 쪽이든 보고의 "계약 바꾸기 요청"에 적는다.
    - `packages/core/lophn-agent/run-loop/prepare.ts`, `packages/core/lophn-agent/session/compactor.ts`: `AgentRoleTable` import, deps의 `roles` 칸, `resolveTurnAgent`에 넘기는 `roles:` 한 줄을 지운다. product-driver가 넘기던 `roles: ROLE_TABLE`도 지운다. 대안: `lophn-agent/agents/role-table.ts`와 `agent-places/agents/role-table.ts`를 지우지 않고 `resolveTurnAgent`의 `roles` 입력을 읽지 않은 채 둔다.
    - `packages/core/approvals/gate/judge.ts`: 할당 인자를 `Pick<Assignment, "entries"> | null`로 넓힌다(entries만 읽는다. `judge_test.ts`는 그대로 맞는다). 대안: `gate.ts`에서 `{ agent: caller.agent, entries }`로 감싸 넘긴다.
    - `packages/core/apps/usage/users.ts`: `ports.agentDomains`(아직 `AgentRef`를 받는다)에 넘길 값을 id에서 만든다(`LOPHN_AGENT_ID`면 `{ role: "lophn" }`, 아니면 `{ role: "operator", agent }`. 이 file은 harness가 아니다). `place-tools`·`place-scope`가 지운다.
    - `packages/core/apps/usage/users_test.ts`: `grant`가 넣는 할당 줄의 agent를 id 글(`agt_…`, `lophn`)로 바꾸고 대역 `agentDomains`의 판정을 그에 맞춘다. 판정 결과는 그대로다.
    - `packages/core/agent-places/place/place-info_test.ts` 236줄: `agent: { role: "project_manager", project: PRJ }`를 `as ResolvedAgent`로 바꾸는 줄이 `ResolvedAgent.agent`가 `AgentId`가 되어 type이 맞지 않는다. 그 칸을 `"lophn"`으로 바꾼다(그 test는 `role`과 `place`만 본다).
12. 이름을 지우거나 바꾼 뒤 `grep -rn`으로 주석과 오류 글에 남은 것을 고친다. route는 method 글(`"agent-definitions"`, `"operators"`, `"builtin-agents"`)로도 찾는다. 화면·e2e·eval의 옛 route 호출은 wave 3이 옮긴다(고치지 않는다).
13. 보고의 "등록할 것"에 적는다(계약 "등록할 것(lead)"의 자리): `packages/protocol/lophn-agent/registry.ts`의 `...AGENT_DEFINITION_ROUTES`를 `...AGENT_ROUTES`로, `packages/shell/main/desktop/core/routes.ts`의 `AGENT_ASSIGNMENT_ROUTES`를 `ASSIGNMENT_ROUTES`로. core는 handler가 단 route로 등록하므로(`main/daemon/registration.ts`의 `assemble`) 이 교체 없이도 worktree의 check와 core 기동이 돈다. 이 file들은 고치지 않는다(orchestrate 병렬 규칙 3).

## 정한 것 (brief를 쓴 agent, 2026-10-28)

1. **lophn 정의 file에는 name·profile 칸을 쓰지 않는다.** 읽을 때 name은 `LOPHN_AGENT_NAME`, profile은 `LOPHN_PROFILE`로 채운다. 이유: README "lophn은 `<data>/agents/lophn.md` 그대로다", "이름과 profile은 바꾸지 못한다". 칸이 없으면 지금 lophn file(빈 file이거나 model·skills·본문만)이 그대로 맞고 `ensureLophn`이 지금처럼 빈 file을 만든다.
2. **정의 본문은 어느 agent에서도 비어도 된다.** 이유: 정의 꼴이 하나이고(README "나머지 칸은 다른 agent와 같다") lophn의 기본 본문이 비어 있다. 일하는 규칙은 place 종류 지침이 준다.
3. **저장 때 `domains`의 id가 어느 그릇에 있는지 보지 않는다.** 이유: 정의가 전역이라 견줄 그릇이 없고, 받는 domain은 session place 그릇과의 교집합이라 다른 그릇의 id는 받지 않는다(README "받는 domain"). tool은 이름을 그 session이 보는 active domain에서 찾는다.
4. **목록(`agentList`)의 skill·MCP 수와 model은 home에서 센다.** 이유: 정의가 전역이라 목록 줄에 place가 없다. place마다의 값은 `agentRead`의 `place`로 읽는다.
5. **옛 `OperatorDirectory`(`PlaceDeps.operators`)는 빈 조회로 꽂는다.** 이유: `OperatorInfo.place`를 채울 값이 없다(정의에 place가 없다). 새 조회 `createAgentDirectory`는 `sessions-core`가 여는 검사와 이름 풀기로 옮긴다. 옛 칸 자체는 `jobs-registration.ts`가 아직 읽어 `cleanup-core`가 지운다.
6. **사람만 쓰는 칸(`mcp_servers`, `skip`)은 tool 입력에 없고 core command도 agent 자격이면 거절한다.** 이유: contract-agent "agent가 주면 core가 거절한다". tool 입력에서 빼는 것은 model이 칸을 보지 않게 하려는 것이다.
7. **`agent.update`는 이름을 바꾸지 않는다.** 이유: 지금 `operator.update`처럼 이름이 찾는 열쇠다. 이름 바꾸기는 사람이 Agents 탭에서 한다.

## 끝남

- `npm run check`가 통과한다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/lophn-agent/agents/*_test.ts packages/core/agent-places/tools/*_test.ts packages/core/approvals/assignment/commands_test.ts packages/core/lophn-agent/extensions/mcp-toolkit_test.ts packages/core/projects/registry/registry_test.ts packages/core/main/tool-names_test.ts packages/core/apps/usage/users_test.ts packages/core/agent-places/place/place-info_test.ts`
- 위험 test(README "저장과 test"의 셋에는 들지 않는다. 권한 경계와 사용자 data라 있는 test를 옮겨 고친다):
  - `lophn-agent/agents/commands_test.ts`의 첫 test를 고친다: "lophn은 지우거나 이름·profile을 바꿀 수 없고, agent 이름은 전역에 하나이며, agent 자격은 `mcp_servers`·`skip`을 넣지 못한다". 준비를 한 번 하고 표로 본다: lophn 지우기 `forbidden`, lophn 이름 바꾸기 `forbidden`, `lophn`·` LOPHN `이라는 이름으로 만들기 `invalid_input`(`reserved_name`), 이미 있는 이름(대소문자만 다름)으로 만들기 `invalid_input`(`duplicate`), agent 자격으로 `skip: true`를 넣어 만들기 `forbidden`. 거절된 경우 file이 생기거나 바뀌지 않는다.
  - 같은 file의 "옛 hash로 고치면 충돌이고 파일은 그대로다"는 새 꼴로 고친다. "정의가 그 place 그릇의 것이 아닌 domain id를 고르면 저장이 거절된다"는 지운다("정한 것" 3).
  - `agent-places/tools/agent_test.ts`(옮긴 `operator_test.ts`): "agent.create·agent.update 입력은 `skip`과 `mcp_servers`를 받지 않는다". 두 tool × 두 칸을 표로 본다.
  - `approvals/assignment/commands_test.ts`의 "사람이 아닌 자격으로 SetAgentAssignment를 부르면 forbidden이다"는 입력의 agent만 `"lophn"`으로 고친다.
  - `resolve_test.ts`의 두 test(정의에 tool을 적어도 tool 목록은 받은 그대로다, domain 하나를 고르면 다른 domain의 skill을 받지 않는다), `reads_test.ts`(model 출처 순서), `definition-file_test.ts`(profile 보존)는 `AgentId` 꼴로 고친다. 새 test file은 `agent_test.ts`만이다.
- 남지 않음(모두 0줄):
  - `grep -rnw "ROLE_TABLE\|AgentRoleTable\|operatorPlaceAllowed\|agentCallerRule\|projectManagerProvisioningPort\|ProjectManagerProvisioning\|ensureProjectManager\|ensureAppEngineer\|withAppEngineer\|createOperatorDirectory\|operatorRef\|findOperator\|listOperators\|operatorIdOf\|checkOperator\|checkBuiltin\|builtinAgentChange\|operatorCreate\|operatorChange\|operatorDelete\|agentDefinitionRead\|agentDefinitionList\|agentAssignmentGet\|agentAssignmentSet\|OperatorMcpEntry\|operatorMcpServers" packages/core/lophn-agent/agents packages/core/agent-places/agents packages/core/agent-places/tools packages/core/approvals packages/core/projects packages/core/lophn-agent/register.ts packages/core/lophn-agent/extensions packages/core/lophn-agent/run-loop/runtime-access.ts packages/core/lophn-agent/tools/app-toolkit.ts packages/core/main/agent-runtime/product-driver.ts packages/core/main/daemon/wiring/{lophn-agent,lophn-agent-team,lophn-agent-registration,approvals,operator-mcp}.ts packages/core/apps/calls/gate.ts` (11번의 대안으로 갔으면 남긴 줄과 보고)
  - `grep -rn "operator\.create\|operator\.update\|operator_create\|operator_update" packages/core/agent-places/tools packages/core/agent-places/tool-lists.ts tests/eval/versions/files.ts`
  - `grep -rn "project-manager\.md\|app-engineer\.md\|Project Manager\|App Engineer" packages/core/lophn-agent/agents packages/core/agent-places/agents packages/core/agent-places/place/instruction-rules.ts packages/core/projects packages/core/main/daemon/wiring/{lophn-agent,lophn-agent-registration}.ts`
  - `ls packages/core/agent-places/agents`가 `ensure.ts` 하나만 낸다.
- 합친 뒤 plan branch에서 안 되는 것(보고의 "알려진 미완 동작"에 적는다. 뒤 task가 고친다): 옛 Operator session 열기와 이름 풀기(`sessions-core`, `router-core`), PM·AE session의 turn(정의가 없어 `agent_missing`), agent 자격의 place 정보 읽기(`agentList`가 상한에 없다: `place-tools`의 `PLACE_READS`, `place-scope`), 화면·shell 알림·e2e·eval의 옛 정의·할당 route(wave 3).

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
