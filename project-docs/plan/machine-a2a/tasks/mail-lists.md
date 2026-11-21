# mail-lists

agent가 다른 컴퓨터에 닿는 명령 길을 연다: `call send`·`session list`·`agent card`와 새 `agent list`가 `--on <컴퓨터>`를 받고, `machine computers`가 명단의 컴퓨터를 읽는다. 받는 컴퓨터는 agent 목록·명함·열린 session 목록을 내주되 이 기계에서 private인 workspace의 것은 빼고 준다. a2a-access 정한 것 1(목록, 명함, 부르는 길)을 한 기계 안과 기계 사이에 같이 연다.

- 단위: mail (wave 1)
- 선행: mail-router
- 소유(이 task만 고친다):
  - `packages/protocol/machine/a2a.ts` (새 file)
  - `packages/protocol/machine/mod.ts`
  - `packages/protocol/lophn-agent/agent-definitions.ts`
  - `packages/protocol/remote/allowlist.ts`
  - `packages/core/lophn-agent/agents/reads.ts`
  - `packages/core/remote/{a2a-lists.ts,a2a-lists_test.ts}` (새 file)
  - `packages/core/main/daemon/wiring/a2a-lists.ts` (새 file)
  - `packages/cli/commands/{call.ts,session.ts,agent.ts,machine.ts,call_test.ts,agent_test.ts}`
  - `packages/core/lophn-agent/tools/lophn/{tool.ts,resolve.ts,lophn_test.ts}`
  - `packages/coding-agent/skills/lophn-agent.ts`
- flows(줄만 고친다): `project-docs/flows/areas/core-platform.yaml`(`a2a/sessions`, `a2a/agents`, `machines/sessions`, `machines/agents`), `project-docs/flows/areas/agents.yaml`(`agents/cards`의 actor와 home, `agent-card-read`의 `--on`), `project-docs/flows/areas/cli.yaml`(`call send`·`session list`·`agent card`의 `--on`, 새 `agent list`, `machine computers`), `project-docs/flows/tests/core-rest.yaml`, `project-docs/flows/tests/lophn-agent.yaml`
- 읽을 것:
  - 계획 README "정한 것"(목록과 명함, 주소), roadmap `a2a-multi-device.md` "주소"와 정한 것 2·3, `a2a-access.md` 정한 것 1·2
  - `project-docs/plan/machine-a2a/tasks/mail-router.md` "계약"(`callSendRemote`, `remoteWorkspaceSchema`, `remoteReach`, `remoteWorkspaceOf`)
  - architecture: `project-docs/architecture/remote.md` "`--on`", "넘기는 call의 요청한 쪽"; `project-docs/architecture/agent-call.md` "부를 수 있는 session 목록", 명함(11)
  - 본보기: `packages/core/remote/machine-routes.ts`의 `createMachineAppTools`(agent 대신 다른 컴퓨터를 읽는 길, 5초 기한), `packages/core/main/daemon/wiring/app-calls.ts`의 `app_agents/list`(reader `agentCards`를 machine 자격으로 읽는다), `packages/core/router/reads.ts`의 `sendableRead`
- 계약:
  - 쓰는 것: `callSendRemote`(`packages/protocol/lophn-agent/mail.ts`), `remoteWorkspaceSchema`, `remoteReach`·`remoteWorkspaceOf`(`packages/core/router/mod.ts`), `ctx.machineLinks`, `ctx.deviceKind`, `agentCallSendable`, `agentCard`
  - 내놓는 것(`packages/protocol/machine/a2a.ts`):
    - `remoteWorkspaceOutputSchema = z.discriminatedUnion("kind", [{kind: "home"}, {kind: "project", identity: idSchema("pri").nullable(), name: z.string()}, {kind: "app", app: idSchema("app"), name: z.string()}])`. identity가 null인 project는 다른 컴퓨터에서 부를 수 없다.
    - `remoteSessionSchema = {session, handle, name, title: string|null, workspace: remoteWorkspaceOutputSchema, state: z.enum(SENDABLE_SESSION_STATES), last_active_at: string|null}`
    - 받는 쪽(기기 자격, actor user, memory): `a2aSessions` `a2a/sessions` input `{}` output `{sessions: remoteSessionSchema[]}`; `a2aAgents` `a2a/agents` input `{workspace: remoteWorkspaceSchema}` output `{found: boolean, cards: agentCardSchema[]}`. 둘 다 `not_found`를 내지 않는다(보내는 쪽이 `not_found`를 "그 route를 모르는 옛 판"으로 읽는다). 없는 workspace와 private workspace는 똑같이 `{found: false, cards: []}`다.
    - 보내는 쪽(actor agent, memory): `machinesSessions` `machines/sessions` input `{machine: string}` output `{machine: {machine: mch, name}, sessions}`; `machinesAgents` `machines/agents` input `{machine: string, workspace?: workspaceNameSchema}` output `{machine: {machine, name}, workspace: remoteWorkspaceSchema, found, cards}`.
    - `A2A_LIST_ROUTES` 넷(lead가 `packages/protocol/registry.ts`에 등록한다).

## 할 일

1. protocol: 위 `a2a.ts`. `REMOTE_ALLOWED_ROUTES`와 `REMOTE_AGENT_ROUTES`에 `a2aSessions`, `a2aAgents`. `machineComputers`의 actors에 `agent`. `agentCards`의 input을 `{workspace: workspaceSchema.nullable()}`(null은 home)로, actors에 `agent`.
2. `agents/reads.ts` `cards`: agent 자격이 다른 workspace를 물으면 그 workspace가 이 기계의 call 정책에서 private일 때 `forbidden`이다(자기 workspace는 된다). home(null)은 `cardsIn`이 이미 받는다.
3. 받는 쪽 handler(`remote/a2a-lists.ts`, `wiring/a2a-lists.ts`가 memory로 낸다): principal이 `device:`이고 `ctx.deviceKind`가 `computer`가 아니면 `forbidden`.
   - `a2a/sessions`: main thread 연결로 열린 session을 읽고(`createSessionDirectory(workspaceDepsOf(sql)).listOpen()`과 `sessionStateOf`, `router-registration.ts`의 `describe`와 같은 규칙) 받지 않는 session과 private workspace의 session을 뺀다. workspace는 기계를 건너는 꼴로 바꾼다(project는 `identity`와 이름, 앱은 id와 이름).
   - `a2a/agents`: `{project: pri_}`는 `projectByIdentity`로 푼다. 없거나 private이면 `{found: false, cards: []}`. 아니면 reader `agentCards`를 이 wiring의 machine 자격(`machine:a2a-lists`, operations `agentCards`)으로 읽어 `{found: true, cards}`(명함의 `callable`은 싣지 않는다).
4. 보내는 쪽 handler: `ctx.conditions.session`과 `remoteReach`(private·받은 mail로 열린 session이면 `forbidden`). 기계는 `ctx.machineLinks.resolve`(이 컴퓨터면 `invalid_input`). `machines/agents`의 workspace는 없으면 부른 session의 workspace이고 `remoteWorkspaceOf`로 바꾼다. 그 기계에 `machineLinks.call(device, {resource: "a2a", method}, by)`, `by = {kind: "agent", agent, session, name: requesterName(...)}`. 5초 안에 답이 없으면 `unavailable`("<컴퓨터> is not reachable now"). 상대가 `not_found`면 `unavailable`("<컴퓨터> runs an older lophn; update lophn there"). 답은 output schema로 다시 검사하고 글은 `createMachineAppTools`의 `checkedView`처럼 길이를 줄인다(다른 컴퓨터의 글이다).
5. CLI(`packages/cli/commands/`): 네 명령의 input에 `on: z.string().min(1).optional()`(`--on <computer>`: 명단의 다른 컴퓨터, 이름·`mch_`·`dev_`).
   - `call.send`: `on`이 있으면 `callSendRemote`에 `{to: {...to, machine: on}, reply, body, dedup: ctx.key}`. `--image`나 `refs`와 같이 오면 `invalid_input`("only text goes to another computer"). routes에 `callSendRemote`를 더한다.
   - `session.list`: `on`이면 `machinesSessions`.
   - `agent.card`: `on`이면 `machinesAgents`(선택 `--workspace`)를 읽어 그 handle의 명함, 없으면 `not_found`.
   - 새 `agent.list`("List the agents you can call: handle, name, description, runtime, modality, replies"): 선택 `--workspace`, `--on`. `on`이 없으면 `agentCards`(workspace가 없으면 자기 workspace), 있으면 `machinesAgents`. `workspaces: WORKSPACE_KINDS`, `effect: "read"`.
   - 새 `machine.computers`("List the person's computers you can reach with --on"): `machineComputers`, `workspaces: WORKSPACE_KINDS`.
   - 사람의 binary는 `--on`을 parse 전에 떼어 `machines/call`로 보내므로 이 칸은 lophn tool에서만 닿는다. binary의 길은 바꾸지 않는다.
6. lophn tool: `resolveLophnCall`이 위 명령의 `--on`을 칸으로 읽는지 확인한다(`resolveAppCall`은 내장 명령의 첫 낱말이면 손대지 않는다). 내장 명령에 `--on`이 붙어 풀리지 못했을 때의 글을 "--on goes with an app command, or with call send, session list, agent list or agent card"로 바꾼다.
7. skill `lophn-agent.ts`: "Other computers" 절 하나. `machine computers`로 컴퓨터를 읽고, `agent list --on <computer> [--workspace]`·`agent card <handle> --on <computer>`·`session list --on <computer>`로 고르고, `call send --on <computer>`로 보낸다. workspace는 project 이름이나 `pri_`(그 project가 다른 컴퓨터에도 있을 때), 앱 slug, home이다. 본문은 글뿐이고 file·이미지·변경은 가지 않는다(git으로 옮기는 방법은 지침의 일). 꺼진 컴퓨터로 보낸 call은 그 컴퓨터가 켜질 때 가고, 받은 session에서는 또 다른 컴퓨터로 보내지 못한다. 어느 컴퓨터·agent를 고를지는 지침과 사람이 정한다(program은 고르지 않는다). system prompt는 바꾸지 않는다(prompt cache, `multi-machine.md` §6).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "다른 컴퓨터가 읽는 session 목록과 agent 명함에 이 기계에서 private인 workspace의 것이 없고, 폰과 명단 밖 기기는 읽지 못한다"(`a2a-lists_test.ts`, handler와 SQLite 하나)
  - "lophn tool의 `call send --on <컴퓨터>`는 calls/send_remote로 가고 `--on` 없는 `call send`는 calls/send로 간다"(`lophn_test.ts`, tool 입력에서 명령 실행까지. 가짜 core는 route마다 다른 call id를 답하고 판정은 tool 결과로 한다)
- 남지 않음: `grep -rn "\-\-on goes with an app command: lophn <app> <command> \-\-on <computer>\"" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `A2A_LIST_ROUTES`(→ `packages/protocol/registry.ts`), `a2aListsWiring`(→ `WIRINGS`, `remoteWiring` 앞)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
