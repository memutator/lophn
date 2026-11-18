# use-send

부르는 기계를 짓는다: 사람이 다른 기계의 앱을 agent에 할당한 것을 저장하고 판정에 쓰고, agent의 `lophn` tool과 앱(broker)의 호출이 `--on`·`on`으로 다른 기계의 앱 command에 닿게 하고, 요청한 쪽을 자격에서 정해 link의 frame에 싣고, private과 닿지 않을 때를 다룬다.

- 단위: use (wave 2)
- 선행: use-contract. 계약의 이름으로 짓는다.
- 소유(이 task만 고친다):
  - `packages/core/remote/links.ts`, `packages/core/remote/machine-routes.ts`(`multi-device-fixes`가 만든 file), `packages/core/remote/call_test.ts`(`multi-device-fixes`의 `machines/call` test(441줄)만 바꾼다. `use-receive`가 `createRemoteCall` 준비의 `kind` 한 줄을 넘길 줄로 맞춘다), `packages/remote-client/connection.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/apps/calls/forward.ts`(`use-contract`가 type만 둔 새 file), `packages/core/apps/calls/forward_test.ts`(새 file)
  - `packages/core/apps/permissions/broker/apps-call.ts`, `packages/core/apps/preview/adapters/apps.ts`
  - `packages/core/approvals/gate/judge.ts`, `packages/core/approvals/gate/judge_test.ts`
  - `packages/core/main/daemon/wiring/assignment-file.ts`, `packages/core/apps/usage/users.ts`
  - `packages/core/lophn-agent/agents/{commands,commands_test,directory,store,definition-file}.ts`
  - `packages/core/lophn-agent/tools/{app-toolkit,app-public}.ts`, `packages/core/lophn-agent/tools/app-tool/command.ts`, `packages/core/lophn-agent/tools/lophn/{tool,resolve,command-tool}.ts`
  - `packages/core/lophn-agent/run-loop/{prepare,runtime-access}.ts`, `packages/core/main/agent-runtime/product-driver.ts`
  - `project-docs/flows/areas/{core-platform,agent-tools}.yaml`, `project-docs/flows/tests/lophn-agent.yaml`
- 읽을 것:
  - `project-docs/plan/remote-use/tasks/use-contract.md`의 "내놓는 것"과 표
  - 계획 README "정한 것"의 "허락은 부르는 기계에서 본다", "private은 기계 사이에도 선다", "기계는 인자 하나로 고른다", "다른 기계의 앱이 무엇을 할 수 있는지는 그 기계에 묻는다"
  - architecture: `approval.md`("할당", 지키는 것 2·7·8·20·21, `use-contract` 초안), `app-call.md`(지키는 것 "호출 경로" 2·5·9, "공개 범위와 사용 관계" 1), `agent-call.md`(call 정책), `agent-definition.md`(할당 칸)
  - 조사 `reports/multi-device/survey-n3-remote-use.md` 1.2(7~13), 1.3, 1.4, 1.7
  - boundary·module: `agent-tool-spi`, `remote-client`, `child-supervision-protocol`; module `remote`, `apps`, `approvals`, `lophn-agent`
- 계약:
  - 쓰는 것: `Requester`, `resolveMachine`·`MachineCandidate`, call frame `by`, `machinesCall`, `machinesAppTools`, `appRemoteCall`, target `remote`, `RemoteForward`, `brokerAppCallInputSchema.machine`, `assignmentEntrySchema`의 `machine`·`name`, 정의 칸 `remote_apps`, `isPrivate`, `splitOn`, `ctx.machineLinks`, `multi-device-fixes`의 `createMachineRoutes`와 `machinesCall.input.shell_capability`(계약이 optional로 바꿨다)
  - 내놓는 것: `ctx.machineLinks`(remote wiring이 낸다), `createRemoteForward`(apps wiring이 forward 자리에 꽂는다), `machines/call`의 요청한 쪽(`screen`·`terminal`), `machines/app_tools`

## 할 일

1. 보내는 길: `connection.ts`의 `call(input: CoreCall)`(59줄의 type, 지금 `{resource, method, body}`)이 `by`를 받아 frame에 싣는다. `links.ts`의 `call(input)`(지금 `{machine, resource, method, body}`. 기계는 `computer(machine)`이 명단에서 `mch_`로 찾는다)의 입력에 optional `by`를 더한다(optional이라 이 함수를 부르는 `host_test.ts`의 `links.call({...})`가 그대로 컴파일된다). 보내지 못했으면(link 없음 `not connected`, refused) `unavailable`에 `details.sent: false`, 보낸 뒤 답을 잃었으면 `details.sent: true`를 단다. 이 컴퓨터를 고른 call은 `resolve`가 `self`로 먼저 거른다: `links.ts`의 `notFound`가 내는 "this machine is this computer; call its routes directly, not through machines/call"은 `watch`만 쓰게 되므로 문구에서 `machines/call`을 뺀다(이 task의 "남지 않음" grep). `wiring/remote.ts`가 `ctx.provide("machineLinks", …)`를 낸다: `computers()`는 명단의 컴퓨터(이 컴퓨터 포함, `self`), `resolve`는 `resolveMachine`, `call`은 links.
2. `machine-routes.ts`의 `createMachineRoutes`(지금 deps `{links, capability, onEnd}`)가 `call`에서 요청한 쪽을 정한다: input의 `shell_capability`가 살아 있는 capability면 `screen`, 칸이 없으면 `terminal`(사람의 CLI token), 칸이 있는데 살아 있지 않으면 지금처럼 `forbidden`이고 link에 닿지 않는다. `ctx.machineLinks.resolve(input.machine)` 뒤에 `by`를 실어 부르고 capability는 다른 기계로 보내지 않는다. 그래서 `multi-device-fixes`의 거절은 `call`에서 갈래가 된다(CLI는 `terminal`로 닿는다). `machines/call`의 `machine`은 이름·`mch_`·`dev_`이므로 `deps`에 `resolve`를 더해 `links.call` 앞에서 푼다(`watch`는 화면의 `mch_`만 받는다). `watch`는 그대로 capability가 있어야 한다. agent·앱 자격은 `machines/call`의 actor가 아니라 여기 닿지 않는다.
3. `machines/app_tools` handler(`wiring/remote.ts`의 `return ok({ memory: [...] })` 목록에 `machines/call`·`machines/watch` 옆에 더한다): 그 agent의 할당(`assignmentGet`을 machine 자격으로)에서 `machine`이 있는 줄마다 그 기계의 `apps/tools {app}`를 `by: {kind:"agent", agent, session: null, name}`으로 읽는다. 기계마다 동시에 읽고, 닿지 않거나 거절되면 `view: null`. workspace가 private이면 `apps`를 비운다. `machines`는 `computers()`다. 이 route를 `runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`에 더한다(빠지면 turn이 `configuration_unavailable`로 끝난다, orchestrate 함정).
4. `forward.ts`의 `createRemoteForward(deps)`(`RemoteForward`):
   - private: agent는 그 session의 workspace, 앱은 `{kind:"app", id}`가 이 기계의 정책에서 private이면 `forbidden`.
   - hop: 앱 caller의 부모 flight가 `remote`(계약의 `Flight.remote`)면 `forbidden`(받은 call은 다시 넘기지 않는다).
   - 기계: `resolve`. 이 컴퓨터면 `invalid_input`(`--on`을 빼라), 후보가 여럿이면 그 오류 그대로.
   - 판정: agent는 지금 할당에서 그 기계의 줄만 골라(`machine`을 뺀 꼴로) `judge({kind:"app_tool", app, tool: name, effect:"external"}, 그 줄들)`이 `deny`면 `denied(gate_blocked)`. 앱은 지금처럼 active grant의 `app.call`이 그 앱의 그 command를 덮는지(기계와 상관없다).
   - 보내기: `apps/remote_call {app, command: name, input}`, `by`는 agent면 `{kind:"agent", agent, session, name}`(이름은 agent 목록에서), 앱이면 `{kind:"app", app}`. 답은 `toolCallOutputSchema`로 읽는다. `sent: false`는 `unavailable` 오류, `sent: true`는 `{invocation: null, outcome: {status:"unknown", reason:"connection_lost"}}`.
   - apps wiring의 forward 자리에 꽂는 한 줄은 보고에 적는다(`wiring/apps.ts`는 `use-receive`의 것).
5. 판정과 할당:
   - `judge.ts`는 `machine`이 없는 줄만 본다(판정은 이 기계의 호출이다. 앱 id가 기계 사이 같아서 다른 기계에만 할당한 앱이 이 기계에서 통과하면 안 된다). 승인 subject(`gate-call.ts`)는 바꾸지 않는다.
   - 저장: 정의 파일 `remote_apps`. `directory.ts`의 `AgentInfo`, `store.ts`의 `writeAgentAssignment`, `definition-file.ts`의 칸 순서와 빈 목록 생략, `assignment-file.ts`의 `fileValuesOf`(machine이 있는 줄은 이 기계의 앱 표를 보지 않고 `remote_apps`로)와 `revisionOf`(`remote_apps`도 hash에 넣는다, approval 지키는 것 20), `users.ts`의 `agentAssignment`(`remote_apps`를 `{app, machine, name, removed_tools}`로).
   - `commands.ts`가 agent 자격의 `remote_apps`를 `apps`처럼 거절한다(approval 지키는 것 7).
6. agent의 tool:
   - `app-toolkit.ts`의 `load`가 machine 없는 줄은 지금처럼, machine 있는 줄은 `machines/app_tools`로 한 번에 읽는다. 다른 기계의 view는 `public` command만 둔다(받는 기계가 비공개를 거절한다).
   - `resolve.ts`·`tool.ts`·`prepare.ts`: `splitOn(args)`로 `--on`을 먼저 떼고, 있으면 그 기계의 view로만 푼다(`resolveMachine(on, machines)`). 내장 명령에 `--on`이 붙으면 `invalid_input`(agent는 다른 기계의 앱 command만 쓴다: README 범위 밖에 다른 기계의 터미널·file·job).
   - `command.ts`의 `appCommandTool`: 다른 기계의 줄이면 target `{mode:"remote", machine: <mch_>, app}`이고 `gate()`를 두지 않는다(run-loop gate는 묻는 자리인데 앱 tool은 묻지 않는다. 막기는 forward의 판정이 call 때 한다). `prepare.ts`의 `called` key에 기계를 더한다(같은 wire 이름이 두 기계에 있을 수 있다).
   - `lophn --help`와 앱 목록에 다른 기계의 앱을 `<slug> (on <기계 이름>)`로, `view: null`이면 "not reachable now"로 보인다.
7. 앱의 호출: `broker/apps-call.ts`가 `machine`이 있으면 target `remote`로 보낸다. preview adapter는 `machine`이 있으면 `invalid_input`(preview는 그 기계 안의 일이다).
8. flows: `core-platform.yaml`의 `core-machines-call`(요청한 쪽 `screen`·`terminal`, 이름 풀기의 `not_found`·`invalid_input`), `machines/app_tools` flow, `agent-tools.yaml`의 `tool-call-execute`·`tool-lophn-help`·`tool-list-assembly`에 `--on`과 닿지 않는 앱 갈래. `tests/lophn-agent.yaml`의 `covers`.

정한 것:
- 판정에 넣는 effect는 `external`이다: 부르기 전에는 그 기계 선언의 effect를 모르고, 지금 판정은 effect를 보지 않으며, 묻기로 바뀌면 다른 기계의 command는 묻는 쪽이 맞다.
- 할당한 다른 기계의 앱 command는 이 기계의 것처럼 묻지 않고 돈다(`judge.ts`의 `ASK_EXTERNAL_WHEN_ATTENDED = false`, README "approval은 그대로"). 승인 카드와 그 subject는 바꾸지 않는다.
- 다른 기계 앱의 public skill은 싣지 않는다: README의 대상은 command와 event다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "요청한 쪽을 속여 '사람의 화면'이라고 실어 보낼 수 있는 것은 그 기계의 shell뿐이다(agent와 CLI의 자격으로는 그 값을 싣지 못한다)." (`call_test.ts` 441줄의 `multi-device-fixes` test "CLI의 사람 token으로 machines/call을 부르지 못하고 shell main의 capability는 다른 기계로 가지 않는다"를 지우고 그 자리에 표 하나: capability 없는 사람 token은 `terminal`로 닿고, 죽은 capability는 link에 닿지 않고, 살아 있는 capability만 `screen`이다. `forward_test.ts`가 frame에 실은 `by`는 `agent`·`app`뿐이다)
  - "할당이 없는 agent는 다른 기계의 앱을 부르지 못한다." (`forward_test.ts`, link에 아무것도 가지 않는다)
  - "private인 workspace의 agent와 앱은 다른 기계를 부르지 못한다." (`forward_test.ts`, README 위험 test 넷째의 부르는 쪽 반)
  - "다른 기계에서 받은 호출 안에서 부른 앱 호출은 또 다른 기계로 넘어가지 않는다." (`forward_test.ts`, 권한이 한 hop 넓어지는 길)
  - "agent 자격은 정의의 `remote_apps`를 쓰지 못한다." (`commands_test.ts`의 기존 거절 표에 한 줄)
- 입력부터 실행기까지 한 번 잇는다: `lophn <slug> <command> --on <기계>` → `resolveAppCall` → `appCommandTool` handler → `apps/call_tool`(remote) → forward → 가짜 link가 받은 `apps/remote_call` 본문(이슈 `app-dispatch-returns-wrong-tool-name`).
- 새로 subprocess·서버·relay를 띄우는 test와 E2E는 만들지 않는다. link는 가짜로 본다.
- 남지 않음: `grep -rn "call its routes directly, not through machines/call" packages tests`가 0줄이다(이 컴퓨터를 고른 것은 `resolve`의 `self`가 정한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는: `wiring/apps.ts`의 forward 자리를 `createRemoteForward(…)`로 바꾸는 한 줄, `project-docs/flows/tests/core-apps.yaml`(`forward_test.ts`)·`core-rest.yaml`(`call_test.ts`·`judge_test.ts`의 covers) 줄, `project-docs/flows/areas/app-runtime.yaml`의 `apps/call_tool` flow에 넣을 remote target 갈래
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 둘: link 하나의 call 자리 8개와 120초 기한을 화면과 같이 쓴다(`connection.ts`의 `IN_FLIGHT`, `CALL_DEADLINE_MS`), 그보다 긴 command는 `unknown`이 된다

## 시작 전에 다시 볼 것

- 없음(이 brief를 쓴 날 code로 확인했다). 확인한 것: 터미널 탭의 `lophn`은 host가 core의 `LOPHN_*`를 지우고 `LOPHN_SESSION_ID=term:<trm_>`만 넣어 사람 token이다(`terminals/host/main.ts` 131줄). 그러므로 그 탭 안에서 부른 `--on`은 `terminal`로 실린다(그 안에서 coding agent가 쳐도 받는 기계는 구별하지 못한다. 받는 컴퓨터가 그 컴퓨터를 허락했을 때만 닿고(`use-grant`의 표) 그 허락과 기기 route 목록이 넘볼 수 있는 한계다. 보고의 "알려진 미완 동작"에 적는다). `links.watch`는 구독자 `{capability, watcher}`별이고 core 안 구독자는 `capability: null`이다(`use-events`). `RUNTIME_MACHINE_ROUTES`는 `lophn-agent/run-loop/runtime-access.ts` 67줄이다. `prepare.ts`의 `apps()`·`dispatch`(645~660줄의 `called`)는 다른 계획이 같이 고칠 수 있으니 시작할 때 한 번 다시 연다.
