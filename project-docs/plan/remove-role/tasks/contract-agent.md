# contract-agent

agent의 정체와 정의를 바꾸는 계약을 `packages/protocol`에 옛 꼴 옆에 더한다: agent id, place 종류, (agent, place) 짝, 이름 주소, 하나로 합친 정의 꼴, 전역 정의 route(`agents/*`), 할당 route, 내장 skill의 place 종류. 쓰는 곳이 core 안 몇 곳뿐인 role 칸(trace·usage의 `role`, `scope.ts`)과 이름 몇 개는 제자리에서 고친다.

- 단위: contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{places,agent-values,operators,agent-definitions,skill-settings,traces,scope,mcp-settings}.ts`
  - `packages/protocol/approvals/assignment.ts`
  - `packages/protocol/apps/declaration/types.ts`
  - `packages/core/lophn-agent/observability/reads.ts` (넘길 줄: trace의 role 거르기를 지운다)
  - `packages/core/lophn-agent/usage/reads.ts` (넘길 줄: usage의 role 묶음을 지운다)
  - `packages/core/lophn-agent/extensions/mcp-tool-requests.ts` (넘길 줄: MCP tool 목록의 `agent`를 넓힌다)
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" > "agent와 정의"(정의 꼴은 하나, lophn은 고정 id의 내장 정의, 이름은 전역에 하나이고 `lophn`은 예약, `agent.create`·`agent.update`, 할당·정의 층 MCP server·skip은 사람만), "session과 place 종류"의 "내장 skill은 place 종류로 준다", "뼈대 검토"(계약은 일부만 옛 꼴 옆에, 새 type 이름 `AgentId`, trace와 usage의 role 거르기는 지운다)
  - roadmap: `project-docs/products/roadmap/remove-role.md`의 "지금 코드" > "role이 정하는 것"(정의 자리와 칸, 내장 skill, 죽은 코드 `scope.ts`)
  - architecture: `project-docs/architecture/agent-definition.md`의 "지키는 것"(MCP server 층과 `mcp_servers`, 정의의 `skip`, "Operator 정의를 만들고 고치는 tool은 할당을 주지 못한다", 내장 skill 선언 `BUILTIN_SKILLS`), `project-docs/architecture/approval.md`의 "흐름"(할당 줄 `{app, removed_tools}`), `project-docs/architecture/place-session.md`의 "지키는 것" 첫 묶음
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `agents`, `approvals`, interface `core-api`. `project-docs/module-catalog.yaml`의 `packages/protocol`(boundary `protocol`), `packages/core/lophn-agent`(boundary `lophn-agent`)
  - 고칠 코드: 소유 file 전부. 특히 `packages/protocol/lophn-agent/places.ts`(옛 `ROLES`·`AgentRef`와 `placeSchema`), `agent-values.ts`(`frontmatterFields`, `agentDefinitionSchema`), `operators.ts`(`mcpServersSchema`, `operatorDefinitionSchema`, `builtinDefinitionSchema`), `agent-definitions.ts`(옛 route 여덟과 공용 상수 `writeErrors`·`readErrors`·`readActors`·`saveCompareSchema`·`existingCompareSchema`·`agentSourced`·`agentDefinitionIssueSchema`), `mcp-settings.ts`(`mcpServerSchema`, 87줄 `mcpAuthPlaceSchema`, `mcpToolsList`·`mcpToolsRequestTake`)
  - 읽기만:
    - `packages/protocol/base/route.ts`: `defineRead`·`defineCommand`·`defineUpload`·`defineFile`. route 값의 `.input`은 넘긴 schema 그대로다.
    - `packages/protocol/base/ids.ts`: `idSchema`, `Id`
    - `packages/protocol/lophn-agent/{registry,mod}.ts`, `packages/protocol/approvals/mod.ts`: 고치지 않는다. mod.ts가 소유 file을 이미 모두 `export *`한다.
    - `packages/protocol/lophn-agent/calls.ts`의 `namedAgentSchema`: 지금 이름 주소의 모양
    - `packages/core/main/tool-names_test.ts`: `RESERVED_DOMAIN_NAMES`를 보는 test
    - `packages/core/main/agent-runtime/mcp-tools-pump.ts`, `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `listTools`: MCP 목록 요청의 `agent`를 `string | null`로 받는 쪽
- 계약:
  - 쓰는 것: 지금의 `packages/protocol/lophn-agent/{places,agent-values,operators,agent-definitions}.ts`, `packages/protocol/approvals/assignment.ts`
  - 내놓는 것: 아래 이름을 뒤 wave가 그대로 쓴다. 옛 이름(`Role`, `AgentRef`, Operator·built-in 정의 꼴과 route, `agentAssignment*`)은 지우지 않는다(wave 4 `cleanup-protocol`이 지운다). 새 route는 registry(`registry.ts`)에 넣지 않는다. 구현 task가 합쳐질 때 lead가 옛 route를 새 route로 바꿔 넣는다.
    - `places.ts` 값:
      - `LOPHN_AGENT_ID = "lophn"`, `agentIdSchema = z.union([z.literal(LOPHN_AGENT_ID), idSchema("agt")])`, `type AgentId`. agent를 가리키는 값이고 `AgentRef`를 대신한다. 정의 파일 이름이 id다(`<data>/agents/<id>.md`).
      - `PLACE_KINDS = ["home", "project", "app"]`, `placeKindSchema`, `type PlaceKind`, `placeKindOf(place: Place | null): PlaceKind`(null이면 home). `Place`(project | app)는 그대로다.
      - `agentAtPlaceSchema`(strict)·`agentAtPlaceOutputSchema` = `{ agent: AgentId, place: Place | null }`, `type AgentAtPlace`. session의 정체, job을 만든 쪽, run의 agent 대상, call의 새 session 대상이 쓴다.
      - `placeNameSchema` = `{ project: string } | { app: string }`(이름이나 id), `agentAddressSchema` = `{ agent: string(agent 이름), place?: placeNameSchema }`, `type AgentAddress`. 이름으로 가리키는 받는 쪽이다. place가 없으면 home이다(workflow 참가자만 instance의 project, `contract-session` 참고).
    - `agent-values.ts` 정의:
      - `agentDefinitionSchema`·`agentDefinitionOutputSchema`를 제자리에서 하나뿐인 정의 꼴로 바꾼다: `name`(필수), `profile?`, `model?`, `skills?`, `domains?`, `mcp_off?`, `mcp_servers?`, `skip?`, `body`. `type AgentDefinition`. 지금 Operator 꼴과 같다(README "정의 꼴은 하나다"). `operators.ts`의 두 꼴은 이것에서 만들어 옛 소비자가 그대로 돈다.
      - `LOPHN_AGENT_NAME = "lophn"`: 전역 예약 이름. `agentNameKey`로 견준다.
    - `agent-definitions.ts` route(새 resource `agents`, 옛 route 옆):
      - `agentRowSchema`·`type AgentRow` = `{ agent: AgentId, name, profile, model: { provider, model_name, source } | null, issues, counts }`.
      - `agentList`: read `agents/list` `ListAgents`, input `{}`, output `{ agents: AgentRow[] }`(lophn이 첫 줄), actors user·machine·agent.
      - `agentRead`: read `agents/read` `ReadAgent`, input `{ agent: AgentId, place?: Place }`(place는 effective의 model 층과 받는 domain을 셀 자리, 없으면 home), output `{ agent, definition: AgentDefinition | null, hash, effective: { name, profile, model, domains }, issues }`.
      - `agentCreate`: command `agents/create` `CreateAgent`, input `{ id: Id<"agt">, definition }`, output `{ agent, hash }`, actors user·agent.
      - `agentChange`: command `agents/change` `ChangeAgent`, input `{ agent: AgentId, definition }`, compare `{ hash: sha256 | null }`, output `{ agent, hash }`, actors user·agent. lophn의 name·profile을 바꾸면 `forbidden`.
      - `agentDelete`: command `agents/delete` `DeleteAgent`, input `{ agent: AgentId }`, compare `{ hash }`, output `{ agent, hash }`, actors user. lophn이면 `forbidden`.
      - `agentProfileImageUpload`·`agentProfileImageRead`: 옛 `profile-images/upload`·`read`와 resource·method·name이 같고 input의 `agent`만 `AgentId`다(shell allowlist가 이 이름으로 열어 둔다).
      - `AGENT_ROUTES` = 위 일곱. `agents-core`가 합쳐질 때 registry의 `AGENT_DEFINITION_ROUTES` 자리에 들어간다.
    - `approvals/assignment.ts` 할당(옛 것 옆): `assignmentSchema`·`type Assignment` = `{ agent: AgentId, entries }`, `assignmentGet`(`agent_assignments/get` `GetAgentAssignment`, input `{ agent: AgentId }`, output `{ assignment: Assignment, revision }`), `assignmentSet`(`agent_assignments/set` `SetAgentAssignment`, input `{ agent: AgentId, entries }`), `ASSIGNMENT_ROUTES`. `agents-core`가 합쳐질 때 `AGENT_ASSIGNMENT_ROUTES` 자리에 들어간다.
    - `skill-settings.ts`: `BUILTIN_SKILLS` 칸마다 `places: readonly PlaceKind[]`를 `roles` 옆에 더한다. home: guide-* 여덟, `new-app`, `repair-app`, `guide-domains`. project: `guide-domains`, `guide-artifact`, `kinds-yaml`, `guide-workflows`, `check-kinds`. app: `guide-domains`, `guide-artifact`, `kinds-yaml`, `design-app`.
    - 제자리 변경:
      - `traces.ts`: `ReadAgentTrace` input의 `role`, `ReadAgentUsage` input의 `role`과 묶음의 `role`을 지운다. `scope.ts`의 `agentRoleSchema`와 `agentAppScope*`(쓰는 곳 없음)를 지운다.
      - `mcp-settings.ts`: `ListMcpTools`·`TakeMcpToolsRequest`의 `agent`를 `agentIdSchema.nullable()`로 넓힌다(lophn도 정의 층 MCP server를 갖는다).
      - `apps/declaration/types.ts`: `RESERVED_DOMAIN_NAMES`에 `agent`를 더한다(tool 이름 `agent.create`·`agent.update`). `operator`는 `operator.*` tool이 남는 동안 남기고 wave 4 `cleanup-protocol`이 지운다.

## 할 일

새 꼴은 옛 꼴 옆에 더하고 옛 export는 지우거나 모양을 바꾸지 않는다(README "뼈대 검토": 계약은 일부만 옛 꼴 옆에 둔다). 새 route는 `registry.ts`와 `mod.ts`에 넣지 않는다. 새 값과 route 묶음은 file 끝(옛 꼴 뒤)에 모은다. wave 4가 옛 것을 지울 때 diff가 깨끗하다. 있는 줄을 고치는 번호(1, 3, 4, 7~10번)는 그 자리에서 고친다.

1. **import 순환을 먼저 끊는다**(`mcp-settings.ts`).
   - 3번에서 `agent-values.ts`가 `mcp-settings.ts`의 `mcpServerSchema`를 import한다.
   - 지금 `mcp-settings.ts`는 `agent-values.ts`의 `agentPlaceSchema`·`agentPlaceOutputSchema`를 import한다. 그리고 module top level에서 쓴다(87줄 `mcpAuthPlaceSchema`, `mcpAuthState` output).
   - 그대로 두면 module을 실을 때 TDZ `ReferenceError`가 난다. `mcp-settings_test.ts`가 `mcp-settings.ts`를 먼저 import한다.
   - 이 import를 `./places.ts`의 `placeSchema`·`placeOutputSchema`로 바꾼다. 모양이 같아 type은 그대로다.
   - `agent-values.ts`의 `agentPlaceSchema`·`AgentPlace`는 core가 쓰므로 남긴다.
   - `places.ts`도 `agent-values.ts`·`mcp-settings.ts`를 import하지 않는다. 같은 순환이 생긴다.
2. **`places.ts`**: file 끝에 더한다. `placeSchema` 뒤라 참조가 맞는다. 근거는 README "`AgentRef`는 agent id 하나다", "session의 정체는 (agent id, place)다", "call의 `to`는 `{session}`이나 `{agent, place?}`다"다.
   - `export const LOPHN_AGENT_ID = "lophn"`.
   - `agentIdSchema = z.union([z.literal(LOPHN_AGENT_ID), idSchema("agt")])`, `type AgentId = z.infer<typeof agentIdSchema>`.
     - `idSchema`는 `string`으로 infer되므로 `AgentId`도 `string`이다. 다른 id 값과 같게 둔다(정한 것: 좁힌 template literal type이면 parse한 값이 바로 대입되지 않아 뒤 task마다 cast가 는다).
   - `PLACE_KINDS = ["home", "project", "app"] as const`, `placeKindSchema = z.enum(PLACE_KINDS)`, `type PlaceKind`.
   - `placeKindOf(place: Place | null): PlaceKind`: null이면 `"home"`, 아니면 `place.kind`다.
   - `agentAtPlaceSchema = z.strictObject({ agent: agentIdSchema, place: placeSchema.nullable() })`.
   - `agentAtPlaceOutputSchema = z.object({ agent: agentIdSchema, place: placeOutputSchema.nullable() })`.
   - `type AgentAtPlace = z.infer<typeof agentAtPlaceSchema>`.
   - `placeNameSchema = z.union([z.strictObject({ project: z.string().min(1) }), z.strictObject({ app: z.string().min(1) })])`. 지금 `namedAgentSchema.place`(`calls.ts` 51~58줄)와 같은 모양이다.
   - `agentAddressSchema = z.strictObject({ agent: z.string().min(1), place: placeNameSchema.optional() })`, `type AgentAddress`.
     - strictObject여야 한다. `contract-session`이 `agentAddressSchema.extend({ session, fallback })`로 call 주소를 만든다. union의 갈래는 strict라야 칸으로 갈린다.
   - 주석은 "왜"만 쓴다. 예: place 없는 주소는 home이다. lophn id는 정의 file 이름(`<data>/agents/lophn.md`)과 같다.
3. **`agent-values.ts`**: 정의 꼴을 제자리에서 하나로 만든다(README "정의 꼴은 하나다").
   - `operators.ts`의 `mcpServersSchema`(최대 32개, 이름 겹침 거절)를 여기로 옮긴다. `import { mcpServerSchema } from "./mcp-settings.ts"`를 쓴다. 사본을 두지 않는다.
   - `frontmatterFields`·`frontmatterOutputFields`를 고친다.
     - `name`은 필수(`agentNameSchema`)다.
     - `mcp_servers: mcpServersSchema.optional()`, `skip: z.boolean().optional()`를 더한다.
     - 칸 순서는 name, profile, model, skills, domains, mcp_off, mcp_servers, skip이다.
     - `agentDefinitionSchema`(strict)·`agentDefinitionOutputSchema`는 지금처럼 `{ ...fields, body }`다.
   - `export type AgentDefinition = z.infer<typeof agentDefinitionSchema>`.
   - `export const LOPHN_AGENT_NAME = "lophn"`. 주석에 이유를 쓴다: 주소가 이름이라 agent 이름은 전역에 하나이고 이 이름은 예약이다.
   - 칸 위 주석을 고친다. 지금 주석은 "built-in은 name 없음 … 역할과 자리를 알아야"다.
     - 모든 agent가 같은 칸을 갖는다.
     - lophn의 name·profile 잠금과 사람만 쓰는 칸(`mcp_servers`, `skip`) 거절은 저장하는 쪽(core)이 본다.
   - 남기는 것(옛 소비자가 쓴다): `agentPlaceSchema`, `agentKindSchema`, `BUILTIN_ROLE_NAMES`, `agentNameKey`.
4. **`operators.ts`**: 옛 두 꼴을 새 꼴에서 만든다(계약 "`operators.ts`의 두 꼴은 이것에서 만들어").
   - `operatorDefinitionSchema = agentDefinitionSchema`, `operatorDefinitionOutputSchema = agentDefinitionOutputSchema`, `type OperatorDefinition = AgentDefinition`.
     - 지금 Operator 꼴(name 필수, `mcp_servers`, `skip`)과 칸이 같다. 옛 소비자가 그대로 돈다.
   - `builtinDefinitionSchema`·`builtinDefinitionOutputSchema`는 지금처럼 `pick(builtinKeys)`다.
   - 옮긴 `mcpServersSchema`, `mcp-settings.ts` import, 쓰지 않게 된 `definitionKeys`를 지운다.
5. **`agent-definitions.ts`**: 새 route 일곱을 옛 `AGENT_DEFINITION_ROUTES` 뒤에 더한다.
   - 위에 이미 있는 공용 상수를 쓴다: `writeErrors`, `readErrors`, `readActors`, `saveCompareSchema`, `existingCompareSchema`, `agentSourced`, `agentValueLayerSchema`, `agentDefinitionIssueSchema`.

   | 이름 | 종류 | resource/method, name | input | output | compare | actors | errors |
   |---|---|---|---|---|---|---|---|
   | `agentRowSchema` (`z.object`) | 값 | - | - | `{ agent: agentIdSchema, name: agentNameSchema, profile: profileOutputSchema, model: { provider: idSchema("pvd"), model_name, source: agentValueLayerSchema } \| null, issues: agentDefinitionIssue[], counts: agentCountsSchema }`. 옛 `agentDefinitionRowSchema`에서 `kind`·`place`를 뺀 것 | - | - | - |
   | `agentList` | `defineRead` | `agents/list`, `ListAgents` | `z.strictObject({})` | `withReadCommon({ agents: AgentRow[] })` | - | `readActors` | `readErrors` |
   | `agentRead` | `defineRead` | `agents/read`, `ReadAgent` | `{ agent: agentIdSchema, place: placeSchema.optional() }` | `withReadCommon({ agent, definition: agentDefinitionOutputSchema.nullable(), hash: sha256.nullable(), effective, issues })`. `effective`는 옛 `agentDefinitionRead`와 같다: `name`·`profile`·`model`은 `agentSourced(...)`, `model`은 nullable, `domains: dom id[]` | - | `readActors` | `readErrors` |
   | `agentCreate` | `defineCommand` | `agents/create`, `CreateAgent` | `{ id: idSchema("agt"), definition: agentDefinitionSchema }` | `{ agent: agentIdSchema, hash }` | 없음(옛 `operatorCreate`처럼) | user, agent | `writeErrors` |
   | `agentChange` | `defineCommand` | `agents/change`, `ChangeAgent` | `{ agent: agentIdSchema, definition: agentDefinitionSchema }` | `{ agent, hash }` | `saveCompareSchema` | user, agent | `writeErrors` |
   | `agentDelete` | `defineCommand` | `agents/delete`, `DeleteAgent` | `{ agent: agentIdSchema }` | `{ agent, hash }` | `existingCompareSchema` | user | `writeErrors` |
   | `agentProfileImageUpload` | `defineUpload` | `profile-images/upload`, `UploadProfileImage` | 옛 `uploadProfileImageInputSchema`에서 `agent`만 `agentIdSchema` | 옛 것과 같다 | - | user | 옛 것과 같다 |
   | `agentProfileImageRead` | `defineFile` | `profile-images/read`, `ReadProfileImage` | `{ agent: agentIdSchema }` | contentType `application/octet-stream` | - | `readActors` | `readErrors` |

   - `export const AGENT_ROUTES = [agentList, agentRead, agentCreate, agentChange, agentDelete, agentProfileImageUpload, agentProfileImageRead] as const`.
   - input schema는 따로 export하지 않는다(정한 것: 쓰는 쪽은 route 값의 `.input`으로 닿는다. 예: `mcpToolsList.input`).
   - 새 묶음 위에 주석 두세 줄을 쓴다.
     - 정의는 전역이고 id가 file 이름이다.
     - agent 자격은 목록, 읽기, 만들기, 고치기만 한다.
     - lophn의 name·profile을 바꾸거나 lophn을 지우면 `forbidden`이다.
     - 할당, `mcp_servers`, `skip`은 사람만 정하고 agent가 주면 core가 거절한다(`agent-definition.md` "Operator 정의를 만들고 고치는 tool은 할당을 주지 못한다").
6. **`packages/protocol/approvals/assignment.ts`**: 할당 route를 file 끝에 더한다(README "할당, 정의 층 MCP server, skip은 여전히 사람만 정한다", `approval.md`).
   - `assignmentSchema = z.strictObject({ agent: agentIdSchema, entries: entriesSchema })`, `type Assignment`.
   - `assignmentGet`: 옛 `agentAssignmentGet`과 resource·method·name·actors(user, machine)·errors가 같다.
     - input은 `{ agent: agentIdSchema }`다.
     - output은 `withReadCommon({ assignment: assignmentSchema, revision: assignmentRevisionSchema })`다.
   - `assignmentSet`: 옛 `agentAssignmentSet`과 같다.
     - input은 `{ agent: agentIdSchema, entries: entriesSchema }`다.
     - compare는 `{ revision }`, output은 `{ assignment: assignmentSchema, revision }`, actors는 user다.
   - `ASSIGNMENT_ROUTES = [assignmentGet, assignmentSet] as const`.
   - `agentIdSchema`는 `../lophn-agent/places.ts`에서 import한다. 지금 `agentRefSchema`를 가져오는 곳이다.
7. **`skill-settings.ts`**: `BUILTIN_SKILLS` 원소 type의 `roles` 옆에 `places: readonly PlaceKind[]`를 더한다. import는 `import type { PlaceKind, Role } from "./places.ts"`다. 칸마다 아래처럼 채운다(README "내장 skill은 place 종류로 준다").

   | skill | `places` |
   |---|---|
   | guide-* 여덟(`guide-features-and-screens`, `guide-roles-and-assignments`, `guide-questions-and-decisions`, `guide-settings`, `guide-connections`, `guide-skills-and-mcp`, `guide-instructions`, `guide-rewind`), `new-app`, `repair-app` | `["home"]` |
   | `guide-domains` | `["home", "project", "app"]` |
   | `guide-artifact`, `kinds-yaml` | `["project", "app"]` |
   | `guide-workflows`, `check-kinds` | `["project"]` |
   | `design-app` | `["app"]` |

   - `roles`는 그대로 둔다. core가 아직 읽는다.
   - skill 이름은 바꾸지 않는다. `guide-roles-and-assignments`의 이름 바꾸기는 `place-prompts`가 한다.
8. **trace·usage의 role을 지운다**(README "뼈대 검토": trace와 usage의 role 거르기는 대신할 것 없이 지운다).
   - `traces.ts`: `agentTraceReadInputSchema`·`usageGroupSchema`·`agentUsageReadInputSchema`의 `role` 칸과 `agentRoleSchema` import를 지운다.
   - `packages/core/lophn-agent/observability/reads.ts`: `roleMatches`(74줄)를 지우고 쓰는 곳을 고친다.
     - `turnTarget`: 조건에서 `roleMatches`를 뺀다.
     - `callTarget`: `visible`은 `session === null ? ownSession(ctx) === null : allowed(ctx, session)`이다.
     - `sessionTarget`: `select id from sessions where id = ?`로 session이 있는지만 보고 role 조건을 뺀다. `sessions.role` 열을 읽는 곳이 하나 준다(`sessions-core`가 그 열을 지운다).
   - `packages/core/lophn-agent/usage/reads.ts`: `input.role`을 거절하던 줄(250~257줄), group의 `role: null`(302~303줄), 그 주석을 지운다.
   - `scope.ts`: 아래를 지운다.
     - `agentRoleSchema`, `AGENT_ROLES`, `AgentRole`, `agentAppScopeSchema`·`agentAppScopeOutputSchema`
     - 그것만 쓰는 것: 이 file의 `toolKeySchema`(다른 곳은 모두 `apps/channel-values.ts`의 것을 import한다), `APP_COMMAND_EFFECTS`, `appToolEffectSchema`, `uniqueList`, `agentAppScope*Fields`와 entry schema, `scopeShape`
     - 맨 위 "역할 식별자의 정본" 주석
   - `scope.ts`의 `workPlaceSchema`·`workPlaceOutputSchema`는 `sessions.ts`가 쓰므로 남긴다.
9. **MCP tool 목록의 `agent`를 넓힌다**(`agent-definition.md` "Operator 정의 층의 MCP server". 정의 꼴이 하나라 lophn도 정의 층 MCP server를 갖는다).
   - `mcp-settings.ts`: `mcpToolsList` input의 `agent`와 `mcpToolsRequestTake` output의 `request.agent`를 `agentIdSchema.nullable()`로 바꾼다.
   - 위 주석 "agent는 Grants를 여는 Operator의 id … Operator가 아니면 null"을 고친다: Grants를 여는 agent의 id(lophn 포함)이고, 정의 층을 더하지 않을 때 null이다.
   - `packages/core/lophn-agent/extensions/mcp-tool-requests.ts`: `Entry.request.agent`의 type을 `AgentId | null`로 바꾼다. `type AgentId`는 protocol `lophn-agent/mod.ts`에서 import한다. 동작은 그대로다.
   - 받는 쪽(`mcp-tools-pump.ts`, `mcp-toolkit.ts`의 `listTools`)은 `string | null`이라 고치지 않는다. lophn의 정의 층을 실제로 읽게 하는 것은 `agents-core`다.
10. **`packages/protocol/apps/declaration/types.ts`**: `RESERVED_DOMAIN_NAMES`에 `"agent"`를 더한다. tool `agent.create`·`agent.update`의 자원 이름이다.
    - **`"operator"`는 지우지 않는다**(정한 것). 계약 줄은 "바꾼다"지만 그대로 하면 이 task의 check가 깨진다.
      - `operator.create`·`operator.update`는 `agents-core`(wave 2)까지 `TOOL_ORDER`(`packages/core/agent-roles/tool-lists.ts`)에 남는다.
      - `packages/core/main/tool-names_test.ts`가 모든 내장 tool의 자원 이름이 예약인지 본다.
    - 보고의 "계약 바꾸기 요청"에 적는다: `"operator"`는 tool 이름이 바뀐 뒤(`agents-core` 뒤에 protocol을 고치는 task) 지운다.
11. 지우거나 바꾼 이름(`agentRoleSchema`, `role` 칸, `agentPlaceSchema` import, `mcpServersSchema`)을 `grep -rn`한다. 소유 file의 주석과 오류 글에 남은 것을 고친다. 소유 밖 file이 type check에서 깨지면 고치지 말고 보고한다. 조사한 바로는 깨지는 곳이 없다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음.
  - 꼴만 더하고 판정 규칙을 만들지 않는다. zod가 보장하는 꼴은 test하지 않는다(`write-test`).
  - 지금 test 가운데 둘이 그대로 통과한다. `packages/protocol/lophn-agent/mcp-settings_test.ts`는 import 순환이 남으면 module을 싣다 실패한다. `packages/core/main/tool-names_test.ts`는 예약 이름을 본다.
- 남지 않음:
  - `grep -rn "agentRoleSchema\|agentAppScope" packages tools tests --exclude-dir=node_modules`가 0줄이다.
  - `grep -n "role" packages/protocol/lophn-agent/traces.ts packages/core/lophn-agent/observability/reads.ts packages/core/lophn-agent/usage/reads.ts`가 0줄이다.
  - `grep -n "agent-values" packages/protocol/lophn-agent/mcp-settings.ts`가 0줄이다.
- 새 이름이 있다:
  - `grep -cE "^export (const|type|function) (LOPHN_AGENT_ID|agentIdSchema|AgentId|PLACE_KINDS|placeKindSchema|PlaceKind|placeKindOf|agentAtPlaceSchema|agentAtPlaceOutputSchema|AgentAtPlace|placeNameSchema|agentAddressSchema|AgentAddress)\b" packages/protocol/lophn-agent/places.ts`가 13이다.
  - `grep -cE "^export (const|type) (agentDefinitionSchema|agentDefinitionOutputSchema|AgentDefinition|LOPHN_AGENT_NAME)\b" packages/protocol/lophn-agent/agent-values.ts`가 4다.
  - `grep -cE "^export (const|type) (agentRowSchema|AgentRow|agentList|agentRead|agentCreate|agentChange|agentDelete|agentProfileImageUpload|agentProfileImageRead|AGENT_ROUTES)\b" packages/protocol/lophn-agent/agent-definitions.ts`가 10이다.
  - `grep -cE "^export (const|type) (assignmentSchema|Assignment|assignmentGet|assignmentSet|ASSIGNMENT_ROUTES)\b" packages/protocol/approvals/assignment.ts`가 5다.
- 옛 이름이 그대로다:
  - `grep -cE "^export (const|type|function) (ROLES|roleSchema|Role|rolePlaceFits|agentRefSchema|agentRefOutputSchema|AgentRef|placeOfAgentRef|agentRefOfColumns|agentIdentityOf)\b" packages/protocol/lophn-agent/places.ts`가 10이다.
  - `grep -cE "^export const (agentDefinitionList|agentDefinitionRead|operatorCreate|operatorChange|operatorDelete|builtinAgentChange|profileImageUpload|profileImageRead|AGENT_DEFINITION_ROUTES)\b" packages/protocol/lophn-agent/agent-definitions.ts`가 9다.
  - `grep -cE "^export (const|type) (agentAssignmentSchema|AgentAssignment|agentAssignmentGet|agentAssignmentSet|AGENT_ASSIGNMENT_ROUTES)\b" packages/protocol/approvals/assignment.ts`가 5다.
  - `git diff --stat plan/remove-role...HEAD -- packages/protocol/registry.ts packages/protocol/lophn-agent/registry.ts packages/protocol/lophn-agent/mod.ts packages/protocol/approvals/mod.ts`가 비었다.

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
