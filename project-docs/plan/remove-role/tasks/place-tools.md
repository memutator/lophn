# place-tools

turn 길을 (agent id, place, place 종류)로 옮긴다: place 종류 셋의 tool 목록, credential 상한, preview·publish 검사, tool 호출자 정체, 할당 읽기. turn 길에 남은 `AgentRef`·`Role`의 마지막 사용처를 옮기고 `agentIdOfRef`를 지운다.

- 단위: places (wave 2)
- 선행: sessions-core. turn 길이 `PlaceSession`을 읽는다.
- 소유(이 task만 고친다):
  - `packages/core/agent-places/{tool-lists,tool-lists_test,credentials,hooks}.ts`
  - `packages/core/agent-places/tools/{kind,kind_test,instructions,settings,mod}.ts`
  - `packages/core/lophn-agent/run-loop/{prepare,prepare_test,credentials,agent-credentials,runtime,runtime-access}.ts`
  - `packages/core/lophn-agent/tools/{tool-context,app-toolkit,app-public,app-public_test,registry_test}.ts`
  - `packages/core/lophn-agent/tool-judgment/tool-gate.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
  - `packages/core/lophn-agent/agents/{mod,layers}.ts` (`agentIdOfRef`를 지운다)
  - `packages/core/lophn-agent/extensions/mcp-toolkit.ts`
  - `packages/core/approvals/{approvals,ports}.ts`
  - `packages/core/apps/calls/{caller,gate,service,calls_test}.ts`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/usage/{ports,users_test}.ts`
  - `packages/core/apps/packages/publish.ts`
  - `packages/core/main/agent-runtime/{main,product-driver}.ts`
  - `packages/core/main/{agent-tools,agent-tools_test,tool-names_test}.ts`
  - `packages/core/main/daemon/wiring/{lophn-agent-runtime,approvals}.ts`
  - `tests/live/suite.ts` (넘길 줄: tool 목록 함수)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/lophn-agent/session/caller-directory.ts`
  - `packages/core/main/daemon/agent-domains.ts`
  - `packages/core/apps/usage/{users,reads}.ts`
  - `packages/core/main/daemon/wiring/runs.ts`
  - `packages/core/lophn-agent/tools/bundles/shell_test.ts`
  - `packages/core/main/daemon/wiring/approvals_test.ts`
  - `packages/core/approvals/gate/{judge,judge_test}.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "session과 place 종류"("tool 목록 셋은 지금 role 목록에서 나온다", "credential 상한은 place 종류 목록의 route 합이다", preview 호출 검사), "저장과 test"(위험 test "credential 조건"), "뼈대 검토"(`sessions-core`와 `place-tools`는 이어서 합친다). roadmap `project-docs/products/roadmap/remove-role.md` "지금 코드" › "tool 목록"과 "credential".
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-agent.md`(`PlaceKind`, `PLACE_KINDS`, `placeKindOf`, `AgentAtPlace`, `assignmentGet`, `agentList`, `agentRead`), `tasks/contract-session.md`(`placeSessionRead`, `PlaceSession`, `agentCallSendable`). 앞 task `tasks/agents-core.md`(`agentIdOfRef`, `agent.create`·`agent.update`, `ResolvedAgent.role`, `loadAssignment(sql, AgentId)`, 11번 대안을 썼는지), `tasks/sessions-core.md`(`agentRefOfId`·`agentRefOf` 다리, `PlaceDeps.agents`). 같은 wave의 `tasks/runs-core.md` 5번(`CallAuth`를 만드는 `wiring/runs.ts`)과 뒤 task `tasks/place-scope.md`(이 task가 남긴 옛 role 넘김을 지운다). 앞 task가 실제로 바꾼 것은 plan branch에서 `git log --oneline main..HEAD`와 그 diff로 본다.
  - architecture: `project-docs/architecture/agent-definition.md` "지키는 것"의 "role의 tool 목록은 코드가 고정하고…", "모든 앱의 tool 목록을 읽는 tool(`app.tools`)은…", "앱을 진단하는 읽기 tool은…", "agent credential의 operation 상한은 tool이 core에 부르는 route 이름이다". `project-docs/architecture/app-call.md` "지키는 것"(부른 쪽 확인, program·flow caller의 할당과 domain 거르기). `project-docs/architecture/approval.md` "흐름"(judge가 session의 agent와 place, 할당을 읽는다). `project-docs/architecture/domain.md`(받는 domain).
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`(이 module, 이름은 lead가 고친다), `lophn-agent` › `run-loop`·`agent-tools`, `approvals`, `apps`, `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`(지금 `agent-places`) notes.
  - 규칙: `tools/check-deps.ts`의 harness-domain(`packages/core/lophn-agent/` 아래 test 아닌 file에 `"project_manager"`·`"app_engineer"`·`"operator"` 글을 쓰지 못한다)과 core 층(`approvals`는 harness를 import하지 못한다). `.claude/skills/write-test/SKILL.md`.
  - 코드(고칠 것). `agent-roles`는 wave 1이 `agent-places`로 옮겼다. 아래는 옮긴 뒤 자리다.
    - 목록과 상한: `packages/core/agent-places/tool-lists.ts`(`builtinToolNames`, `ROLE_WRITE_TOOLS`, `TOOL_ORDER`), `tool-lists_test.ts`, `credentials.ts`(`roleOperations`, `PLACE_READS`, `agentConditions`), `hooks.ts`(주석), `tools/mod.ts`(`ROLE_AGENT_TOOLS`), `packages/core/main/agent-tools.ts`, `agent-tools_test.ts`
    - credential 길: `packages/core/lophn-agent/run-loop/credentials.ts`(`TurnCredentialOptions.operations`, `TurnCredentials.open`, `BeginTurnInput.role`, `beginTurn`), `run-loop/agent-credentials.ts`(`createAgentCredentialLink`의 `operationsFor`·`conditionsFor`, session 읽기), `run-loop/runtime.ts`(machine 읽기 목록, `operationsFor`), `packages/core/main/agent-runtime/main.ts`(`createTurnCredentials`), `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(`operations`, `startAgentRuntimeChild`)
    - turn 준비: `run-loop/prepare.ts`(`PreparerDeps.roleTools`·`roles`·`rolePrompt`·`skills`, `prepare`의 session 읽기, `ToolContext` 만들기, `apiKit.load`, `readTurnInstructions` 호출, basis, `BeginTurnInput`), `session/compactor.ts`(`CompactorDeps.roleTools`·`roles`, `summaryChoice`), `agents/{mod,layers}.ts`(`agentIdOfRef`, `resolveTurnAgent`), `packages/core/main/agent-runtime/product-driver.ts`(`roleTools`, `roles`, `callerDomains`, `assignment`, `turnSkillReader`에 넘기는 session)
    - tool 맥락과 Gate: `lophn-agent/tools/tool-context.ts`(`ToolContext.agent`·`role`), `tools/app-toolkit.ts`(`AppToolkit.load`, `assignment`), `tools/app-public.ts`(`callerDomains`), `tool-judgment/tool-gate.ts`(`ToolGateCall.agent`), `packages/core/approvals/{approvals,ports}.ts`(`ApprovalsDeps.assignmentOf`, `Approvals.judge`의 `who.agent`), `packages/core/main/daemon/wiring/approvals.ts`(`assignmentOf`, `sessionOf`)
    - 앱 호출: `packages/core/apps/calls/caller.ts`(`CallAuth`, `VerifiedCaller`, `verifyCaller`의 preview 검사 106줄), `calls/gate.ts`(`CallGateDeps`, `callAllowed`), `calls/service.ts`, `packages/core/apps/ports.ts`(`CallerDirectory`, `AppToolCallPath` 주석), `packages/core/apps/usage/ports.ts`(`UsagePorts.agentDomains`), `packages/core/apps/packages/publish.ts`(57~63줄)
    - test: `tool-lists_test.ts`, `agent-tools_test.ts`, `tools/kind_test.ts`, `lophn-agent/tools/{registry_test,app-public_test}.ts`, `run-loop/prepare_test.ts`, `apps/calls/calls_test.ts`, `apps/usage/users_test.ts`, `tests/live/suite.ts`(`builtinToolNames("project_manager")`)
  - 코드(읽기만): `packages/core/lophn-agent/agents/resolve.ts`(`ResolvedAgent.role`은 agents-core가 남겼다), `packages/core/agent-places/place/place-data.ts`(`ResolvedAgent.role`을 읽는다), `packages/core/lophn-agent/instructions/turn.ts`(`readTurnInstructions`의 `{ role }`), `packages/core/lophn-agent/extensions/skill-read.ts`(`turnSkillReader`의 session 꼴), `packages/core/lophn-agent/session/caller-directory.ts`, `packages/core/main/daemon/{agent-domains.ts,wiring/apps.ts,wiring/runs.ts}`, `packages/core/apps/usage/users.ts`, `packages/core/approvals/gate/judge.ts`, `packages/core/storage/ledger/target-authorization.ts`(`conditions.app`이 다른 앱의 target을 막는다).
- 계약:
  - 쓰는 것: `contract-agent`의 `PlaceKind`, `placeKindOf`, `AgentId`, `AgentAtPlace`, `assignmentGet`. `sessions-core`의 `PlaceSession` 읽기. `agents-core`의 `AgentId` 정의 읽기와 tool 이름 `agent.create`·`agent.update`.
  - 내놓는 것:
    - place 종류 표(`packages/core/agent-places/tool-lists.ts`): `placeToolNames(kind: PlaceKind)`. home은 지금 lophn 목록, project는 PM 목록, app은 AE 목록에서 시작하고 셋 모두 job tool 넷과 `agent.create`·`agent.update`를 받는다(`workflow.check`는 project). credential 상한은 `placeOperations(kind)` = 그 목록 route의 합이고 조건은 지금처럼 session place에서 나온다.
    - harness port 이름: `placeTools(kind)`, `operationsFor(kind)`(지금 `roleTools(role)`, `operationsFor(role)`). tool 실행 context는 `{ agent: AgentId, place: Place | null, kind: PlaceKind }`를 싣는다. `place-scope`와 `place-prompts`는 이 이름에 기댄다.
    - preview 호출과 `package.publish`는 그 앱 place의 session만 한다(README "preview 호출 검사는 app place session인지 본다").
    - `agentIdOfRef`와 `sessions-core`가 남긴 turn 길의 옛 꼴 넘김이 없다.

## 할 일

place 종류는 session의 place 하나로 정한다: `placeKindOf(session.place)`(null이면 `home`). turn 길은 `placeSessionRead`로 session을 읽고 agent는 `AgentId`다. 이 task 뒤 turn 길에는 `AgentRef`와 `agentIdOfRef`가 없다. 아직 role을 받는 `place-scope` 쪽 port(지침, skill, 지침 층, place 정보)에는 2번의 임시 표 하나로 옛 role을 꾸며 넘기고, `place-scope`가 그 port를 place 종류로 바꾸며 지운다.

1. **place 종류 표**(`agent-places/tool-lists.ts`). 근거: README "tool 목록 셋은 지금 role 목록에서 나온다", 계약 `placeToolNames`.
   - `placeToolNames(kind: PlaceKind): readonly string[]`. 셋 모두: 공통(`COMMON_TOOLS`) + 읽기(`READ_TOOLS`) + job tool 넷 + `agent.create`·`agent.update`.
     - home(지금 lophn 목록): + `instructions.read`, `app.create`, 앱 진단 넷(`app.tools`, `app.status`, `app.logs`, `app.invocations`). 작업 tool(`file.write`, `file.edit`, `shell.run`)은 없다.
     - project(지금 PM 목록): + 작업 tool 셋, `domain.create`, `workflow.check`.
     - app(지금 AE 목록): + 작업 tool 셋, 앱 진단 넷, `app.link_source`, `package.publish`, `release.prepare`, `release.activate`, `preview.start`, `preview.call`, `preview.stop`, `domain.create`.
   - `builtinToolNames`, `ROLE_WRITE_TOOLS`, Operator 목록, `Role` import를 지운다. `TOOL_ORDER`는 그대로다. 주석의 role 말을 place 종류 말로 고친다.
2. **옛 role을 꾸미는 임시 표**(`main/agent-runtime/product-driver.ts`). 근거: 계약 "`place-scope`와 `place-prompts`는 이 이름에 기댄다", `place-scope` brief "앞 task가 남긴 넘길 줄(옛 role 값을 꾸며 넘기는 줄)은 여기서 지운다".
   - product-driver에 `const ROLE_OF_KIND = { home: "lophn", project: "project_manager", app: "app_engineer" } as const satisfies Record<PlaceKind, Role>`을 두고 `roleOfKind(kind)`로 TurnPreparer와 Compactor에 넘긴다. main file이라 role 이름 글을 쓸 수 있다. harness file에는 이 글을 두지 못한다(`tools/check-deps.ts`).
   - 넘기는 곳은 여기뿐이다: `resolveTurnAgent`의 role(→ `ResolvedAgent.role`, `prepare.ts`의 `rolePrompt`·`skills`와 `place-data.ts`가 읽는다), resolve 전 `skills` 호출, `readTurnInstructions`의 `{ role }`, `turnSkillReader`에 넘기는 session(`{ id, agent: { role }, place }`). 주석에 "place 종류를 옛 role로 꾸미는 임시 표. place-scope가 port를 place 종류로 바꾸면 지운다"를 적는다.
3. **credential 상한과 조건**(`agent-places/credentials.ts`). 근거: README "credential 상한은 place 종류 목록의 route 합이다. 조건은 지금처럼 session place에서 나온다", 계약 `placeOperations(kind)`.
   - `roleOperations`를 `placeOperations(kind: string, definitions)`로 바꾼다. `PLACE_KINDS`에 없는 값이면 `[]`. `selectTools(placeToolNames(kind), …)`의 route 합 + rewind 쓰기 route + `PLACE_READS` + `AGENT_BASE_OPERATIONS`. `annotationsGet`은 project·app 종류에 준다(지금 lophn에는 없다).
   - `PLACE_READS`: `agentDefinitionList.name`을 `agentList.name`으로, `callSendable.name`을 `agentCallSendable.name`으로(글은 같다) 바꾼다. 주석의 "Operator 정의 목록"을 "agent 목록"으로.
   - `agentConditions({ session, turn, process, place })`: app place면 `app`, project place면 `project`, home이면 조건이 없다. `role` 입력을 지운다(지금도 role을 보는 갈래는 place와 같은 답을 낸다).
4. **harness port 이름**(계약 "`placeTools(kind)`, `operationsFor(kind)`").
   - `prepare.ts`의 `PreparerDeps.roleTools(role)` → `placeTools(kind: PlaceKind)`, `roles` 칸을 지우고(agents-core가 지우지 못했으면 여기서 지운다) `roleOfKind(kind: PlaceKind): Role`(2번)을 더한다. `compactor.ts`의 deps도 같다.
   - `agents/layers.ts`의 `resolveTurnAgent` 입력: `placeTools`, `roleOfKind`(`roles`·`roleTools`가 남았으면 지운다).
   - `run-loop/credentials.ts`: `operations: readonly string[] | ((kind: PlaceKind) => readonly string[])`, `TurnCredentials.open({ turn, session, kind })`, `BeginTurnInput.kind`(`role` 대신), `beginTurn`이 `kind`를 넘긴다.
   - `run-loop/agent-credentials.ts`: `operationsFor(kind: PlaceKind)`, `conditionsFor({ session, turn, process, place })`. session은 `placeSessionRead`로 읽고 종류는 `placeKindOf(found.session.place)`다.
   - `run-loop/runtime.ts`: machine 읽기 목록의 `agentSessionRead`를 `placeSessionRead`로, `operationsFor(kind)`.
   - `main/agent-runtime/main.ts`: `operations: (kind) => placeOperations(kind, agentTools({ file: FILE_HOOKS }))`.
   - `wiring/lophn-agent-runtime.ts`: 상한은 `PLACE_KINDS.flatMap((kind) => placeOperations(kind, …))`, `operationsFor: (kind) => placeOperations(kind, …)`, `conditionsFor: agentConditions`. `ROLES` import를 지운다.
   - `product-driver.ts`: `placeTools: placeToolNames`, `roleOfKind`(2번). `roles: ROLE_TABLE`이 남았으면 지운다.
5. **turn 길의 agent 정체**(`agents/{mod,layers}.ts`, `run-loop/prepare.ts`, `tools/tool-context.ts`). 근거: 계약 "tool 실행 context는 `{ agent: AgentId, place: Place | null, kind: PlaceKind }`", "`agentIdOfRef`가 없다".
   - `layers.ts`: session은 `placeSessionRead`로 읽는다. `session.agent`가 곧 `AgentId`라 `agentIdOfRef`를 쓰지 않는다. role은 `input.roleOfKind(placeKindOf(session.place))`, tool 목록은 `input.placeTools(kind)`다.
   - 이 task 소유 file에서 `agentIdOfRef`를 쓰지 않는다. 그 뒤 `grep -rn "agentIdOfRef" packages`가 `agents/mod.ts`(와 그 함수를 담은 file)만 내면 함수를 지운다. 다른 task의 file(`sessions-core`가 다리로 쓴 `places/directory.ts`·`wiring/runs.ts`는 `router-core`·`runs-core`가, agents-core가 쓴 `register.ts`의 `chosenOf`는 `place-scope`가 다시 쓰며 없앤다)이 아직 쓰면 지우지 않고 보고의 "안 쓰게 된 export"에 "남이 아직 쓴다"와 그 file을 적는다(orchestrate 병렬 규칙 2).
   - `prepare.ts`:
     - `prepare`의 session 읽기를 `placeSessionRead`로. `const kind = placeKindOf(session.place)`.
     - tool 목록은 `deps.placeTools(kind)`. resolve 전 skill은 `deps.skills?.(session.place, deps.roleOfKind(kind))`. `readTurnInstructions(…, { role: deps.roleOfKind(kind) }, …)`. `rolePrompt(resolved.role)`과 prompt의 skill 호출은 그대로 둔다(`place-scope`가 바꾼다).
     - `toolPorts(session: PlaceSession, …)`. `ToolContext`는 `agent: session.agent`, `kind`, `place`를 싣는다. basis의 `agent`는 `session.agent`(id 글)다. `BeginTurnInput`은 `kind`를 싣는다.
     - `apiKit.load({ agent: session.agent, place: session.place })`.
   - `tool-context.ts`: `agent: AgentId`, `kind: PlaceKind`(`role` 대신). 주석 "role과 place가 정체성을 다 말하지 못하는 Operator 때문에"를 지운다.
6. **할당 읽기와 Gate**(`tools/{app-toolkit,app-public}.ts`, `tool-judgment/tool-gate.ts`, `approvals/{approvals,ports}.ts`, `wiring/approvals.ts`, `product-driver.ts`). 근거: `approval.md` "흐름"(session의 agent와 place, 할당), README "받는 domain".
   - `app-toolkit.ts`: `AppToolkit.load(who: AgentAtPlace)`, `define(who)`, `assignment(agent: AgentId): Promise<Result<Pick<Assignment, "entries">>>`.
   - `app-public.ts`: `callerDomains(who: AgentAtPlace)`. 읽지 못하면 null(공개 tool만 본다)은 그대로다.
   - `product-driver.ts`: `assignment`은 `assignmentGet`에 `{ agent }`. `callerDomains`는 `agentRead`에 `{ agent, place }`(place가 null이면 칸을 뺀다)로 읽은 `effective.domains`다(agents-core가 README "받는 domain"의 셈을 그 읽기에 두었다). 지금의 `callerDomains` 함수(`placeOfAgentRef`, `agentDefinitionRead`, `domainList`, `workingDomains`)를 지운다.
   - `tool-gate.ts`: `ToolGateCall.agent: AgentId`.
   - `approvals/ports.ts`: `Approvals.judge(call, who: { agent: AgentId; session; place; mode })`. `approvals/approvals.ts`: `ApprovalsDeps.assignmentOf(agent: AgentId): Promise<Result<Pick<Assignment, "entries">>>`. judge에 넘기는 할당 꼴은 9번을 본다.
   - `wiring/approvals.ts`: `assignmentOf`는 `loadAssignment(sql, agent)`를 그대로 부른다(agents-core의 옛 꼴 넘김을 지운다). `sessionOf`는 `placeSessionRead`의 `{ agent: session.agent, place }`를 낸다(sessions-core의 `agentRefOfId` 넘김을 지운다).
7. **앱 호출**(`apps/calls/{caller,gate,service}.ts`, `apps/ports.ts`, `apps/usage/ports.ts`, `apps/packages/publish.ts`). 근거: README "preview 호출 검사(`apps/calls/caller.ts:106`)는 app place session인지 본다", 계약 "preview 호출과 `package.publish`는 그 앱 place의 session만 한다", `app-call.md` program·flow caller.
   - `caller.ts`:
     - `CallAuth.program`·`flow`는 `{ …, agent: AgentId, place: Place | null }`. `VerifiedCaller`의 agent·program·flow 갈래의 `agent: AgentId`.
     - preview 검사: `found.value.place?.kind === "app" && found.value.place.id === target.app`가 아니면 `forbidden` "only a session in the app's place calls its preview". 위 주석도 고친다.
   - `apps/ports.ts`: `CallerDirectory.agentToolCall`은 `{ agent: AgentId; place: Place | null } | null`. `AppToolCallPath` 주석의 "project PM"을 "flow instance의 creator"로.
   - `gate.ts`: `assignmentOf(caller.agent)`(agents-core의 `agentIdOfRef` 넘김을 지운다). `CallGateDeps.agentDomainsOf(agent: AgentAtPlace)`이고 program·flow 갈래는 `{ agent: caller.agent, place: caller.place }`를 넘긴다. 주석을 고친다.
   - `apps/usage/ports.ts`: `UsagePorts.agentDomains(agent: AgentAtPlace): string[]`(그 agent가 그 place에서 받는 domain. home이면 `[]`). 그러면 `wiring/apps.ts`의 `(agent) => readDomains(() => domains.agentDomains(agent))`가 고치지 않고 맞는다. `sessionDomains`의 꼴과 `chosenDomains`는 `place-scope`가 정한다(그대로 둔다).
   - `service.ts`: type만 따라가고 218줄 주석의 "그 앱의 App Engineer"를 "그 앱 place의 session"으로 고친다.
   - `publish.ts`: 검사(`ctx.actor`가 agent이고 `conditions.app === input.app`)는 그대로다. app place session만 그 조건을 갖는다(3번). 주석과 오류 글을 "only a session in the app's place publishes its packages"로.
8. **tool 묶음과 그 밖의 이름**(`agent-places/tools/mod.ts`, `main/agent-tools.ts`, `agent-places/hooks.ts`, `agent-places/tools/{kind,instructions,settings}.ts`, `extensions/mcp-toolkit.ts`, `run-loop/runtime-access.ts`, `main/tool-names_test.ts`, `tests/live/suite.ts`).
   - `ROLE_AGENT_TOOLS`를 `PLACE_AGENT_TOOLS`로 바꾸고 `main/agent-tools.ts`가 그 이름을 쓴다. 두 file과 `hooks.ts`의 주석 "role 층", "role 규칙"을 "place 층(`agent-places`)"으로.
   - `kind.ts`·`instructions.ts`·`settings.ts`·`mcp-toolkit.ts`·`runtime-access.ts`·`tool-names_test.ts`는 `ToolContext`·이름이 바뀐 곳만 따라간다. tool 설명 글은 `place-prompts`가 고친다. 고칠 것이 없으면 건너뛴다.
   - `tests/live/suite.ts`: `placeToolNames("project")`(지금 PM 묶음과 같다). 주석의 "실제 role(project_manager)"을 "project place"로.
9. **소유 줄에 없는데 이 task의 바꿈으로 깨지는 file**(뼈대 검토 보고 대상). 띄우기 전에 lead가 소유에 넣는다. 넣지 않았으면 고치지 말고 보고의 "계약 바꾸기 요청"에 적는다(아래는 고치지 않으면 type check나 test가 깨진다).
   - `packages/core/lophn-agent/session/caller-directory.ts`(sessions-core 소유): 낼 값을 `{ agent: row.agent, place: placeOf(row) }`로, 안의 `CallerOf` type을 `AgentId`로. `wiring/apps.ts`의 `const callers: CallerDirectory = createCallerDirectory(link.sql)`가 그대로 맞는다.
   - `packages/core/main/daemon/agent-domains.ts`(place-scope 소유): `agentDomains({ agent, place })`는 place가 null이면 `[]`, 아니면 `workingDomains(그 그릇의 active domain id, placeDepsOf(sql).agents.agent(agent)?.domains ?? [])`, 정의가 없으면 `[]`. `sessionDomains`의 domain은 `ports.agentDomains({ agent: row.agent, place: placeOf(row) })`. role 칸은 `place-scope`가 바꾼다.
   - `packages/core/apps/usage/users.ts`: 할당으로 세는 몫이 `ports.agentDomains({ agent, place: null })`(home이라 `[]`)이 된다. agents-core가 둔 `AgentRef` 넘김을 지운다. 할당 몫의 셈(`chosenDomains`)은 `place-scope`가 더한다.
   - `packages/core/main/daemon/wiring/runs.ts`(runs-core 소유)의 `tools.call` 두 `CallAuth`: runs-core가 먼저 합쳐졌으면 그 옛 꼴 넘김을 `agent: origin.creator.agent, place: origin.creator.place`로 바꾼다. 아직이면 옛 `origin.creator`(`AgentRef`)에서 `agent: "agent" in creator ? creator.agent : LOPHN_AGENT_ID`, `place: origin.creator_place`로 넣는다(runs-core "옛 ref의 id"와 같은 셈).
   - `packages/core/approvals/gate/judge.ts`: agents-core가 할당 인자를 `Pick<Assignment, "entries"> | null`로 넓히지 못했으면 여기서 넓힌다. `caller.agent`가 id가 되어 옛 `AgentAssignment`로 감쌀 수 없다.
   - `packages/core/lophn-agent/tools/bundles/shell_test.ts`: `toolGate.check`에 넘기는 `agent`를 `"lophn"`으로.
   - `packages/core/main/daemon/wiring/approvals_test.ts`: 대역 `sessionOf`의 `agent`를 `"lophn"`으로.
10. 지우거나 바꾼 이름(`builtinToolNames`, `roleOperations`, `roleTools`, `ROLE_AGENT_TOOLS`, `ToolContext.role`, `BeginTurnInput.role`, `agentIdOfRef`)을 `grep -rn`으로 찾아 주석과 오류 글에 남은 것을 고친다.
11. 보고의 "등록할 것": route를 더하거나 바꾸지 않으므로 registry 교체는 없다. 5번에서 `agentIdOfRef`를 남겼으면 "안 쓰게 된 export"에 적어 lead가 마지막 사용처가 옮겨진 뒤 지우게 한다.

## 정한 것 (brief를 쓴 agent, 2026-10-28)

1. **아직 role을 받는 `place-scope` 쪽 port에는 product-driver의 표 하나(`ROLE_OF_KIND`)로 옛 role을 꾸며 넘긴다.** 이유: session에 role이 없어졌고 harness file에는 role 이름 글을 둘 수 없다(`tools/check-deps.ts`). 꾸민 값(home→lophn, project→PM, app→AE)은 README가 정한 place 종류의 출발점과 같아 지침, skill, file 범위가 그 사이에도 맞게 돈다. `resolveTurnAgent`의 `roleOfKind` 입력과 `ResolvedAgent.role`은 `place-scope`가 소유하지 않는 file(`agents/{layers,resolve}.ts`)에 있어 `cleanup-core`가 지운다.
2. **`annotationsGet`은 project·app 종류의 상한에 준다.** 이유: 지금 PM·AE·Operator에 있고 lophn에는 없다(README "tool 목록 셋은 지금 role 목록에서 나온다", home은 lophn에서 시작).
3. **할당으로 세는 사용 관계의 agent domain은 이 task와 `place-scope` 사이에 비어 있다.** 이유: 정의가 전역이 되어 place 없는 agent의 받는 domain은 0개다(README "home은 0개다"). 정의가 고른 domain으로 세는 셈은 `place-scope`가 정했다(그 brief "정한 것" 2).

## 끝남

- `npm run check`가 통과한다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/agent-places/tool-lists_test.ts packages/core/main/agent-tools_test.ts packages/core/main/tool-names_test.ts packages/core/agent-places/tools/kind_test.ts packages/core/lophn-agent/tools/registry_test.ts packages/core/lophn-agent/tools/app-public_test.ts packages/core/lophn-agent/run-loop/prepare_test.ts packages/core/apps/calls/calls_test.ts packages/core/apps/usage/users_test.ts packages/core/lophn-agent/tools/bundles/shell_test.ts packages/core/main/daemon/wiring/approvals_test.ts`
- 위험 test: "release·publish·preview·소스 연결 route는 app 종류의 credential 상한에만 있고, app place session의 credential은 그 앱 하나에 묶인다". README "저장과 test"의 위험 test "credential 조건(다른 그릇 release·publish 막기)"이다. `main/agent-tools_test.ts`의 첫 test("App Engineer의 credential 상한에 app.link_source…")를 옮겨 고친다. 준비를 한 번 하고 표로 본다:
  - `appConnectSource`, `packagePublish`, `releasePrepare`, `releaseActivate`, `previewsStart`의 `.name`이 `placeOperations("app", …)`에는 있고 `"project"`·`"home"`에는 없다. tool 이름(`app.link_source`)은 어디에도 없다.
  - `agentConditions`: app place → `app`이 그 앱 id이고 `project`가 없다. project place → `project`가 그 id이고 `app`이 없다. home → 둘 다 없다.
- 그 밖의 test는 옮겨 고친다(새 test file은 없다):
  - `agent-tools_test.ts` 둘째 test를 "place 종류 목록의 모든 이름에 정의가 있고 모든 정의가 어느 목록에 있다"로(`PLACE_KINDS.flatMap(placeToolNames)`). 셋째(JSON Schema)는 그대로.
  - `tool-lists_test.ts`: wire 이름 겹침 test는 `PLACE_KINDS`로 돈다. 목록 test는 표 하나로 고친다: 앱 진단 넷 → home·app, job 넷과 `agent.create`·`agent.update` → 셋 모두, `workflow.check` → project, 작업 tool 셋 → project·app, 앱 쓰기(`app.link_source`, `package.publish`, `release.*`, `preview.*`) → app.
  - `apps/calls/calls_test.ts`의 preview test(권한 경계)를 "그 앱 place의 session만 그 앱의 preview tool을 부르고, 다른 place의 session은 앱 process에 닿지 못한다"로 고친다. 줄: 앱 A place session → succeeded, 앱 B place session → forbidden, home의 lophn → forbidden, project place session → forbidden. 대역 caller directory는 `{ agent, place }`를 낸다. job·flow test("만든 agent(…)의 할당이나 domain 밖이면…")는 caller를 `{ agent: AgentId, place }`로, 대역 `agentDomainsOf`를 `AgentAtPlace`로 고치고 이름의 "project PM"을 "flow instance의 creator"로 바꾼다.
  - `registry_test.ts`: `ToolContext`를 새 칸으로, 이름의 "role의 고정 목록"을 "place 종류의 고정 목록"으로, 대역 tool 이름 `operator.update`를 `agent.update`로. `kind_test.ts`, `app-public_test.ts`(`kit.load({ agent: "lophn", place: null })`), `prepare_test.ts`, `users_test.ts`(대역 `agentDomains`가 `AgentAtPlace`를 받는다)는 꼴만 고친다.
- 남지 않음(모두 0줄):
  - `grep -rnw "builtinToolNames\|roleOperations\|roleTools\|ROLE_AGENT_TOOLS\|ROLE_TABLE\|AgentRoleTable" packages tests/live` (agents-core가 11번 대안으로 `role-table.ts`를 남겼으면 그 file과 보고)
  - `grep -rnw "agentIdOfRef" packages`가 0줄이거나, 5번에 적은 다른 task file과 `agents/mod.ts`만 낸다(보고에 적는다)
  - `grep -rnw "AgentRef\|agentSessionRead" packages/core/lophn-agent/run-loop packages/core/lophn-agent/tools packages/core/lophn-agent/tool-judgment packages/core/lophn-agent/agents/{mod,layers}.ts packages/core/approvals/{approvals,ports}.ts packages/core/apps/calls packages/core/apps/ports.ts packages/core/apps/usage/ports.ts packages/core/main/agent-runtime packages/core/main/daemon/wiring/{lophn-agent-runtime,approvals}.ts` (5번에서 `agentIdOfRef`를 남겼으면 `agents/mod.ts`의 그 줄만)
  - `grep -rn "project_manager\|app_engineer\|\"operator\"\|App Engineer\|Project Manager\|Operator" packages/core/agent-places/{tool-lists,tool-lists_test,credentials,hooks}.ts packages/core/apps/calls packages/core/apps/packages/publish.ts packages/core/apps/ports.ts packages/core/main/agent-tools.ts packages/core/main/agent-tools_test.ts packages/core/lophn-agent/tools/tool-context.ts packages/core/lophn-agent/run-loop`
  - `grep -rn "project_manager\|app_engineer" packages/core/main/agent-runtime/product-driver.ts`가 `ROLE_OF_KIND` 표의 줄만 낸다.
- 합친 뒤 plan branch에서 안 되는 것(보고의 "알려진 미완 동작"에 적는다): 할당으로 세는 사용 관계(`place-scope`), place 종류의 지침·skill·file 범위는 옛 role 표로 돈다(`place-scope`, `place-prompts`), 화면·e2e·eval의 옛 route(wave 3).

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
