# wf-contract-shapes

unattended 표시를 싣는 지금의 call 봉투 위에, workflow 선언 file의 꼴과 parsed type, 읽기 port(`WorkflowReader`), call 봉투의 `workflow`·`participant` 칸과 receiver tag 속성, place 층 workflow 절의 type과 notice 종류를 옛 계약 옆에 더해 고정한다. model에 보이는 call 입력에는 아직 새 칸을 열지 않는다.

- 단위: contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/domains/paths.ts`
  - `packages/protocol/lophn-agent/workflow-file.ts` (새 file)
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/lophn-agent/inputs.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/protocol/projects/project-api.ts`
  - `packages/core/lophn-agent/tools/ports.ts`
  - `packages/core/lophn-agent/tools/tool-context.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/run-loop/unwired.ts`
  - `packages/core/lophn-agent/prompt-assembly/model.ts`
  - `packages/core/lophn-agent/tools/bundles/call.ts`
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것", roadmap `project-docs/products/roadmap/workflow.md`의 "모양 > 선언"
  - architecture: `project-docs/architecture/agent-call.md`("다른 agent·program이 보낸 입력은 … 같은 함수로 태그에 싼다", "unattended는 call을 따라 간다", "주소는 session ID다"), `project-docs/architecture/agent-definition.md`("도는 turn은 시작 때 읽은 판을 끝까지 쓴다", "같은 재료는 같은 bytes다", "place 정보에는 잘 안 바뀌는 목록만"), `project-docs/architecture/domain.md`("`DOMAIN.md`·`kinds.yaml`·`skills/`는 그 그릇의 PM이나 App Engineer만 쓴다", "읽기는 그릇 안이다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `domains`, `agent-tools`, `run-loop`, `agent-tool-spi`; `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/lophn-agent`
  - import 규칙: `tools/check-deps.ts`(`protocol-cycle`, `harness-domain`)
  - 본보기(코드): `packages/protocol/domains/paths.ts`(자리 함수), `packages/protocol/lophn-agent/calls.ts`(`namedAgentSchema`, `callSendInputSchema`), `packages/protocol/lophn-agent/inputs.ts`(`receivedEnvelopeSchema`), `packages/core/lophn-agent/tools/ports.ts`(`SkillReader`), `packages/core/lophn-agent/run-loop/unwired.ts`
- 계약:
  - 쓰는 것:
    - 지금 봉투: `callSendInputSchema`(`unattended: z.literal(true).optional()`이 있다), `CallEnvelope`(`calls.ts`), `receivedEnvelopeSchema`(`inputs.ts`), `INPUT_TAG_ATTRIBUTES`·`NOTICE_KINDS`(`input-tags.ts`)
    - `roleSchema`·`Role`(`packages/protocol/lophn-agent/places.ts`), `NamedAgent`(`calls.ts`), `Result`(`packages/base`)
  - 내놓는 것:
    - **선언 file**: `<data>/domains/<dom>/workflows/<name>.md`. `paths.ts`에 `DOMAIN_WORKFLOWS_FOLDER = "workflows"`와 `domainWorkflowsFolder(dataRoot, domain)`.
      - `<name>`은 file 이름에서 `.md`를 뺀 slug(`^[a-z0-9]+(-[a-z0-9]+)*$`)다. 참가자 이름도 같은 slug다.
      - frontmatter(YAML)는 `entry`, `participants`, `contacts` 셋뿐이다(strict). body는 frontmatter 뒤 글 전체이고, 참가자 모두가 읽는 workflow 설명이다.
      - `entry: <참가자>` — 시작 참가자. 사람, run, job이 일을 주는 agent다.
      - `participants: {<참가자>: {role, place?, name?}}` — role은 `lophn | project_manager | app_engineer | operator`(coding agent는 없다). place는 `{project: <이름>} | {app: <이름>}`이고 없으면 그 domain의 그릇이다. name은 Operator만 쓰고 Operator에는 꼭 있다. lophn은 place도 name도 없다.
      - `contacts: {<참가자>: [{to: <참가자>, reply: none | result, session: new | open, when: <한 줄>}]}` — 없어도 된다. `reply: conversation`은 받지 않는다.
      - file은 32 KiB(`INSTRUCTION_FILE_MAX_BYTES`)까지다. 넘으면 그 file은 선언 오류로 빠진다.
    - **parsed type과 오류**(`packages/protocol/lophn-agent/workflow-file.ts`):
      - schema: `workflowFrontmatterSchema`, `workflowParticipantSchema`, `workflowContactSchema`. type: `WorkflowParticipant`, `WorkflowContact`.
      - `WorkflowDeclaration = { key, domain, name, file, entry, participants, contacts, body }` — key는 `<domain 이름>/<name>`(`workflowKey(domain, name)`), file은 `workflows/<name>.md`.
      - `WorkflowError = { domain, file, reason }` — reason은 한 줄이다. 틀린 선언은 그 file만 빼고 여기에 이유를 둔다: YAML·schema 꼴, 구조(`entry`, `contacts`의 열쇠, `to`가 `participants`에 없음), 참가자를 agent로 못 풂, 두 참가자가 같은 agent.
      - 순수 구조 검사 `checkWorkflowStructure(frontmatter): string[]`(이유 목록).
      - `WorkflowListing = { workflows: WorkflowDeclaration[]; errors: WorkflowError[] }` — `workflow.list`의 결과다.
      - `WorkflowMembership = { key, participant, entry: boolean, body, participants: { name, address: NamedAgent, you: boolean }[], contacts: (WorkflowContact & { address: NamedAgent })[] }` — 이 agent가 참가자인 workflow 하나. address는 call의 `to`에 그대로 쓰는 이름 주소다(place를 늘 적는다).
      - `WorkflowRead = { listing: WorkflowListing; memberships: WorkflowMembership[] }`
    - **읽기 port**(`tools/ports.ts`): `interface WorkflowReader { read(): Promise<Result<WorkflowRead>> }` — 부를 때마다 모든 active domain의 `workflows/`를 새로 읽는다. `memberships`는 그 가운데 이 session의 agent가 참가자로 풀리는 선언이고, `listing`은 이 agent의 place 그릇에 속한 domain의 선언과 오류다(place가 없는 lophn은 전부).
      - `ToolContext.workflows: WorkflowReader`, `ToolPorts`에 `"workflows"`, `UNWIRED_TOOL_PORTS.workflows`는 `unavailable`.
      - reader는 `toolPorts(session, turn)`의 `session.agent`와 `session.place`로 묶는다. turn 인자는 바꾸지 않는다.
    - **machine 자격의 project 목록**: `projectApi.list`(`packages/protocol/projects/project-api.ts`)의 actors에 `machine`을 더한다. reader가 다른 그릇의 참가자 이름을 풀려고 runtime의 machine 자격으로 읽는다(`wf-decl-reader`가 `RUNTIME_MACHINE_ROUTES`에 올린다). `projectApi.get`은 그대로다.
    - **`workflow.list`**(읽기 tool, 모든 role): 입력 `{}`, 결과 `WorkflowListing`.
    - **prompt 절**(`prompt-assembly/model.ts`): `PlaceWorkflows = { hash: string; text: string }`.
      - 자리는 place 층(system block 4)의 "Workflows" 절이다. "Agents you can call"과 섞지 않는다.
      - workflow 열쇠순으로 workflow마다 한 덩어리: 열쇠와 "you are <참가자>"(entry면 이 agent가 시작한다는 줄), 참가자 목록(이름 = role 이름 (place), 자기는 you), 자기 연락처(선언 순서. 받는 참가자, when, call에 쓸 `to`, reply, session), body 전문.
      - 참가자인 workflow가 없으면 절이 없다(null). hash는 절 글의 sha256이다. 바뀌면 다음 turn에 notice `workflows_changed`가 붙는다.
    - **봉투**:
      - SendCall 입력(`callSendInputSchema`)에 `workflow?: string`(열쇠), `participant?: string`. 둘 다 있거나 둘 다 없다. schema refine으로 묶지 않고(call tool이 `omit`한다) core가 `invalid_input`으로 막는다.
      - `receivedEnvelopeSchema`에 같은 둘(optional). workflow 밖 call, reply, reaction, notice에는 없다. `from`은 지금처럼 session이다.
      - model에 보이는 call 입력(`call.ts`의 `callToolInput`)에서는 `workflow`와 `participant`를 뺀다. `wf-call-tool`이 `workflow`만 되살린다.
      - unattended 표시처럼 `CallEnvelope`와 `agent_calls` 행에는 싣지 않는다.
    - **receiver tag**: `INPUT_TAG_ATTRIBUTES.call`(지금 `["from", "call", "reply"]`) 끝에 `workflow`, `participant`를 이 순서로 덧붙인다. 예: `<lophn-call from="agent:ses_…" call="cal_…" reply="result" workflow="eval/eval" participant="runner">`. 두 속성은 봉투에 있을 때만 쓴다. 받은 call의 tag는 `run-loop/input-text.ts`의 `callText`가 그리고, 그 함수는 이 목록을 읽지 않고 key 순서로 속성 순서를 지킨다(`wf-envelope-carry`가 맞춘다).
    - **notice 종류**: `NOTICE_KINDS`에 `workflows_changed`.

## 할 일

1. `packages/protocol/domains/paths.ts`
   - `DOMAIN_WORKFLOWS_FOLDER = "workflows"`와 `domainWorkflowsFolder(dataRoot: string, domain: string): string`(`${domainFolder(dataRoot, domain)}/${DOMAIN_WORKFLOWS_FOLDER}`)를 `domainSkillsFolder` 옆에 더한다.
   - 맨 위 주석의 "kind 파일, DOMAIN.md, skill, artifact가 든다"에 workflow 선언을 더한다. 이 file은 shell main이 import하므로 import를 더하지 않는다.
2. `packages/protocol/lophn-agent/workflow-file.ts`(새 file). `zod`, `./places.ts`(`Role`), `./calls.ts`(type `NamedAgent`)만 import한다. `calls.ts`가 이 file의 schema를 import하므로 `calls.ts`에서는 `import type`으로만 받는다(값 import는 순환이다). 순수 값과 순수 함수만 둔다.
   - `workflowNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)` — workflow 이름과 참가자 이름이 같이 쓴다.
   - `workflowKeySchema` — `<domain 이름>/<workflow 이름>`. domain 이름은 `domainNameSchema`(slug) 꼴이다. regex 하나로 둔다: `/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/`.
   - `workflowKey(domain: string, name: string): string` → `${domain}/${name}`.
   - `workflowParticipantSchema`: `role`으로 가르는 `z.discriminatedUnion`, 가지는 모두 `z.strictObject`. 가지의 role은 `Role`의 넷이고 따로 role 목록을 만들지 않는다.
     - `{ role: "lophn" }`
     - `{ role: "project_manager", place?: { project: string } }`
     - `{ role: "app_engineer", place?: { app: string } }`
     - `{ role: "operator", place?: { project: string } | { app: string }, name: string }`
     - place 안의 이름과 Operator `name`은 `z.string().min(1)`이다(Router처럼 정확히 맞춰 푼다. 꼴은 보지 않는다).
   - `workflowContactSchema = z.strictObject({ to: workflowNameSchema, reply: z.enum(["none", "result"]), session: z.enum(["new", "open"]), when: z.string().regex(/^[^\r\n]+$/) })` — `when`은 비지 않은 한 줄이다.
   - `workflowFrontmatterSchema = z.strictObject({ entry: workflowNameSchema, participants: z.record(workflowNameSchema, workflowParticipantSchema), contacts: z.record(workflowNameSchema, z.array(workflowContactSchema)).optional() })`.
   - type: `WorkflowParticipant`, `WorkflowContact`, `WorkflowFrontmatter`(= `z.infer<typeof workflowFrontmatterSchema>`).
   - `WorkflowDeclaration = { key: string; domain: string; name: string; file: string; entry: string; participants: Record<string, WorkflowParticipant>; contacts: Record<string, WorkflowContact[]>; body: string }` — `domain`은 domain 이름(id가 아니다), `file`은 `workflows/<name>.md`, `contacts`는 없으면 `{}`, `body`는 frontmatter 뒤 글의 앞 빈 줄과 뒤 공백을 뺀 것이다.
   - `WorkflowError = { domain: string; file: string; reason: string }`.
   - `WorkflowListing`, `WorkflowMembership`(`address`는 `NamedAgent`), `WorkflowRead`는 계약 모양 그대로다.
   - `checkWorkflowStructure(frontmatter: WorkflowFrontmatter): string[]` — 영어 한 줄 이유를 frontmatter 순서대로 낸다. 문제가 없으면 `[]`.
     - `entry`가 `participants`에 없다: `entry <x> is not a participant`
     - `contacts`의 열쇠가 `participants`에 없다: `contacts of <x>: <x> is not a participant`
     - 연락처의 `to`가 `participants`에 없다: `contacts of <x>: to <y> is not a participant`
     - 이 밖(참가자 풀기, 같은 agent 둘)은 core reader의 몫이라 여기서 보지 않는다.
   - 주석은 "왜"만 쓴다. 이 file이 `protocol/domains`가 아니라 `protocol/lophn-agent`에 있는 까닭을 한 줄 적는다(아래 "정한 것").
3. `packages/protocol/lophn-agent/calls.ts`
   - `callSendInputSchema`에 `workflow: workflowKeySchema.optional()`과 `participant: workflowNameSchema.optional()`을 더한다(`./workflow-file.ts`에서 import). 둘을 묶는 refine은 두지 않는다. 짝이 맞는지는 core Router가 본다(`wf-envelope-carry`). 주석은 `unattended` 줄처럼 "tool이 채운다, model 입력에는 `workflow`만 연다"를 왜로 한 줄 쓴다.
   - `CallEnvelope`(`callEnvelopeSchema`)는 이 task에서 바꾸지 않는다. Router 안 봉투에 싣는 일은 `wf-envelope-carry`의 `RouteInput`·`RoutedInput`이다.
4. `packages/protocol/lophn-agent/inputs.ts`: `receivedEnvelopeSchema`에 `workflow: workflowKeySchema.optional()`, `participant: workflowNameSchema.optional()`을 더한다(`./workflow-file.ts`에서 import). 옛 칸(`.nullable()`)과 달리 optional이다(README "봉투의 새 칸은 optional"). 주석에 "workflow 안의 call에만 있다"를 한 줄 더한다.
5. `packages/protocol/lophn-agent/input-tags.ts`
   - `INPUT_TAG_ATTRIBUTES.call`을 `["from", "call", "reply", "workflow", "participant"]`로 한다.
   - `NOTICE_KINDS` 끝에 `"workflows_changed"`를 더한다.
6. `packages/protocol/projects/project-api.ts`: `projectApi.list`의 `actors`를 `[...readers, "machine"]`으로 한다. `readers`와 `projectApi.get`은 그대로 둔다. 같은 이름(`project.list`)의 `projectList`(`project-routes.ts`)는 core에 등록되지 않은 사본이라 건드리지 않는다.
7. `packages/core/lophn-agent/tools/ports.ts`: `WorkflowReader` interface를 `SkillReader` 옆에 더한다. `WorkflowRead`는 `../../../protocol/lophn-agent/workflow-file.ts`에서 type으로 import한다(harness가 import하는 harness protocol이다).
8. `packages/core/lophn-agent/tools/tool-context.ts`: `ToolContext`에 `workflows: WorkflowReader`를 `skills` 옆에 더한다. 주석: 부를 때마다 선언을 새로 읽는다(도는 turn의 prompt 절과 달리 call 직전의 지금 판을 본다).
9. `packages/core/lophn-agent/run-loop/prepare.ts`: `ToolPorts`의 `Pick`에 `"workflows"`를 더한다. `PreparerDeps.toolPorts`의 turn 인자는 바꾸지 않는다.
10. `packages/core/lophn-agent/run-loop/unwired.ts`: `UNWIRED_TOOL_PORTS.workflows = { read: () => Promise.resolve(unavailable()) }`. product-driver(`packages/core/main/agent-runtime/product-driver.ts`의 `toolPorts`)가 이 값을 펼쳐 쓰므로 `wf-decl-reader`가 꽂을 때까지 이 값이 간다.
11. `packages/core/lophn-agent/prompt-assembly/model.ts`: `PlaceWorkflows = { hash: string; text: string }`를 `PlaceKinds` 옆에 더한다. 주석: text는 place 층 "Workflows" 절 전문이고 hash는 그 글의 sha256이다. 판 번호가 없다.
12. `packages/core/lophn-agent/tools/bundles/call.ts`: `callToolInput`의 `omit`(지금 `dedup`, `unattended`, `options`)에 `workflow: true, participant: true`를 더한다. tool 설명과 handler는 바꾸지 않는다.

`tests/`: 새 칸은 모두 optional이고 `ToolContext`는 test에서 `as unknown as ToolContext`로만 만든다(2026-10-22 main에서 `grep -rn "ToolContext\|ToolPorts\|receivedEnvelopeSchema\|INPUT_TAG_ATTRIBUTES" tests` 0줄). 고칠 곳이 없다. `deno task check`가 떨어지면 그 줄을 넘길 줄로 적는다.

정한 것:
- 선언의 모양은 `protocol/domains`가 아니라 `protocol/lophn-agent/workflow-file.ts`에 둔다. 이유: `protocol/lophn-agent → apps → domains`가 이미 있어 `domains`에 두고 `lophn-agent`를 import하면 `check-deps`의 `protocol-cycle`이 떨어진다. `lophn-agent → domains`는 된다. 그래서 `Role`과 `NamedAgent`를 그대로 import하고, role literal이나 `NamedAgent`와 같은 모양의 type을 한 벌 더 쓰지 않는다. 폴더 path 상수(`DOMAIN_WORKFLOWS_FOLDER`, `domainWorkflowsFolder()`)만 `packages/protocol/domains/paths.ts`에 둔다.
- 이름 regex는 계약 그대로(`^[a-z0-9]+(-[a-z0-9]+)*$`)이고 domain 이름의 `slugSchema`(첫 글자가 영문)와 다르다. 열쇠 regex는 앞을 domain 꼴, 뒤를 workflow 꼴로 둔다.

## 끝남

- `deno task check`가 통과한다(`check-deps` 포함).
- 위험 test: 없음. 모양은 schema가 지키고, 구조 검사의 결과는 `workflow.list`로 보인다. 연락처가 참가자 밖으로 새지 않는 것은 `wf-prompt-section`의 test가 본다.
- `grep -n "import" packages/protocol/domains/paths.ts`가 0줄이다.
- `grep -rn "workflow-file" packages/protocol/domains/`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/lophn-agent/mod.ts`에 `export * from "./workflow-file.ts";`(이 task는 file path로 import한다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
