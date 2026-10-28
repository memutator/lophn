# cleanup-protocol

protocol과 SDK의 옛 꼴을 지운다: `Role`·`ROLES`·`roleSchema`·`rolePlaceFits`·`AgentRef`와 그 함수, `CallAgent`·`NamedAgent`·`CallTo`·`callToSchema`와 call의 coding 갈래(`coding_agent` from·`options`·`queued_coding`·`codingOptionsSchema`), Operator·built-in 정의 꼴과 route(`operators.ts`, `CreateOperator`, `ChangeOperator`, `DeleteOperator`, `ChangeBuiltinAgent`, `agent-definitions/*`), 옛 session·call·할당 route 상수와 죽은 옛 session route, `BUILTIN_SKILLS.roles`, `BUILTIN_ROLE_NAMES`, `agentKindSchema`. `coding_agent` actor 종류를 route actors 목록과 core 인증에서 지운다. 끝으로 `packages tools tests`의 role 이름 grep이 0줄인지 본다.

- 단위: cleanup (wave 4)
- 선행: cleanup-core, cleanup-shell. 쓰는 곳이 모두 옮겨진 뒤 지운다.
- 소유(이 task만 고친다):
  - `packages/protocol`
  - `packages/sdk`
  - `packages/coding-agent`
  - `packages/core/server`
  - `packages/core/storage/ledger`
  - `packages/core/apps`
  - `packages/core/projects/registry`
  - `packages/core/approvals`
  - `tests/{e2e,eval,fixtures,harness,live,support}`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" 전부. 특히 "뼈대 검토"(계약은 일부만 옛 꼴 옆에 둔다, `AgentId`, `coding_agent` actor와 `cac` id 접두는 죽은 코드, eval의 지난 기록은 고치지 않는다). `project-docs/products/roadmap/remove-role.md`의 "끝남 기준"
  - 새 이름(그대로 둔다): `project-docs/plan/remove-role/tasks/contract-agent.md`, `project-docs/plan/remove-role/tasks/contract-session.md`의 "내놓는 것"
  - 앞 task: `project-docs/plan/remove-role/tasks/cleanup-core.md`, `project-docs/plan/remove-role/tasks/cleanup-shell.md`(합쳐진 뒤 시작한다. core·shell은 옛 꼴을 import하지 않고 `CallFrom`의 `coding_agent`를 글자로 쓰지 않는다), `project-docs/plan/remove-role/tasks/coding-core.md`의 "내놓는 것"(wave 4에 남긴 것)
  - architecture: `project-docs/architecture/agent-call.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/approval.md`("사람의 결정은 사람 자격만 받는다"), `project-docs/architecture/terminal-agent.md`(남는 터미널 agent 층: `packages/protocol/coding-agent/`의 harness·hook·terminal-hook·`cli-commands.ts`, memory route `coding_agent_harnesses/*`·`coding_agent_terminals/*`, CLI `hook`·`harness`), `project-docs/architecture/testing.md`, `project-docs/architecture/layers.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `core-api`(route actors), `server`, `storage`, `coding-agent`, `coding-agent-cli`, `coding-agent-cli-interface`, `sdk`, `sdk-api`. `project-docs/module-catalog.yaml`의 `packages/protocol`(구현을 두지 않는다), `packages/sdk`, `packages/coding-agent`, `packages/core/{server,storage,apps,projects,approvals}`, `tests` 줄
  - 코드: `packages/protocol/lophn-agent/{places,calls,agent-sessions,sessions,scope,agent-definitions,operators,agent-values,skill-settings,registry,mod}.ts`, `packages/protocol/approvals/assignment.ts`, `packages/protocol/coding-agent/{harness-id,mod}.ts`, `packages/protocol/base/{route,actor,ids}.ts`, `packages/protocol/apps/declaration/types.ts`, `packages/protocol/registry.ts`, `packages/protocol/mod.ts`
- 계약:
  - 쓰는 것: wave 1~3이 고정하고 옮긴 새 꼴 전부.
  - 내놓는 것: protocol에는 새 꼴만 남는다. 새 이름(`AgentId`, `PlaceKind`, `AgentAtPlace`, `AgentAddress`, `PlaceSession`, `CallTarget`, `AgentCallRow`, `Assignment`, `AGENT_ROUTES` 등)은 그대로 두고 옛 이름으로 되돌리지 않는다. actor 종류는 `user`, `agent`, `app`, `machine`이다.
    - 등록할 것(lead): `packages/protocol/**/mod.ts`·`registry.ts`의 지운 줄.

## 할 일

`cleanup-core`와 `cleanup-shell`이 합쳐진 plan branch에서 시작한다. 아래 file 이름과 줄은 계획을 열 때(HEAD 706993098) 본 것이라 앞 task가 옮겼을 수 있다. 이름으로 grep해 찾는다. 임시 file은 worktree의 `.dev-data/cleanup-protocol/`에 둔다.

**lead 몫(이 task가 하지 않는 것):** registry에서 옛 route 상수를 새 상수로 바꾸는 일(`AGENT_DEFINITION_ROUTES` → `AGENT_ROUTES`, `AGENT_ASSIGNMENT_ROUTES` → `ASSIGNMENT_ROUTES`, `AGENT_SESSION_ROUTES`·`sessionCompactRequests` → `PLACE_SESSION_ROUTES`, `CALL_ROUTES` → `AGENT_CALL_ROUTES`)은 lead가 wave 2 task를 합칠 때 했다(`agents-core`, `sessions-core`, `router-core`의 "등록할 것"). 자리는 `packages/protocol/lophn-agent/registry.ts`, `packages/protocol/registry.ts`, core approvals 등록(`packages/core/approvals/registration.ts`·`packages/core/approvals/assignment/`)이다. 이 task는 바꾸지 않는다. 시작할 때 registry에 옛 상수가 아직 들어 있으면 그 상수는 지우지 말고 보고에 적는다. 이 task가 registry·`mod.ts`에서 하는 일은 지운 export와 file을 가리키던 줄을 빼는 것뿐이다(orchestrate review의 예외. 빼지 않으면 check가 깨진다).

1. 시작 확인: 지울 옛 꼴을 소유 밖에서 아직 쓰는지 본다.
   ```sh
   mkdir -p .dev-data/cleanup-protocol
   git grep --untracked -nwE "ROLES|roleSchema|rolePlaceFits|AgentRef|agentRefSchema|agentRefOutputSchema|placeOfAgentRef|agentRefOfColumns|agentIdentityOf|CallAgent|callAgentSchema|callAgentOutputSchema|NamedAgent|namedAgentSchema|CallTo|CallToInput|callToSchema|CallEnvelope|AgentCallRecord|AgentSession|OperatorDefinition|operatorDefinitionSchema|AgentDefinitionRow|AgentAssignment|agentAssignmentSchema|BUILTIN_ROLE_NAMES|agentKindSchema|codingOptionsSchema|CodingOptions|AGENT_SESSION_ROUTES|openAgentSession|agentSessionRead|agentSessionList|sessionCompactRequests|closeSession|CALL_ROUTES|callSend|callSendable|callRead|AGENT_DEFINITION_ROUTES|agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_ASSIGNMENT_ROUTES|agentAssignmentGet|agentAssignmentSet" -- packages tools tests ':!packages/protocol' ':!tests/eval/runs' ':!tests/eval/scorecards' ':!tests/eval/experiments' > .dev-data/cleanup-protocol/users.txt
   ```
   소유 안(`packages/sdk`, `packages/coding-agent`, `packages/core/{server,storage/ledger,apps,projects/registry,approvals}`, `tests`)의 줄은 이 task가 옮긴다. 소유 밖(그 밖의 core, shell, design, tools)에 남았으면 지운 export를 쓰는 그 줄만 최소로 맞추고 보고의 "넘길 줄"에 적는다. 옮기는 것이 한두 줄이 아니면(앞 task가 놓친 일) 고치지 말고 보고한다.

2. `packages/protocol/lophn-agent/places.ts`: `ROLES`, `roleSchema`, `Role`, `ROLE_PLACES`, `rolePlaceFits`, `agentRefSchema`, `agentRefOutputSchema`, `AgentRef`, `placeOfAgentRef`, `agentRefOfColumns`, `agentIdentityOf`와 그 주석을 지운다. `placeSchema`, `placeOutputSchema`, `Place`와 `contract-agent`가 더한 것(`LOPHN_AGENT_ID`, `agentIdSchema`, `PLACE_KINDS`, `placeKindOf`, `agentAtPlaceSchema`, `placeNameSchema`, `agentAddressSchema` 등)은 둔다. 근거: README "`AgentRef`는 agent id 하나다", "뼈대 검토"의 `AgentId`.

3. `packages/protocol/lophn-agent/calls.ts`: `callAgentSchema`, `callAgentOutputSchema`, `CallAgent`, `namedAgentSchema`, `NamedAgent`, `callToInputSchema`, `CallToInput`, `callToSchema`, `CallTo`, `launchesCoding`, 옛 `callEnvelopeSchema`·`CallEnvelope`, `agentCallRecordSchema`·`AgentCallRecord`, 옛 `callSendInputSchema`, `callSend`, `callSendable`(`queued_coding`), `callRead`, `CALL_ROUTES`, `codingOptionsSchema`·`roleSchema`·`agentRef*` import를 지운다. `fromSchemas`의 `coding_agent` 가지와 주석의 "coding session 끝 알림"을 지운다. `callReply`, `callCancel`, `SENDABLE_SESSION_STATES`와 `contract-session`이 더한 `agentCall*`, `CallAddressInput`, `CallTarget`, `AgentCallEnvelope`, `AgentCallRow`, `AGENT_CALL_ROUTES`는 둔다. 근거: README "call의 `to`는 `{session}`이나 `{agent, place?}`(+ `fallback`)다", "주소용 `coding_agent`는 지운다".

4. session의 옛 꼴과 죽은 route를 지운다.
   - `packages/protocol/lophn-agent/agent-sessions.ts`: `agentSessionSchema`, `AgentSession`, `openAgentSessionInputSchema`, `listAgentSessionsInputSchema`, `openAgentSession`, `agentSessionRead`, `agentSessionList`, `AGENT_SESSION_ROUTES`, `rolePlaceFits`·`agentRef*` import. `placeSession*`, `PlaceSession`, `PLACE_SESSION_ROUTES`는 둔다.
   - `packages/protocol/lophn-agent/sessions.ts`: 옛 `sessionCompactRequests`(`agentRefOutputSchema`를 쓴다)와 죽은 옛 session route `openSession`, `sessionList`, `closeSession`, 그것만 쓰던 schema(`sessionFields`, `sessionRecordSchema`, `openSessionInputSchema`, `openSessionCompareSchema`, `closeSessionInputSchema`, `closeSessionCompareSchema`, `SESSION_CLOSED_REASONS`, `SESSION_STATES`, `sessionListInputSchema`, `SESSION_ARCHIVED_FILTERS` 가운데 남은 곳이 안 쓰는 것)와 `SESSION_COMMANDS`의 그 칸, role·Operator·AE·CE를 말하는 주석. 근거: 셋은 `packages/protocol/lophn-agent/registry.ts`가 `ROUTES`에서 걸러 내 아무도 부를 수 없다. core의 `closeSession` 가지는 `cleanup-core`가 지웠다.
   - `packages/protocol/lophn-agent/registry.ts`: 지운 셋을 거르던 `SESSION_COMMANDS.filter(...)`와 그 import를 뺀다(지운 것을 가리키던 줄).
   - `packages/protocol/lophn-agent/scope.ts`: 위를 지우고 `workPlaceSchema`·`workPlaceOutputSchema`를 쓰는 곳이 없어지면 지운다.

5. 정의의 옛 꼴과 route를 지운다(README "정의 꼴은 하나다").
   - `packages/protocol/lophn-agent/agent-definitions.ts`: resource `agent-definitions`·`operators`·`builtin-agents`의 옛 route(`agentDefinitionList`, `agentDefinitionRead`, `readAgentDefinitionInputSchema`, `operatorCreate`, `operatorChange`, `operatorDelete`, `builtinAgentChange`), 옛 profile 이미지 route(`profileImageUpload`, `profileImageRead`, 옛 입력 schema), `AGENT_DEFINITION_ROUTES`, `builtinAgentRefBranches`·`builtinAgentRefSchema`, `operatorIdSchema`, `agentDefinitionRowSchema`·`AgentDefinitionRow`, 머리 주석의 role·Operator·built-in 말. `contract-agent`가 더한 `agents/*` route, `agentRowSchema`, `AGENT_ROUTES`, `agentProfileImageUpload`·`agentProfileImageRead`와 그것이 쓰는 값(`AgentValueLayer`, `AgentDefinitionIssue` 등)은 둔다.
   - `packages/protocol/lophn-agent/operators.ts`를 지우고 `packages/protocol/lophn-agent/mod.ts`의 `export * from "./operators.ts"`를 뺀다. 새 정의 꼴이 아직 이 file의 것(`mcpServersSchema` 등)을 쓰면 쓰는 쪽(`agent-values.ts`)으로 옮긴 뒤 지운다.
   - `packages/protocol/lophn-agent/agent-values.ts`: `AGENT_KINDS`, `agentKindSchema`, `BUILTIN_ROLE_NAMES`, `import type { Role }`, Operator·built-in·role을 말하는 주석. `agentDefinitionSchema`, `LOPHN_AGENT_NAME`, `agentNameKey`는 둔다.

6. 할당과 skill의 옛 칸을 지운다.
   - `packages/protocol/approvals/assignment.ts`: `agentAssignmentSchema`, `AgentAssignment`, `agentAssignmentGet`, `agentAssignmentSet`, `AGENT_ASSIGNMENT_ROUTES`, `agentRefSchema` import, 주석의 "Operator 정의". `assignmentSchema`, `Assignment`, `assignmentGet`, `assignmentSet`, `ASSIGNMENT_ROUTES`, `assignmentEntrySchema`는 둔다. `packages/protocol/approvals/mod.ts`의 지운 이름 줄을 뺀다.
   - `packages/protocol/lophn-agent/skill-settings.ts`: `BUILTIN_SKILLS` 칸의 `roles`와 `import type { Role }`. `places`는 둔다.

7. `packages/protocol/coding-agent/harness-id.ts`의 `codingOptionsSchema`, `CodingOptions`와 주석, `packages/protocol/coding-agent/mod.ts`의 그 export를 지운다. `harnessIdSchema`, `HARNESS_IDS`는 터미널 agent 층이 쓰니 둔다(`project-docs/architecture/terminal-agent.md`).

8. `packages/protocol/apps/declaration/types.ts`의 `RESERVED_DOMAIN_NAMES`에서 `"operator"`를 지운다(`agent`는 둔다). 근거: `contract-agent`는 `"agent"`를 더하기만 했다. `packages/core/main/tool-names_test.ts`가 모든 내장 tool의 resource가 예약 이름인지 보고, `operator.*` tool이 wave 2 `agents-core`가 이름을 바꿀 때까지 살아 있었기 때문이다. 이제 `operator.*` tool이 없으니 그 test는 그대로 통과한다. 지운 뒤 `packages/core/main/tool-names_test.ts`가 통과하는지 본다.

9. `coding_agent` actor 종류와 `cac` id 접두를 지운다(README "뼈대 검토": 죽은 코드다).
   - `packages/protocol/base/route.ts`의 `ACTOR_KINDS`, `packages/protocol/base/actor.ts`의 `codingAgentIdSchema`·`prefixed("coding_agent", …)`·`ActorParts`의 그 가지와 주석, `packages/protocol/base/ids.ts`의 `cac: "CodingAgentConnection"`.
   - protocol의 모든 route `actors` 목록과 `readActors`·`readers` 같은 상수에서 `"coding_agent"`를 뺀다(`git grep -nw coding_agent -- packages/protocol`). actors가 `coding_agent` 하나뿐이던 route는 route째 지우고 handler도 지운다. 계획을 열 때: `packages/protocol/projects/project-routes.ts`의 `projectResolveCwd`(`packages/protocol/projects/mod.ts`의 줄, handler `packages/core/projects/registry/reads.ts`의 `resolveCwd`, 그것을 등록하는 `packages/core/projects/register.ts`의 두 줄은 넘길 줄), 그 route만 쓰던 `CredentialConditions.cwd`(`packages/protocol/server/identity.ts`의 `cwdConditionSchema`)를 다른 곳이 안 쓰면 같이 지운다. `packages/protocol/coding-agent/message.ts`가 아직 있으면 같은 이유로 지운다.
   - core 인증 쪽(이 task 소유): `packages/core/server/dispatch.ts`의 `actorKind`, `packages/core/server/identity/registry.ts`(`CredentialIssue.actor`의 `coding_agent:${string}`, 발급 kind 검사, coding token 가지와 주석), `packages/core/storage/ledger/command-outcome.ts`의 `ACTOR_KINDS`, `packages/core/storage/ledger/target-authorization.ts`의 `codingAgent` 건너뛰기, `packages/core/apps/control.ts`의 preview·`packagesGuideBody` 정책(`packagesGuideBody` route는 agent tool이 쓰니 둔다), `packages/core/apps/connections/operations.ts`의 `codingAgentOperationPolicies`(`packages/core/main/daemon/wiring/server.ts`가 아직 부르면 그 줄은 넘길 줄), `packages/core/apps/registration/commands.ts`·`packages/core/apps/preview/service.ts`의 kind 검사, `packages/core/apps/annotations/reads.ts`의 coding session 가지(남았으면), `packages/core/projects/registry/reads.ts`.
   - test: `packages/core/server/identity/registry_test.ts`, `packages/core/approvals/approvals_test.ts`, `packages/core/approvals/assignment/commands_test.ts`의 `coding_agent` 경우만 뺀다. `packages/core/apps/releases/activation/consents_test.ts`, `packages/core/apps/usage/users_test.ts`의 `created_by: "coding_agent:…"` fixture는 남는 actor(`agent:ses_…` 등)로 바꾼다. 남은 actor의 경계 검사는 지우지 않는다(`.claude/skills/write-test`, orchestrate의 겪은 실수).
   - `-w`라서 `coding_agent_harnesses`·`coding_agent_terminals`(터미널 agent 층 memory route)는 걸리지 않는다. 그것은 남긴다.

10. protocol·SDK·CLI에 남은 role 말과 앞 task의 남은 것을 지운다(README "이름에서 role 낱말을 뺀다", AGENTS.md "말").
    - 계획을 열 때 wave 1~3 어느 task도 소유하지 않아 남는 주석: `packages/protocol/apps/{apps,package-routes,releases,annotation}.ts`, `packages/protocol/apps/calls/call.ts`, `packages/protocol/server/identity.ts`, `packages/protocol/supervision/supervision.ts`(역할), `packages/protocol/lophn-agent/{turn-values,inputs,mcp-settings}.ts`. 바꾸는 말은 `cleanup-core.md` 할 일 7과 같다(role → place 종류, Operator → agent, App Engineer → 그 앱 place의 session).
    - 앞 task가 제자리에서 바꾼 file의 남은 것: `packages/protocol/{jobs,runs,workflows,events}/*`(옛 `case "project_manager"` 같은 가지, `placeOfAgentRef`를 말하는 주석), `packages/sdk/flow/{wire.ts,mod.ts,guide.md}`(`NamedAgent`, `{ role, place?, name? }` 예시), `packages/sdk/declaration/guide.md`, `packages/coding-agent/cli/**`와 `packages/protocol/coding-agent/cli-commands.ts`(`pm:`·`ae:`·`operator:` 도움말, `{ role: "lophn" }` fixture).
    - `role` 낱말이 다른 뜻인 곳은 둔다: `packages/coding-agent/harnesses/hook-bodies.ts`(harness transcript의 message role), annotation 대상 element의 role(`packages/protocol/apps/annotation.ts`).

11. `tests`에 남은 것을 지운다(README "저장과 test", "뼈대 검토"의 eval 기록).
    - 계획을 열 때 wave 3 어느 task도 소유하지 않은 곳: `tests/live/chatgpt_test.ts`(`openSession(core, { role: "lophn" })`. `tests/support`의 새 도우미 꼴로 바꾼다).
    - 앞 task가 남겼을 수 있는 곳: `tests/support/fake-server/server_test.ts`(`operator_create`, 이름 `pm`), `tests/support/app/activate.ts`, `tests/eval/materials/operators-home/`(`"kind": "operator"`), `tests/eval/registry/`, `tests/eval/experiment/**/*_test.ts`. 이름·주석·fixture면 고친다. eval scenario·material·restore의 꼴을 다시 써야 하는 것(`eval-scenarios`가 못 옮긴 일)이면 고치지 말고 보고의 "알려진 미완 동작"에 적는다. eval은 돌리지 않는다.
    - 지난 eval 기록(`tests/eval/runs/`, `tests/eval/scorecards/`, `tests/eval/experiments/`)과 git이 추적하지 않는 `tests/eval/materials/calendar-app-*`는 고치지 않는다.
    - 새 e2e를 만들지 않는다. `tests/e2e`를 고쳤으면 보고에 적는다. lead가 land 때 `npm run e2e`로 돌린다.

12. 지운 file과 export를 가리키던 `packages/protocol/**/mod.ts`·`registry.ts` 줄을 빼고(위 lead 몫 참고) 보고의 "등록할 것"에 적는다. 끝나면 "남지 않음"의 grep, `npm run check:full`, core 두 번 기동(`project-docs/plan/tools/lead/boot.sh`)을 한다. `boot.sh`는 route 중복 검사(`dup-routes.ts`)도 돈다.

**뼈대 검토로 더한 일 (planner):** test 쪽에 남긴 옛 것이다. 남아 있으면 새 꼴로 바꾸고 지운다.
- `tests/support`의 옛 `openSession` helper(e2e-agents가 `openPlaceSession` 옆에 남겼다)와 그것을 쓰는 `tests/eval/runner/steps.ts`, `tests/live/*`
- `aeTurn`·`aeToolResult`·`aeLane`·`TestApp.ae`(e2e-agents가 남겼다)
- 찾기: `git grep -n "openSession(\|aeTurn\|aeToolResult\|aeLane\|\.ae\b" tests`

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(actor 종류와 route를 지웠다).
- 위험 test: "`coding_agent`를 뺀 뒤에도 남은 actor의 credential 발급·상한 검사와 사람만 하는 결정·할당 검사가 그대로 통과한다." 새로 쓰지 않고 지금 test에서 `coding_agent` 경우만 뺀다: `packages/core/server/identity/registry_test.ts`, `packages/core/approvals/approvals_test.ts`, `packages/core/approvals/assignment/commands_test.ts`. 근거: `project-docs/architecture/approval.md`.
- 남지 않음: 계획 끝남 grep(README "lead가 할 일", roadmap "끝남 기준"). `grep -rn`은 `node_modules`·`dist`·추적 안 되는 file까지 읽으니 `git grep`으로 하고 eval의 지난 기록을 뺀다. 아래가 모두 0줄이다.
  ```sh
  git grep --untracked -nIiE "project[-_ ]?manager|app[-_ ]?engineer|operator" -- packages tools tests ':!tests/eval/runs' ':!tests/eval/scorecards' ':!tests/eval/experiments' ':!tests/eval/materials/calendar-app-*'
  git grep --untracked -nIwE "PM|AE|CE|pm|ae" -- packages tools tests ':!tests/eval/runs' ':!tests/eval/scorecards' ':!tests/eval/experiments' ':!tests/eval/materials/calendar-app-*'
  git grep --untracked -nwE "ROLES|roleSchema|rolePlaceFits|AgentRef|agentRefSchema|agentRefOutputSchema|placeOfAgentRef|agentRefOfColumns|agentIdentityOf|CallAgent|callAgentSchema|callAgentOutputSchema|NamedAgent|namedAgentSchema|CallTo|CallToInput|callToSchema|CallEnvelope|AgentCallRecord|AgentSession|OperatorDefinition|operatorDefinitionSchema|AgentDefinitionRow|AgentAssignment|agentAssignmentSchema|BUILTIN_ROLE_NAMES|agentKindSchema|codingOptionsSchema|CodingOptions|AGENT_SESSION_ROUTES|openAgentSession|agentSessionRead|agentSessionList|sessionCompactRequests|closeSession|CALL_ROUTES|callSend|callSendable|callRead|AGENT_DEFINITION_ROUTES|agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_ASSIGNMENT_ROUTES|agentAssignmentGet|agentAssignmentSet|resolveNamed|queued_coding|projectResolveCwd" -- packages tools tests ':!tests/eval/runs' ':!tests/eval/scorecards' ':!tests/eval/experiments'
  git grep --untracked -nIw coding_agent -- packages tools tests ':!tests/eval/runs' ':!tests/eval/scorecards' ':!tests/eval/experiments'
  git grep -nE "idSchema\(\"cac\"\)|\bcac:" -- packages
  git grep -nwE "Role|openSession|sessionList|BuiltinDefinition|AGENT_KINDS" -- packages/protocol
  git ls-files packages tools tests | grep -iE "role|operator|project-manager|app-engineer|pm-tools" | grep -vE "^tests/eval/(runs|scorecards|experiments)/"
  ```
  첫 줄은 README의 `grep -rn "project_manager\|app_engineer\|Project Manager\|App Engineer" packages tools tests`와 roadmap의 role 값 `"operator"`·`Operator`를 모두 덮는다. 정한 것: `tests/eval/experiments/`는 통째로 뺀다. README는 `*/{report.md,spec.json}`만 적었지만 `run.md`도 그때의 실행 기록이다(`eval-scenarios.md`, `agent-places-rename.md`도 `experiments/*/`를 뺀다).
- `role` 낱말은 다른 뜻으로만 남는다. 아래에 남는 줄은 model 메시지 role, HTML·ARIA와 annotation 대상 element의 role, harness transcript의 role(`packages/coding-agent/harnesses/hook-bodies.ts`), shell 창·preload의 role, 이 저장소 개발 agent의 role(`tools/check-docs.ts`), `tools/move-files.ts`의 `Role`, `tools/check-source.ts` 금지어, eval experiment의 scenario 역할(`tests/eval/experiment/`의 `target`·`guard`·`case`)뿐이다:
  ```sh
  git grep --untracked -nIE "[Rr]ole|ROLE|역할" -- packages tools tests ':!tests/eval/runs' ':!tests/eval/scorecards' ':!tests/eval/experiments' | grep -vE 'role="|role=\{|aria-|getByRole|role: "(user|assistant|system|tool|developer)"|message\.role|\.role === "(user|assistant)"'
  ```
  소유 밖(`packages/core`의 다섯 폴더 밖, `packages/shell`, `packages/design`, `tools`)에 줄이 남으면 고치지 말고 보고한다. lead가 처리한다.

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
