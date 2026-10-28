# workflows-core

workflow 참가자를 `{ agent, place? }`·`{ kind: "human" }`·`{ kind: "harness" }`로, handoff 받는 곳과 flow의 agent 요청을 `AgentAddress`로 바꾼다. flow의 앱 tool 호출은 `workflow.yaml`의 `agent` 칸(없으면 lophn)이 가리키는 agent의 할당과 그 agent가 그 project에서 받는 domain으로 거른다. `packages/protocol/workflows/*`와 SDK 사본(`packages/sdk/flow/wire.ts`)은 `contract-session`이 고정한 목표 꼴로 이 task가 제자리에서 바꾼다. Router의 옛 입력 갈래를 지운다.

- 단위: workflows (wave 2)
- 선행: runs-core. flow의 agent 요청이 run을 연다.
- 소유(이 task만 고친다):
  - `packages/core/workflows`
  - `packages/core/main/flow-host`
  - `packages/core/main/daemon/wiring/{workflows,workflows-files,flows}.ts`
  - `packages/protocol/workflows`
  - `packages/sdk/flow`
  - `packages/core/router/{model,router}.ts` (옛 `CallToInput` 갈래를 지운다)
  - `packages/shell/main/artifact/source.ts`, `packages/shell/renderer/workflow/instance-view.tsx`, `packages/coding-agent/cli/commands/workflow.ts` (넘길 줄: workflow type)
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" › "주소와 넘기기"(workflow 참가자, flow의 앱 tool 호출), "저장과 test"(schema `workflow_instances.participants`, 위험 test 셋), "뼈대 검토"(workflow 꼴은 이 task가 제자리에서 바꾼다, flow가 place 없이 agent를 부르면 instance의 project, wave 2와 3을 함께 올린다)
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-session.md`의 "제자리에서 바꿀 꼴의 목표" › workflow, `tasks/contract-agent.md`(`AgentAddress`, `AgentAtPlace`, `placeNameSchema`, `LOPHN_AGENT_NAME`), `tasks/router-core.md`(`CallAddressInput`, `resolveAddress`, `addressOfNamed`, `RouteInput.options`), `tasks/runs-core.md`(`InstanceOrigin`, flow host에 남긴 옛 꼴 줄)
  - architecture: `project-docs/architecture/workflow.md`("지키는 것"의 정의: lophn이 읽는 칸·선언은 형식만 본다, "넘기기": 담당 풀기·`session: same`, "flow": agent·tool은 run 하나·flow의 앱 tool 호출·origin과 자격은 route 입력이 아니다), `app-call.md`("지키는 것"의 flow caller), `run.md`("시작"의 `origin`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`, `runs`, `router`, `sdk`, `coding-agent-cli`. `project-docs/module-catalog.yaml`의 `packages/core/workflows`(port만 쓴다), `packages/core/main`(flow-host는 runs와 apps를 같이 알아 main 안이다), `packages/sdk`
  - test 규칙: `.claude/skills/write-test/SKILL.md`
  - 계약 code: `packages/protocol/lophn-agent/places.ts`(`agentAddressSchema`, `placeNameSchema`, `AgentAddress`, `AgentAtPlace`), `packages/protocol/lophn-agent/agent-values.ts`(`LOPHN_AGENT_NAME`), `packages/protocol/lophn-agent/calls.ts`(`CallAddressInput`)
  - 고칠 code:
    - protocol: `packages/protocol/workflows/values.ts`(`WORKFLOW_ROLES`, `workflowRoleSchema`, `participantSchema`), `declaration.ts`(`declarationParticipantSchema`, `workflowDeclarationSchema`), `commands.ts`(`deliveryToSchema`), `flow-wire.ts`(`flowRequestSchema`의 agent 갈래), `instances.ts`(참가자를 쓰는 칸)
    - workflows: `packages/core/workflows/plan.ts`(`nameOf`, `planHandoff`의 `by.role === "human"` 80줄), `declaration.ts`(`participantsOf`), `ports.ts`(`WorkflowFlows.launch`), `service.ts`(`start`의 flow 갈래), `schema.ts`, `commands.ts`(`handOff`의 `options: null`), `commands_test.ts`, `service_test.ts`
    - flow host: `packages/core/main/flow-host/host.ts`(`FlowHostDeps`, `runOutcome`, `handle`, `launch`), `check.ts`(1줄 주석), `sdk-link_test.ts`(10줄 주석), `packages/core/main/daemon/wiring/flows.ts`
    - Router 옛 갈래: `packages/core/router/model.ts`(`RouteInput.to`·`options`, `addressingOf`, `addressOfNamed`), `router.ts`(옛 `NamedAgent` 갈래)
    - SDK: `packages/sdk/flow/wire.ts`(`NamedAgent`, `AgentRequest`), `mod.ts`, `guide.md`
    - 넘길 줄(type이 깨질 때만): `packages/shell/main/artifact/source.ts`, `packages/shell/renderer/workflow/instance-view.tsx`, `packages/coding-agent/cli/commands/workflow.ts`
  - 부르는 곳(이 task 소유가 아니다): `packages/core/apps/calls/{caller,gate}.ts`와 `calls_test.ts`(flow caller의 할당·domain 판정, `place-tools`), `packages/core/main/daemon/agent-domains.ts`(받는 domain 셈, `place-scope`), `packages/core/main/daemon/wiring/runs.ts`(`ledgerSnapshot`과 `createSessionDirectory(...).resolveAddress`로 이름을 푸는 본보기), `packages/core/main/daemon/wiring/workflows.ts`의 `flows`(launch 입력을 host에 그대로 넘긴다)
- 계약:
  - 쓰는 것: `contract-session`이 적은 workflow 목표 꼴. `contract-agent`의 `AgentAddress`, `AgentAtPlace`, `assignmentGet`. `router-core`의 `CallAddressInput`과 `resolveAddress`. `runs-core`의 `InstanceOrigin`. 할당과 받는 domain은 run 출처의 creator로 앱 tool 호출 검사(`place-tools`, `place-scope`)가 거른다. 이 task는 creator만 정하고 규칙의 사본을 만들지 않는다.
  - 내놓는 것:
    - `workflows/*` 꼴: 참가자 = `{ agent: string, place?: placeName }`(place가 없으면 instance의 project) | `{ kind: "human" }`(`with`의 참가자 session에 사람 차례) | `{ kind: "harness" }`(선언만 받고 넘기지 못한다). 선언에 `agent?: string`. handoff `delivery.to` = `AgentAddress | AgentAddress & { session, fallback: "new" }`. flow 요청 `{ type: "agent", agent: AgentAddress, ... }`(place가 없으면 instance의 project). `WORKFLOW_ROLES`가 없다.
    - 표 `workflow_instances.participants`는 새 참가자 꼴 JSON이다. schema step을 고치고 개발 data는 지운다.
    - SDK의 `NamedAgent` type은 `AgentAddress`이고 `guide.md`의 예시도 그 꼴이다.
    - flow instance 출처의 creator는 `workflow.yaml`의 `agent`(없으면 lophn) @ 그 project다.

## 할 일

README의 "`workflows/`는 그 project place의 session이 쓴다"(file 범위)와 "`workflow.check`는 project 목록에 든다"(tool 목록)는 `place-scope`·`place-tools`의 일이다. 이 task는 건드리지 않는다.

1. 참가자 꼴(README "workflow 참가자는 `{agent, place?}`, `human`(`with`), `harness`다"; contract-session "workflow").
   - `packages/protocol/workflows/values.ts`: `WORKFLOW_ROLES`, `workflowRoleSchema`, `WorkflowRole`을 지운다. `participantSchema`는 셋의 union이다.
     - `z.strictObject({ agent: z.string().min(1), place: placeNameSchema.optional() })`: agent 이름. place가 없으면 instance의 project다.
     - `z.strictObject({ kind: z.literal("human") })`: `with`의 참가자 session에 사람 차례를 적는다.
     - `z.strictObject({ kind: z.literal("harness") })`: 선언만 받고 넘기지 못한다.
     - `placeNameSchema`는 `../lophn-agent/places.ts`에서 받는다(`flow-wire.ts`가 이미 lophn-agent protocol을 import한다). 지금 줄에 박힌 `{ project } | { app }` union을 지운다.
   - `declaration.ts`: `declarationParticipantSchema`는 위 셋을 `z.looseObject`로 한 union이다(`kind` 둘을 앞에, agent 꼴을 뒤에 둔다). 모르는 칸은 지금처럼 읽지 않는다. flow 갈래에 `agent: z.string().min(1).optional()`을 더한다(flow의 앱 tool 호출이 쓸 할당과 domain의 agent 이름. 없으면 lophn. 아래 "정한 것").
   - `instances.ts`, `commands.ts`의 `participants`는 같은 `participantSchema`를 쓴다. 주석만 맞춘다.
   - `packages/core/workflows/declaration.ts`의 `participantsOf`: agent 꼴은 `{ agent, place? }`, 나머지는 `{ kind }`만 옮긴다.
   - `packages/core/workflows/schema.ts`: SQL은 그대로다. 머리 주석에 `participants`가 새 참가자 꼴 JSON임을 적는다. 개발 data는 지운다(README "schema").
2. 넘기기(README "workflow 참가자", "뼈대 검토" › "flow가 place 없이 agent를 부르면 instance의 project다"; `workflow.md` "넘기기").
   - `packages/protocol/workflows/commands.ts`의 `deliveryToSchema`: `z.union([agentAddressSchema, agentAddressSchema.extend({ session: idSchema("ses"), fallback: z.literal("new") })])`. 주석 "받는 곳. `CallAddressInput`에 대입된다".
   - `packages/core/workflows/plan.ts`:
     - `nameOf`를 `addressOf(participant, project): { address: AgentAddress } | NotHanded`로 바꾼다. agent 꼴 → `{ agent, place: place ?? { project } }`(project는 instance의 prj id. `projectByName`이 id도 받는다). `harness` → `unresolved("harness", "a harness participant is not handed a step")`. `human` → `unresolved("no_with", "a human step needs a with participant")`(사람 step의 `with`가 사람을 가리킨 경우).
     - `planHandoff`의 사람 step 판정은 `"kind" in by && by.kind === "human"`. `session: same`이면 `{ ...address, session: same, fallback: "new" }`. 나머지 순서와 이유(`unknown_step`, `unknown_participant`, `no_with`)는 그대로다.
   - `packages/core/workflows/commands.ts`의 `handOff`: Router 입력에서 `options: null`을 뺀다.
   - Router의 옛 갈래(이 task가 `packages/core/router/{model,router}.ts`를 소유한다): `RouteInput.to`는 `CallAddressInput`뿐이다. `options` 칸, `addressingOf`의 옛 `NamedAgent` 갈래, `addressOfNamed`와 그 import(`CallToInput`, `NamedAgent`)를 지운다. `router.ts`에서 그 갈래를 쓰던 줄을 지운다.
3. flow의 agent 요청(contract-session "flow 요청 `{ type: "agent", agent: AgentAddress, ... }`").
   - `packages/protocol/workflows/flow-wire.ts`: `agent: agentAddressSchema`. 주석에 "place가 없으면 instance의 project"를 적는다. `namedAgentSchema` import를 뺀다.
   - `packages/core/main/flow-host/host.ts`의 `runOutcome`: `runs-core`가 넣은 `addressOfNamed` 줄을 지우고 `agent: { ...request.agent, place: request.agent.place ?? { project } }`로 run을 연다. `project`는 그 instance의 prj id다(`handle`이 이미 안다).
4. flow의 앱 tool 호출 할당(README "flow의 앱 tool 호출: `workflow.yaml`의 `agent` 칸(없으면 lophn)이 가리키는 agent의 할당과, 그 agent가 그 project에서 받는 domain으로 거른다"). 판정은 `CallAuth.flow`의 agent와 place로 `place-tools`·`place-scope`의 규칙이 한다. 이 task는 creator만 정하고 규칙의 사본을 만들지 않는다.
   - `packages/core/workflows/ports.ts`의 `WorkflowFlows.launch` 입력에 `agent: string`(선언의 agent 이름)을 더한다.
   - `service.ts`의 `start` flow 갈래: `flows.launch({ instance, project, workflow, input, agent: parsed.declaration.agent ?? LOPHN_AGENT_NAME })`. launch가 err면 지금처럼 `programExited`(code null, 이유 글)로 instance를 닫는다(`workflow.md` "띄우지 못하면 시작은 그대로 성공이고 그 이유가 `program_exited` 줄로 남는다").
   - `host.ts`:
     - `FlowHostDeps`에 `resolveAgent(address: AgentAddress): Result<AgentAtPlace>`를 더한다.
     - `launch`: process를 띄우기 전에 `deps.resolveAgent({ agent: start.agent, place: { project } })`. 실패면 `err({ code: <그 code>, message: "workflow agent <이름>: <message>" })`를 돌려준다(process를 띄우지 않는다). 성공한 `AgentAtPlace`를 `handle(instance, project, creator, entry)`에 넘긴다.
     - `handle`의 `origin`: `{ instance, creator }`. `runs-core`가 박은 lophn 줄을 지운다.
     - 48줄 주석 "PM이 쓰는 workflow 폴더 밖" → "project place의 session이 쓰는 workflow 폴더 밖".
   - `packages/core/main/daemon/wiring/flows.ts`: `resolveAgent`를 `ledgerSnapshot(ctx.ledgerPath, (lookup) => createSessionDirectory({ ...placeDepsOf(lookup.sql), publish: () => {}, sql: () => lookup.sql }).resolveAddress(address))`로 끼운다. `wiring/runs.ts`의 `agents.resolve`와 같은 호출이다. snapshot이 실패하면 그 오류를 돌려준다.
   - `check.ts` 1줄과 `sdk-link_test.ts` 10줄 주석의 "PM"을 "project place의 agent"로.
5. SDK 사본(README "`packages/sdk/flow/wire.ts`의 사본도 같이 고친다"; contract "SDK의 `NamedAgent` type은 `AgentAddress`").
   - `packages/sdk/flow/wire.ts`: `NamedAgent`를 지우고 `export type AgentAddress = { agent: string; place?: { project: string } | { app: string } }`. `AgentRequest.agent: AgentAddress`. 머리 주석의 원본 자리는 그대로다.
   - `mod.ts`: `NamedAgent` 대신 `AgentAddress`를 import·export한다.
   - `guide.md`:
     - `agent(...)` 줄: "`agent`는 `{ agent, place? }`다(`agent`는 agent 이름, `place`는 `{ project }`나 `{ app }`의 이름이나 id. 없으면 이 workflow의 project)."
     - `tool(...)` 줄: "`workflow.yaml`의 `agent`(없으면 lophn)의 지금 할당과 그 agent가 이 project에서 받는 domain 안에서만 된다."
     - 예제: `agent: { agent: "lophn", place: { app: "notes" } }`.
     - 판은 1.0.0 그대로다(아래 "정한 것").
6. 넘길 줄: `packages/shell/main/artifact/source.ts`, `packages/shell/renderer/workflow/instance-view.tsx`, `packages/coding-agent/cli/commands/workflow.ts`는 type이 깨질 때만 그 줄을 맞춘다. 셋은 지금 `paths.ts`·`HandResult`·`FLOW_STEP_BY`와 renderer 자기 view type만 써서 깨지지 않을 것이다. 참가자 이름 글(`participantName`의 `participant.role`)은 wave 3 `shell-desktop`이 고친다.
7. test(`write-test` skill. 주제가 남는 test는 꼴만 고친다).
   - `commands_test.ts`: 참가자 `{ pm: { agent: "lophn" } }`, plan의 `delivery.to`는 `{ agent: "lophn", place: { project: PRJ } }`, 대역 directory는 `resolveAddress`를 준다(router-core 뒤 꼴). test 이름과 판정은 그대로다.
   - `service_test.ts`: 참가자 `{ agent: "lophn" }`, 대역 `flows.launch`는 `agent`를 받는다. test 이름과 판정은 그대로다.

## 정한 것

- `agent` 칸은 `kind: flow` 선언에만 둔다. 이유: 선언의 할당을 빌려 앱 tool을 부르는 것은 flow code뿐이고, agent workflow의 step은 받은 agent가 자기 할당으로 일한다(`workflow.md` "step 입력").
- flow의 creator는 launch 때 한 번 푼다. 못 풀면 process를 띄우지 않고 그 이유가 `program_exited` 줄로 남아 instance가 `ended`다. 이유: 이름을 tool 호출마다 풀면 도는 중 이름이 바뀔 때 다른 agent의 할당으로 바뀐다. 띄우지 못한 이유를 사람이 보는 길은 이미 있다(`workflow.md` "flow").
- 참가자 `{ agent }`는 늘 주소가 되므로 plan은 참가자에서 `unresolved`를 내지 않는다. `unresolved`는 Router가 넘기지 못한 때(`FAILURE_TEXTS`)만 남는다. 이유: README가 place 기본값을 instance의 project로 정해 모자란 칸이 없다.
- flow SDK 판은 1.0.0 그대로 둔다. 이유: MVP 이전이라 호환 장치를 만들지 않고(AGENTS.md "호환성"), 내장 SDK는 같은 판의 byte가 바뀌어도 설치가 막히지 않는다(`packages/core/apps/packages/install.ts` 4줄). 개발 data는 지운다.

## 끝남

- `npm run check`가 통과한다.
- renderer가 `packages/protocol/workflows/values.ts`를 import하므로 `node packages/shell/renderer/build.ts`가 선다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/workflows/commands_test.ts packages/core/workflows/service_test.ts packages/core/main/flow-host/sdk-link_test.ts packages/core/router/router_test.ts packages/core/apps/calls/calls_test.ts`
- 위험 test: 없음. README "저장과 test"의 위험 test 셋에 들지 않는다. flow의 앱 tool 호출이 creator의 할당과 받는 domain 밖에서 막히는 권한 경계는 `packages/core/apps/calls/calls_test.ts`의 "job과 workflow instance가 부르는 앱 tool은 …" test가 본다(`place-tools` 소유). 이 task는 creator를 정하는 줄만 바꾸고 그 test가 통과하는지 돌린다. creator가 넘어가는 것을 보려면 process를 띄우는 test가 필요해 만들지 않는다(AGENTS.md "속도").
- 남지 않음:
  - `grep -rn "WORKFLOW_ROLES\|workflowRoleSchema\|WorkflowRole\|NamedAgent\|namedAgentSchema\|CallToInput\|addressOfNamed\|project_manager\|app_engineer\|coding_agent" packages/core/workflows packages/core/main/flow-host packages/protocol/workflows packages/sdk/flow packages/core/router/model.ts packages/core/router/router.ts packages/core/main/daemon/wiring/workflows.ts packages/core/main/daemon/wiring/workflows-files.ts packages/core/main/daemon/wiring/flows.ts`가 0줄이다.
  - `grep -rn "\bPM\b\|role" packages/core/main/flow-host packages/core/workflows packages/protocol/workflows packages/sdk/flow`가 0줄이다.
  - `grep -n "options" packages/core/router/model.ts packages/core/workflows/commands.ts`가 0줄이다.
- 이 task 뒤에도 남는 것(보고의 "알려진 미완 동작"에 옮긴다): 내장 skill `guide-workflows`(`packages/core/agent-places/skills/guide-workflows/SKILL.md`, `place-prompts` 소유)가 참가자를 `{ role, place?, name? }`로, flow의 앱 tool 호출을 PM의 할당으로 말한다. workflow 화면의 참가자 이름(`packages/shell/renderer/workflow/instance-view.tsx`의 `participantName`)이 새 참가자를 이름 없이 보인다(`shell-desktop`).

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
