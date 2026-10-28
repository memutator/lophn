# cleanup-core

core에 남은 옛 길과 role 이름을 지운다: `messages.from_kind`의 `coding_agent`와 그것을 읽는 곳, 옛 `resolveNamed`, 옛 route 상수 import, 남은 `AgentRef`·`Role`·`CallAgent`·`NamedAgent` 사용과 role 이름(주석·오류 글 포함). protocol의 옛 꼴은 `cleanup-protocol`이 지운다.

- 단위: cleanup (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" 전부. 특히 "주소와 넘기기", "저장과 test", "뼈대 검토"(`AgentId`, `coding_agent` actor·`cac`, "이름에서 role 낱말을 뺀다", eval의 지난 기록). `project-docs/products/roadmap/remove-role.md`의 "끝남 기준"
  - 새 이름(그대로 두고 옛 이름으로 되돌리지 않는다): `project-docs/plan/remove-role/tasks/contract-agent.md`, `project-docs/plan/remove-role/tasks/contract-session.md`의 "내놓는 것"
  - 뒤 task: `project-docs/plan/remove-role/tasks/cleanup-protocol.md`. 이 task가 합쳐지면 그 task가 protocol의 옛 꼴을 지운다. 그때 core에 옛 꼴 import가 하나도 없어야 한다.
  - architecture: `project-docs/architecture/layers.md`(core 층과 `agent-places`), `project-docs/architecture/place-session.md`(session 정체), `project-docs/architecture/agent-call.md`(주소와 Router), `project-docs/architecture/agent-definition.md`(정의 꼴), `project-docs/architecture/terminal-agent.md`(남는 터미널 agent 층. memory route `coding_agent_terminals/*`·`coding_agent_harnesses/*`와 harness 감지는 지우지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`(`agents`, `agent-sessions`, `run-loop`, `agent-tools`), `router`, `agent-roles`(지금 module 자리는 `packages/core/agent-places`), `server`, `storage`. `project-docs/module-catalog.yaml`의 `packages/core/*` 줄
  - 옛 꼴이 정의된 곳(읽기만 한다. 고치는 것은 `cleanup-protocol`): `packages/protocol/lophn-agent/{places,calls,agent-sessions,sessions,agent-definitions,operators,agent-values,skill-settings}.ts`, `packages/protocol/approvals/assignment.ts`, `packages/protocol/coding-agent/harness-id.ts`
- 계약:
  - 쓰는 것: wave 1~3이 옮긴 새 꼴 전부.
  - 내놓는 것: `packages/core`는 protocol의 옛 꼴(`Role`, `ROLES`, `AgentRef`, `CallAgent`, `NamedAgent`, `CallTo`, Operator·built-in 정의 꼴과 route, 옛 session·call·할당 route 상수, `BUILTIN_SKILLS.roles`, `codingOptionsSchema`)을 import하지 않는다. 표 `messages.from_kind`에 `coding_agent`가 없다(schema step을 고치고 개발 data는 지운다). `coding_agent` actor를 다루는 인증 쪽은 `cleanup-protocol`이 actor 종류와 함께 지운다.

## 할 일

wave 1~3이 모두 합쳐진 plan branch에서 시작한다. 아래 file 이름과 줄은 계획을 열 때(HEAD 706993098) 본 것이라 앞 task가 옮겼을 수 있다. 이름으로 grep해 찾는다. grep 결과 같은 임시 file은 worktree의 `.dev-data/cleanup-core/`에 둔다.

registry에서 옛 route 상수를 새 상수로 바꾸는 일(`packages/protocol/lophn-agent/registry.ts`, `packages/protocol/registry.ts`, `packages/core/approvals/registration.ts`)은 lead가 wave 2 task를 합칠 때 했다(`agents-core`, `sessions-core`, `router-core`의 "등록할 것"). 이 task는 하지 않는다. 아직 옛 상수가 registry에 있으면 보고에 적는다.

이 task와 `cleanup-protocol`의 나눔(README "뼈대 검토"): role 이름과 옛 꼴 import는 core 전체에서 이 task가 지운다. `coding_agent` **actor 종류**(`coding_agent:<id>` 자격, route의 actors 목록, `parseActor(...).kind === "coding_agent"`)를 다루는 인증 쪽은 `packages/core/{server,storage/ledger,apps,projects/registry,approvals}` 안에서 `cleanup-protocol`이 지운다. 이 task는 그 줄을 건드리지 않는다.

1. 남은 것 목록을 만든다. 이 목록이 아래 2~7의 일감이다.
   ```sh
   mkdir -p .dev-data/cleanup-core
   git grep --untracked -nIiE "project[-_ ]?manager|app[-_ ]?engineer|operator" -- packages/core > .dev-data/cleanup-core/names.txt
   git grep --untracked -nIwE "PM|AE|CE|pm|ae" -- packages/core >> .dev-data/cleanup-core/names.txt
   git grep --untracked -nwE "Role|ROLES|roleSchema|rolePlaceFits|AgentRef|agentRefSchema|agentRefOutputSchema|placeOfAgentRef|agentRefOfColumns|agentIdentityOf|CallAgent|callAgentSchema|callAgentOutputSchema|NamedAgent|namedAgentSchema|CallTo|CallToInput|callToSchema|CallEnvelope|AgentCallRecord|AgentSession|OperatorDefinition|operatorDefinitionSchema|operatorDefinitionOutputSchema|BuiltinDefinition|builtinDefinitionSchema|builtinDefinitionOutputSchema|AgentDefinitionRow|AgentAssignment|agentAssignmentSchema|BUILTIN_ROLE_NAMES|agentKindSchema|codingOptionsSchema|CodingOptions|resolveNamed" -- packages/core > .dev-data/cleanup-core/symbols.txt
   git grep --untracked -nwE "AGENT_SESSION_ROUTES|openAgentSession|agentSessionRead|agentSessionList|sessionCompactRequests|closeSession|CALL_ROUTES|callSend|callSendable|callRead|AGENT_DEFINITION_ROUTES|agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_ASSIGNMENT_ROUTES|agentAssignmentGet|agentAssignmentSet" -- packages/core > .dev-data/cleanup-core/routes.txt
   git ls-files packages/core | grep -iE "role|operator|project-manager|app-engineer"
   ```
   계획의 처음 grep(`grep -rn "project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|AgentRef\|NamedAgent\|CallAgent" packages/core`)은 위 첫 줄과 셋째 줄에 들어 있다.

2. 옛 protocol 꼴 사용을 새 꼴로 바꾸고 import를 지운다(계약 "내놓는 것", README "뼈대 검토"의 `AgentId`). 옛 이름 → 새 이름:
   - `AgentRef`, `agentRefSchema`, `placeOfAgentRef`, `agentRefOfColumns`, `agentIdentityOf` → `AgentId`(+ `Place | null`) 또는 `AgentAtPlace`
   - `Role`, `ROLES`, `roleSchema`, `rolePlaceFits` → `PlaceKind`, `placeKindOf`
   - `CallAgent` → `AgentAtPlace`. `NamedAgent` → `AgentAddress`. `CallTo`·`CallToInput` → `CallTarget`·`CallAddressInput`. `CallEnvelope`·`AgentCallRecord` → `AgentCallEnvelope`·`AgentCallRow`
   - `AgentSession` → `PlaceSession`. `AgentDefinitionRow` → `AgentRow`. `OperatorDefinition`·`BuiltinDefinition`과 그 schema → `AgentDefinition`, `agentDefinitionSchema`. `AgentAssignment` → `Assignment`
   - `BUILTIN_ROLE_NAMES`, `agentKindSchema` → `LOPHN_AGENT_NAME`, `LOPHN_AGENT_ID`. `BUILTIN_SKILLS[].roles` → `BUILTIN_SKILLS[].places`(`git grep -n "\.roles\b" -- packages/core`도 본다)
   - `codingOptionsSchema`, `CodingOptions` → 없음(쓰는 줄을 지운다)
   - route 상수: `AGENT_SESSION_ROUTES`·`openAgentSession`·`agentSessionRead`·`agentSessionList`·`sessionCompactRequests` → `PLACE_SESSION_ROUTES`·`placeSessionOpen`·`placeSessionRead`·`placeSessionList`·`placeSessionCompactRequests`. `CALL_ROUTES`·`callSend`·`callSendable`·`callRead` → `AGENT_CALL_ROUTES`·`agentCallSend`·`agentCallSendable`·`agentCallRead`(`callReply`·`callCancel`은 그대로). `AGENT_DEFINITION_ROUTES`·`agentDefinitionList`·`agentDefinitionRead`·`operatorCreate`·`operatorChange`·`operatorDelete`·`builtinAgentChange`·`profileImageUpload`·`profileImageRead` → `AGENT_ROUTES`·`agentList`·`agentRead`·`agentCreate`·`agentChange`·`agentDelete`·`agentProfileImageUpload`·`agentProfileImageRead`. `AGENT_ASSIGNMENT_ROUTES`·`agentAssignmentGet`·`agentAssignmentSet` → `ASSIGNMENT_ROUTES`·`assignmentGet`·`assignmentSet`
   - 계획을 열 때 wave 2·3 어느 task도 소유하지 않아 남을 곳: `packages/core/approvals/gate/{judge,judge_test}.ts`(`AgentAssignment`), `packages/core/approvals/gate/judge_test.ts`·`packages/core/lophn-agent/tools/bundles/shell_test.ts`·`packages/core/main/daemon/wiring/approvals_test.ts`의 `{ role: "lophn" }` fixture.
   - type이 없는 길도 본다(orchestrate "병렬 규칙"의 문자열 grep). 0줄이어야 한다:
     ```sh
     git grep -nE "agent-definitions|\"operators\"|builtin-agents|ListAgentDefinitions|ReadAgentDefinition|CreateOperator|ChangeOperator|DeleteOperator|ChangeBuiltinAgent|CloseSession|queued_coding|creator_role|creator_id" -- packages/core
     ```
     칸 이름 `role`·`operator`의 남은 줄은 아래로 보고 model 메시지 role(`role: "user"`, `message.role`)과 annotation 대상 element의 role(`packages/core/apps/annotations/`)만 남긴다:
     ```sh
     git grep -nE "\brole:|\.role\b|\"role\"|\boperator:|\.operator\b" -- packages/core
     ```

3. 죽은 `closeSession` 가지를 지운다: `packages/core/main/daemon/wiring/router.ts`의 `name === closeSession.name`, `packages/core/lophn-agent/session/rewind/files.ts`의 `envelope.command === closeSession.name`과 두 file의 import. 근거: `packages/protocol/lophn-agent/registry.ts`가 `closeSession`을 `ROUTES`에서 빼서 그 이름의 command는 오지 않는다. route 자체는 `cleanup-protocol`이 지운다(그 brief의 "죽은 옛 session route").

4. 옛 `resolveNamed`를 지운다(`router-core` 계약: `runs-core`·`jobs-core`가 옮길 때까지만 옆에 둔다). 함수는 `packages/core/agent-places/place/session-directory.ts`, port는 `packages/core/lophn-agent/places/{ports,directory,unwired}.ts`(`resolveNamed`, 그것을 꽂는 `resolveAgent: deps.roles.resolveNamed`), 그것을 잇는 wiring이다. 아직 부르는 곳이 있으면 `resolveAddress`로 옮긴다. `git grep -n resolveNamed -- packages`가 0줄이다. 근거: `project-docs/architecture/agent-call.md`.

5. `messages.from_kind`에서 `coding_agent`를 지운다(계약, README "저장과 test").
   - schema: `packages/core/lophn-agent/session/model.ts`의 schema step `lophn-agent.sessions.tables` 안 `messages.from_kind` CHECK를 `('human', 'program', 'agent')`로 고친다. 그 step을 제자리에서 고치고 새 step·migration을 만들지 않는다(AGENTS.md "호환성").
   - core 안 literal type에서 `coding_agent`를 뺀다: `session/model.ts`의 `MessageRow.from_kind`, `session/rewind/checkpoints.ts`의 `from_kind`.
   - 읽는 곳: `packages/core/lophn-agent/run-loop/input-text.ts`의 `fromText` 가지와 coding 터미널 안내 줄(`input.from.kind === "coding_agent"`), `run-loop/input-text_test.ts`의 `fromCoding` 경우를 지운다.
   - 정한 것: protocol의 `CallFrom`(`packages/protocol/lophn-agent/calls.ts`의 `fromSchemas`)은 `cleanup-protocol`이 지울 때까지 `coding_agent` 가지를 가진다. 그래서 core는 그 가지를 글자로 쓰지 않는다. `CallFrom`을 그대로 받아 넘기는 곳(`places/messages.ts`가 `from.kind`를 `createCheckpoint`에 넘긴다)에서 type이 안 맞으면 받는 쪽 type을 `CallFrom["kind"]`로 쓰고, `switch`가 모든 가지를 요구하면 보낸 session이 있는 가지를 하나로 쓴다(예: `fromText`는 human·program이 아니면 `` `${from.kind}:${from.session}` ``). protocol에서 가지가 지워지면 그대로 좁아진다. 근거: 선행 없이 같이 돌 수 있게 하는 가장 작은 방법이다.
   - 개발 data는 schema가 바뀌었으니 지운다(AGENTS.md "호환성"). 보고에 "schema를 바꿨다"고 적으면 lead가 main checkout의 `.dev-data/`를 지운다.

6. core에 남은 `coding_agent` 가짜 role과 actor 목록을 지운다(README "뼈대 검토"). 인증 쪽 다섯 폴더(`server`, `storage/ledger`, `apps`, `projects/registry`, `approvals`)는 빼고 본다.
   ```sh
   git grep --untracked -nw coding_agent -- packages/core ':!packages/core/server' ':!packages/core/storage/ledger' ':!packages/core/apps' ':!packages/core/projects/registry' ':!packages/core/approvals'
   ```
   - 계획을 열 때 있던 곳: `packages/core/main/daemon/wiring/server.ts`의 `platform/status`·`platform/health` actors(`coding_agent`를 뺀다. actor 종류가 아직 있어도 목록을 줄이는 것은 type이 맞다)와 `codingAgentOperationPolicies(...)`를 부르는 줄(`coding-core`가 안 지웠으면 지운다. 함수는 `packages/core/apps/connections/operations.ts`에 있고 `cleanup-protocol`이 지운다), `packages/core/lophn-agent/session/guards.ts`의 주석. `CallAgent`의 `coding_agent` 가지(`router`, `lophn-agent/places/directory.ts`, `agent-places/place/{place-data,session-directory}.ts`, `main/daemon/wiring/{router-registration,jobs-registration,session-snapshots,approvals}.ts`, `runs/service.ts`)는 wave 2·3이 옮겼어야 한다. 남았으면 지운다.
   - `-w`라서 `coding_agent_terminals`·`coding_agent_harnesses`(터미널 agent 층 memory route)는 걸리지 않는다. 그것은 남긴다(`project-docs/architecture/terminal-agent.md`).

7. role 이름, role 낱말이 든 이름, 주석, 오류 글, file 이름을 지운다(README "이름에서 role 낱말을 뺀다", AGENTS.md "말").
   - 바꾸는 말: role → place 종류(`place_kind`). Operator → agent. built-in agent → lophn. Project Manager·PM → project place의 session(받는 쪽이면 그 project place의 lophn session). App Engineer·AE → app place의 session(받는 쪽이면 그 앱 place의 lophn session, 앱 화면 annotation이면 고른 agent). 예: `apps/registration/commands.ts`의 `"an App Engineer connects only its own app"` → `"an agent connects only the app of its session's place"`.
   - 계획을 열 때 wave 2·3 어느 task도 소유하지 않아 남을 곳: `packages/core/apps/{control,registration/commands,registration/source-folder,declaration/reads,declaration/reads_test,releases/activation/assembly,releases/activation/handler}.ts`, `packages/core/storage/ledger/target-authorization.ts`, `packages/core/lophn-agent/tools/file/scope_test.ts`, `packages/core/lophn-agent/extensions/mod.ts`(`builtinForRole`을 내보내는 줄).
   - 앞 task가 이름을 남겼을 수 있는 것(있으면 role 낱말을 뺀 이름으로 바꾼다): `ROLE_TABLE`, `AgentRoleTable`, `role-table.ts`, `roleTools`, `rolePrompt`, `roleOperations`, `builtinForRole`, `role_missing`, `PlaceRoleRules`, `createPlaceRoleRules`, `CREATOR_ROLES`, `WORKFLOW_ROLES`, prompt 층 이름 `"role"`, `main/daemon/wiring/operator-mcp.ts`(`readOperatorMcp`, `operatorMcpServers`)와 `lophn-agent/extensions/mcp-snapshot.ts`의 `OperatorMcpEntry`. 지침·skill 글(`packages/core/agent-places/{prompts,skills}`)도 grep 대상이지만 남은 role 낱말만 지우고 글을 다시 쓰지 않는다(eval이 재는 글이다).
   - role이 주제인 test는 지운다. 주제가 남는 test는 주소와 fixture만 고친다(README "저장과 test"). 지우는 test가 지키던 권한 경계 검사는 남은 test로 옮긴다(`.claude/skills/write-test`).
   - file 이름은 `git mv`로 바꾸고 그 경로를 글로 적은 곳(`tests/eval/versions/*.ts`, `tests/e2e/*`, 주석)을 grep해 맞춘다. tests는 `cleanup-protocol` 소유라 넘길 줄로 최소로 맞춘다. `tools/check-deps.ts`가 경로로 적은 file과 폴더(`HARNESS_LEFTOVERS`, `FEATURE_TOOL_PLACES`, `packages/core/agent-places/tools/`, `packages/core/agent-places/skills/`)는 옮기지 않는다. `tools`는 같이 도는 `cleanup-shell`의 것이다.
   - `role` 낱말이 다른 뜻으로 남는 곳(model 메시지 role, annotation 대상 element의 role)은 그대로 둔다.

8. 끝나면 "남지 않음"의 grep을 모두 돌리고 `npm run check:full`과 core 두 번 기동(`project-docs/plan/tools/lead/boot.sh`)을 한다. `cleanup-protocol`이 지울 protocol export 가운데 core에서 쓰는 곳이 없게 된 것을 보고의 "안 쓰게 된 export"에 적는다.

**뼈대 검토로 더한 일 (planner):** wave 2·3 brief가 잠시 두기로 한 다리와 옛 이름이다. 살 단계가 동시에 돌아 위 목록에 빠졌을 수 있다. 남아 있으면 지운다(쓰는 곳을 새 꼴로 바꾼 뒤).
- `agentIdOfRef`(agents-core), `agentRefOfId`·`agentRefOf`(sessions-core, `session/model.ts`), `ROLE_OF_KIND`(place-tools, `main/agent-runtime/product-driver.ts`), `addressOfNamed`(router-core, `router/model.ts`), `placeFoldersOf`가 place 종류를 옛 role로 꾸미는 부분(sessions-core), `ResolvedAgent.role`·`roleOfKind`(`lophn-agent/agents/{resolve,layers}.ts`)
- 옛 `resolveAgent`(runs·jobs wiring에 남긴 것), 빈 채로 이은 `OperatorDirectory`·`OperatorInfo`(`places/ports.ts`), `RouteInput.options`, `InputTransport.queued`(`run-loop/work.ts`)와 `CallStore.setReceiver`(`router/store.ts`), `prompt-assembly/layers.ts`의 "role 층" 주석
- 찾기: `git grep -n "agentIdOfRef\|agentRefOf\|ROLE_OF_KIND\|addressOfNamed\|roleOfKind\|OperatorDirectory\|OperatorInfo\|queued_coding\|setReceiver" packages/core`

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(schema를 바꿨다).
- 위험 test: 없음. 새로 쓰지 않는다. wave 2가 옮긴 위험 test 셋은 지우거나 약하게 하지 않고 이름·주소만 고친다: place 종류별 file 범위(지금 `packages/core/agent-roles/place/place-folders_test.ts`, `packages/core/main/daemon/place-folders-glue_test.ts` 자리), credential 조건이 다른 그릇의 release·publish를 막는다(지금 `packages/core/main/agent-tools_test.ts` 자리), session 정체 불변(지금 `packages/core/lophn-agent/places/places_test.ts` 자리).
- 남지 않음: 아래가 모두 0줄이다.
  ```sh
  git grep --untracked -nIiE "project[-_ ]?manager|app[-_ ]?engineer|operator" -- packages/core
  git grep --untracked -nIwE "PM|AE|CE|pm|ae" -- packages/core
  git grep --untracked -nwE "Role|ROLES|roleSchema|rolePlaceFits|AgentRef|agentRefSchema|agentRefOutputSchema|placeOfAgentRef|agentRefOfColumns|agentIdentityOf|CallAgent|callAgentSchema|callAgentOutputSchema|NamedAgent|namedAgentSchema|CallTo|CallToInput|callToSchema|CallEnvelope|AgentCallRecord|AgentSession|OperatorDefinition|operatorDefinitionSchema|operatorDefinitionOutputSchema|BuiltinDefinition|builtinDefinitionSchema|builtinDefinitionOutputSchema|AgentDefinitionRow|AgentAssignment|agentAssignmentSchema|BUILTIN_ROLE_NAMES|agentKindSchema|codingOptionsSchema|CodingOptions|resolveNamed" -- packages/core
  git grep --untracked -nwE "AGENT_SESSION_ROUTES|openAgentSession|agentSessionRead|agentSessionList|sessionCompactRequests|closeSession|CALL_ROUTES|callSend|callSendable|callRead|AGENT_DEFINITION_ROUTES|agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_ASSIGNMENT_ROUTES|agentAssignmentGet|agentAssignmentSet" -- packages/core
  git grep --untracked -nw coding_agent -- packages/core ':!packages/core/server' ':!packages/core/storage/ledger' ':!packages/core/apps' ':!packages/core/projects/registry' ':!packages/core/approvals'
  git ls-files packages/core | grep -iE "role|operator|project-manager|app-engineer"
  ```
- `role` 낱말은 다른 뜻으로만 남는다. 아래에 남는 줄은 model 메시지 role(`role: "user"`, `message.role` 등)과 annotation 대상 element의 role뿐이다:
  ```sh
  git grep --untracked -nIE "[Rr]ole|ROLE|역할" -- packages/core | grep -vE 'role: "(user|assistant|system|tool|developer)"|message\.role|\.role === "(user|assistant)"'
  ```

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
