# runs-core

run을 새 주소와 정체로 바꾼다: `StartRun`의 agent는 `AgentAddress`, 기록의 agent 대상은 `AgentAtPlace`, `runs.agent_key`는 (agent id, place) 짝, run 출처의 creator는 (agent, place). `packages/protocol/runs/runs.ts`는 `contract-session`이 고정한 목표 꼴로 이 task가 제자리에서 바꾸고, type이 깨지는 CLI·flow host·job 배선을 최소로 맞춘다.

- 단위: runs (wave 2)
- 선행: router-core, place-tools. 이름을 `resolveAddress`로 푼다.
- 소유(이 task만 고친다):
  - `packages/core/runs`
  - `packages/core/main/daemon/wiring/runs.ts`
  - `packages/protocol/runs/runs.ts`
  - `packages/coding-agent/cli/commands/run.ts` (넘길 줄: `--agent`를 `AgentAddress`로 넘긴다)
  - `packages/core/main/flow-host/host.ts` (넘길 줄: instance 출처의 creator)
  - `packages/core/main/daemon/wiring/jobs.ts` (넘길 줄: job 출처의 creator)
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" › "주소와 넘기기"(job을 만든 쪽과 `runs.agent_key`는 (agent, place), flow의 앱 tool 호출, CLI `lophn run`), "저장과 test"(schema `runs.agent_key`, 위험 test 셋), "뼈대 검토"(run 꼴은 이 task가 제자리에서 바꾼다, wave 2와 3을 함께 올린다)
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-session.md`의 "제자리에서 바꿀 꼴의 목표" › run, `tasks/contract-agent.md`(`AgentId`, `AgentAtPlace`, `AgentAddress`, `LOPHN_AGENT_ID`), `tasks/router-core.md`(`resolveAddress`, `addressOfNamed`), `tasks/sessions-core.md`(`placeSessionOpen`·`placeSessionRead`, 옛 `AgentRef`로 넘기는 줄), `tasks/place-tools.md`(`CallAuth`의 agent 꼴을 바꿀 수 있다)
  - architecture: `project-docs/architecture/run.md` 전부(특히 "시작": 이름을 다 푼 뒤에 session을 연다, `origin`과 `agent_resolved`; "읽기": `ListRuns` 거르기와 place; "CLI와 자격"; "왜": origin이 route 입력에 없는 이유), `app-call.md`("지키는 것"의 program·flow caller 자격), `job.md`("할 일마다 시작과 끝"의 agent_run), `workflow.md`("flow"의 agent·tool은 run 하나)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `runs`, `coding-agent-cli`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/core/runs`(lophn-agent와 feature module을 import하지 않고 port만 쓴다), `packages/core/main`(flow-host는 module이 아니라 main 안이다)
  - test 규칙: `.claude/skills/write-test/SKILL.md`
  - 계약 code: `packages/protocol/lophn-agent/places.ts`(`agentIdSchema`, `agentAtPlaceSchema`, `agentAtPlaceOutputSchema`, `agentAddressSchema`, `LOPHN_AGENT_ID`, `Place`), `packages/protocol/lophn-agent/agent-sessions.ts`(`placeSessionOpen`, `placeSessionRead`)
  - 고칠 code:
    - protocol: `packages/protocol/runs/runs.ts`(`runRecordSchema`, `startRunInputSchema`, `runList`, `createTargetSchema`, `placeFits`, `runCreate`)
    - runs: `packages/core/runs/ports.ts`(`ResolvedAgent`, `JobOrigin`, `InstanceOrigin`, `RunAgents`), `service.ts`(`ResolvedAgentStart`, `startAgent` 161줄, `startTool`), `store.ts`(`agentKeyOf`, `placeKeyOf`, `insertRun`, `listRuns`), `schema.ts`, `reads.ts`, `mod.ts`, `service_test.ts`, `store_test.ts`
    - 배선: `packages/core/main/daemon/wiring/runs.ts`(`agents.resolve`·`agentOf`·`open`, `tools.call`, `runPlaceOf`)
    - 넘길 줄: `packages/core/main/flow-host/host.ts`(`handle`의 `origin` 177-182줄, `runOutcome`의 `agent: request.agent` 145줄), `packages/core/main/daemon/wiring/jobs.ts`(`origin` 138-143줄, `agent_resolved` 147-152줄, `runPlaceOf`), `packages/coding-agent/cli/commands/run.ts`(`resolveAgent` 33줄, `AGENT_FORMS`)
  - 부르는 곳(이 task 소유가 아니다): `packages/core/apps/calls/caller.ts`(`CallAuth`의 `program`·`flow`), `packages/core/apps/calls/calls_test.ts`("job과 workflow instance가 부르는 앱 tool은 …" test), `packages/protocol/workflows/flow-wire.ts`(flow의 agent 요청은 아직 옛 `NamedAgent`다)
- 계약:
  - 쓰는 것: `contract-session`이 적은 run 목표 꼴. `contract-agent`의 `AgentAddress`, `AgentAtPlace`, `AgentId`. `router-core`의 `resolveAddress`. `sessions-core`의 `placeSessionOpen`.
  - 내놓는 것:
    - `runs.ts` 꼴: 기록의 `target` = `{ agent: AgentAtPlace } | { app, tool }`, `StartRun` input의 `agent?: AgentAddress`(`session`과 정확히 하나), `ListRuns` input의 `agent?: AgentId`, `CreateRun`의 target `{ agent: AgentAtPlace }`. 열 `runs.agent_key` = `<agent id>`(home) 또는 `<agent id>@<place id>`. schema step을 고치고 개발 data는 지운다.
    - core 안 run 출처(`JobOrigin`, `InstanceOrigin`, `packages/core/runs/ports.ts`)의 creator는 `AgentAtPlace`다. flow host는 이 task 동안 그 project의 lophn(`{ agent: "lophn", place: project }`)을 넣고 `workflows-core`가 `workflow.yaml`의 `agent`로 바꾼다.
    - CLI `run`은 이 task 동안 옛 `--agent` 글을 `AgentAddress`로 옮겨 넘긴다(`pm:<p>` → lophn @ project, `ae:<a>` → lophn @ app, `operator:<x>/<이름>` → 그 이름 @ place). `cli-run`(wave 3)이 새 꼴로 다시 쓴다.

## 할 일

1. `packages/protocol/runs/runs.ts`를 목표 꼴로 바꾼다(contract-session "run").
   - import: `agentRefOutputSchema`, `agentRefSchema`, `namedAgentSchema`를 빼고 `agentAtPlaceSchema`, `agentAtPlaceOutputSchema`, `agentAddressSchema`, `agentIdSchema`를 `../lophn-agent/places.ts`에서 받는다.
   - `runRecordSchema.target`의 agent 갈래: `z.object({ agent: agentAtPlaceOutputSchema })`. 주석 "agent: 이름을 푼 (agent, place)".
   - `startRunInputSchema`의 agent 갈래: `agent: agentAddressSchema.optional()`. 주석의 "role coding_agent는 invalid_input"을 지운다.
   - `runList` 입력 `agent: agentIdSchema.optional()`. 주석: `agent`는 그 agent의 run(place와 상관없다), `place`는 만들 때 기록한 place(그 place의 agent run과 그 앱의 tool run), 준 칸은 모두 맞아야 한다.
   - `createTargetSchema`의 agent 갈래: `z.strictObject({ agent: agentAtPlaceSchema })`.
   - `runCreate` 입력에서 `place`와 `placeFits` refine을 지운다. place는 target에서 나온다(아래 "정한 것").
   - `runPlaceSchema`·`RunPlace`는 `ListRuns`의 `place` 거르기로 남는다.
2. `packages/core/runs/ports.ts`.
   - `ResolvedAgent`를 지운다. 이름을 푼 agent는 `AgentAtPlace`다.
   - `JobOrigin = { job, job_run, creator: AgentAtPlace }`, `InstanceOrigin = { instance, creator: AgentAtPlace }`. `creator_place`를 지운다(place가 `creator` 안에 있다). 주석: job의 creator는 job을 만든 (agent, place), instance의 creator는 flow의 앱 tool 호출을 맡는 (agent, project)다.
   - `RunAgents`: `resolve(address: AgentAddress): Promise<Result<AgentAtPlace>>`(못 풀면 `not_found`), `agentOf(session): Promise<Result<AgentAtPlace>>`, `open(agent: AgentAtPlace, session)`. 주석의 "hr-runs-wiring" 같은 옛 이름은 "wiring/runs.ts"로 고친다.
   - `runs/mod.ts`에서 `ResolvedAgent` export를 뺀다.
3. `packages/core/runs/service.ts`.
   - `ResolvedAgentStart = { kind: "agent_resolved"; agent: AgentAtPlace; prompt; input?; schema? }`(`place` 칸을 지운다. place는 `agent` 안이다).
   - `startAgent`: `coding_agent` 검사(169줄)를 지운다. 이름 풀기는 `agent_resolved`면 `input.agent`, `agent`면 `agents.resolve(input.agent)`, `session`이면 `agents.agentOf(session)`. `store.create`에 `target: { agent }`를 넣고 `place`를 넣지 않는다. 순서(이름을 다 푼 뒤 run 행 → session 열기 → 메시지)와 `start_failed`는 그대로다(`run.md` "시작").
   - `startTool`: `store.create`에서 `place`를 뺀다.
4. `packages/core/runs/store.ts`와 `schema.ts`(README "`runs.agent_key`도 같은 쌍으로 만든다").
   - `agentKeyOf(agent: AgentAtPlace)`: place가 null이면 `agent.agent`, 아니면 `` `${agent.agent}@${agent.place.id}` ``.
   - `insertRun`: `place` 인자를 지우고 `place_key`를 target에서 만든다. agent target은 `agent.place`(`{ kind, id }`가 있으면 `project:<id>` 또는 `app:<id>`, null이면 NULL), tool target은 `app:<app>`. `ListRuns`의 `placeKeyOf(RunPlace)`와 같은 글이 나와야 한다.
   - `listRuns`의 `agent?: AgentId`: `(agent_key = ? OR agent_key GLOB ?)`에 `[agent, `${agent}@*`]`. `LIKE`는 쓰지 않는다(`_`가 아무 글자와 맞는데 id에 `_`가 있다).
   - `schema.ts`: SQL은 그대로다. 머리 주석에 `agent_key`가 `<agent id>`(home) 또는 `<agent id>@<place id>`임을 적는다. 개발 data는 지운다(README "schema").
   - `reads.ts`는 type만 따라간다.
5. `packages/core/main/daemon/wiring/runs.ts`.
   - `agents.resolve(address)`: `ledgerSnapshot` 안에서 `createSessionDirectory({ ...placeDepsOf(lookup.sql), publish: () => {}, sql: () => lookup.sql }).resolveAddress(address)`(router-core)를 돌려준다. Operator place를 따로 찾던 줄(`deps.operators.operator(...)`), `placeOfAgentRef`, `runPlaceOf`를 지운다.
   - `agents.agentOf(session)`: `placeSessionRead`로 읽고 open이 아니면 `conflict`, 맞으면 `{ agent: s.agent, place: s.place }`.
   - `agents.open(agent, session)`: `placeSessionOpen`에 `{ id: session, agent: agent.agent, place: agent.place }`. `sessions-core`가 남긴 옛 `AgentRef` 넘김 줄이 있으면 지운다.
   - `tools.call`: `CallAuth`의 `program`·`flow`에 `origin.creator`를 넣는다. `packages/core/apps/calls/caller.ts`는 `place-tools` 소유다.
     - 그 file이 이미 `agent: AgentId`(또는 `AgentAtPlace`)를 받으면 `agent: origin.creator.agent, place: origin.creator.place`로 넣는다.
     - 아직 옛 `AgentRef`를 받으면 `LOPHN_AGENT_ID` → `{ role: "lophn" }`, `agt_…` → `{ role: "operator", agent }`로 옮겨 넣고(`sessions-core`와 같은 옛 꼴 넘김) 보고의 "넘길 줄"에 적는다. `place-tools`가 `CallAuth`를 바꿀 때 그 줄을 지운다.
   - `RUNS_CONTEXT`의 operation 목록은 `sessions-core`가 옮긴 그대로 둔다.
6. 넘길 줄 셋. 다음 task가 다시 쓸 자리라 최소로 맞춘다.
   - `packages/core/main/flow-host/host.ts`:
     - `handle`의 `origin`: `{ instance, creator: { agent: LOPHN_AGENT_ID, place: { kind: "project", id: project } } }`. `workflows-core`가 `workflow.yaml`의 `agent`로 바꾼다.
     - `runOutcome`: flow의 agent 요청은 아직 옛 `NamedAgent`다. `addressOfNamed(request.agent)`(`packages/core/router/model.ts`, router-core)로 옮기고 실패면 `failure(error.code, error.message)`를 돌려준다. `workflows-core`가 flow wire를 바꾸며 지운다.
   - `packages/core/main/daemon/wiring/jobs.ts`: 저장된 job은 아직 옛 꼴(`creator: AgentRef`, `agent_run.agent: AgentRef`, `agent_place`)이다.
     - `origin`: `{ job, job_run, creator: { agent: <옛 ref의 id>, place: placeOfAgentRef(job.creator) ?? null } }`.
     - `agent_resolved`: `agent: { agent: <옛 ref의 id>, place: action.agent_place }`.
     - `<옛 ref의 id>`는 이 file 안 한 줄 함수다: `role`이 `operator`면 `ref.agent`, 아니면 `LOPHN_AGENT_ID`(lophn과 옛 PM·AE는 그 place의 lophn이다). `agentIdOfRef`(agents-core)는 쓰지 않는다. `place-tools`가 지운다.
     - `runPlaceOf`가 쓰이지 않으면 지운다. `jobs-core`가 이 줄들을 새 job 꼴로 다시 쓴다.
   - `packages/coding-agent/cli/commands/run.ts`: `resolveAgent(text)`를 `AgentAddress[]`를 내는 함수로 바꾼다(contract "CLI `run`은 이 task 동안 옛 `--agent` 글을 `AgentAddress`로 옮겨 넘긴다").
     - `lophn` → `[{ agent: "lophn" }]`
     - `pm:<p>` → `[{ agent: "lophn", place: { project: p } }]`, `ae:<a>` → `[{ agent: "lophn", place: { app: a } }]`
     - `operator:<이름>` → `[{ agent: 이름 }]`
     - `operator:<x>/<이름>` → `[{ agent: 이름, place: { project: x } }, { agent: 이름, place: { app: x } }]`(project 먼저. `not_found`면 둘째를 부르는 지금 `start`를 그대로 쓴다)
     - `{`로 시작하면 JSON을 `AgentAddress`로 읽는다(검사는 core가 한다). `AGENT_FORMS`의 "NamedAgent JSON"을 "AgentAddress JSON"으로. import에서 `NamedAgent`를 뺀다. 도움말 표(`packages/protocol/coding-agent/cli-commands.ts`)와 새 꼴 입력은 wave 3 `cli-run`이 고친다.
7. test(`write-test` skill. 주제가 남는 test는 꼴만 고친다).
   - `service_test.ts`: 대역 `RunAgents`의 `agentOf`·`resolve`가 `ok({ agent: "lophn", place: null })`를 돌려주고, `open`은 `AgentAtPlace`를 받는다. 대역 store의 `create` 입력에 `place`가 없다. test 이름과 판정은 그대로다.
   - `store_test.ts`: target `{ agent: { agent: "lophn", place: null } }`, `insertRun`에 `place`가 없다.

## 정한 것

- `CreateRun` 입력의 `place`를 지우고 `place_key`를 target에서 만든다. 이유: `run.md`가 그 칸을 둔 까닭("Operator의 place는 `AgentRef`에 없어서")이 `AgentAtPlace`로 없어졌다. 둘이 어긋날 수 있는 칸을 남기지 않는다(AGENTS.md "속도").
- `ListRuns`의 `agent`는 그 agent의 모든 place의 run이고, `place`와 같이 주면 그 쌍의 run이다. 이유: contract가 `agent_key`를 쌍으로, 거르기를 `AgentId`로 정했다. 쌍을 가리는 일은 이미 있는 `place` 칸이 한다.
- 이 task 동안의 옛 꼴 옮김(CLI 글, 저장된 job, flow의 옛 요청)은 옛 PM·AE를 그 place의 lophn으로 옮긴다. 이유: README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다"와 router-core의 `addressOfNamed`와 같은 규칙이다. 셋 다 `cli-run`, `jobs-core`, `workflows-core`가 지운다.

## 끝남

- `npm run check`가 통과한다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/runs/service_test.ts packages/core/runs/store_test.ts packages/core/jobs/scheduler_test.ts packages/core/apps/calls/calls_test.ts`
- 위험 test: 없음. README "저장과 test"의 위험 test 셋에 들지 않는다. job과 flow의 앱 tool 호출이 creator의 할당과 받는 domain 밖에서 막히는 경계는 `packages/core/apps/calls/calls_test.ts`의 "job과 workflow instance가 부르는 앱 tool은 만든 agent(…)의 할당이나 domain 밖이면 실행되지 않는다" test가 본다(`place-tools` 소유). 이 task는 creator를 넘기는 줄만 바꾸고 그 test가 통과하는지 돌린다. `service_test.ts`와 `store_test.ts`는 꼴만 고친다.
- 남지 않음:
  - `grep -rn "AgentRef\|agentRefSchema\|agentRefOutputSchema\|NamedAgent\|namedAgentSchema\|ResolvedAgent\|placeOfAgentRef\|placeFits\|coding_agent\|project_manager\|app_engineer\|Operator" packages/core/runs packages/protocol/runs`가 0줄이다.
  - `grep -rn "creator_place" packages/core/runs packages/core/main`이 0줄이다(`jobs-core`가 만들 `jobs.creator_place` 열과는 다른 이름이다).
  - `grep -n "project_manager" packages/core/main/flow-host/host.ts`가 0줄이다.
  - `grep -n "NamedAgent\|role:" packages/coding-agent/cli/commands/run.ts`가 0줄이다.
  - `grep -n "AgentRef\|NamedAgent\|placeOfAgentRef\|runPlaceOf\|operators\.operator" packages/core/main/daemon/wiring/runs.ts`가 0줄이다(5의 `CallAuth` 옛 꼴 넘김을 둔 경우 그 줄만 남고 보고에 적는다).
- 이 task 뒤에도 남는 것(보고의 "알려진 미완 동작"에 옮긴다): 화면의 run 줄(`packages/shell/renderer/workspace/sidebar/run-list.tsx`, `core-source.ts`)이 `target.agent.role`과 `ListRuns`의 `agent: { role: "lophn" }`을 쓴다(`shell-workspace`). CLI 도움말(`packages/protocol/coding-agent/cli-commands.ts`)이 옛 `--agent` 꼴을 말한다(`cli-run`).

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
