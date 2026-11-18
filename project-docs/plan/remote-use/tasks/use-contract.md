# use-contract

다른 기계로 넘기는 call의 계약을 고정한다: call frame에 싣는 요청한 쪽(`Requester`), 기계 이름 풀기, `--on`을 떼는 parser 함수, 받는 기계의 앱 command 입구 route, 호출 기록의 새 caller 종류 `remote`와 그 ledger step, 할당에 붙는 기계, 앱 호출 경로의 `remote` target과 그 port, core의 `machineLinks` 자리. 동작은 짓지 않는다(port는 `unavailable`을 돌려주는 자리만 둔다). SDK `@lophn/cap-tool`의 caller 모양과 `connectCommands`의 `on`을 여기서 한 번에 올린다. `architecture/app-call.md`·`approval.md` 초안을 쓴다.

- 단위: use (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/requester.ts`(새 file), `packages/protocol/remote/requester_test.ts`(새 file), `packages/protocol/remote/frames.ts`, `packages/protocol/remote/routes.ts`
  - `packages/protocol/apps/calls/remote.ts`(새 file), `packages/protocol/apps/calls/{caller,call,broker}.ts`
  - `packages/protocol/approvals/assignment.ts`, `packages/protocol/lophn-agent/{agent-values,call-policy}.ts`, `packages/protocol/apps/declaration/tools.ts`
  - `packages/cli/parser.ts`
  - `packages/core/main/daemon/wiring/context.ts`(`Late`와 `LATE_KEYS`에 `machineLinks`. `use-grant`가 `computerSigningKey` 아래에 `computerGranted` 한 줄을 더한다. 자리가 달라 merge가 합친다), `packages/core/main/daemon/wiring/apps.ts`(forward 자리 한 줄)
  - `packages/core/remote/machine-routes.ts`(`shell_capability`가 optional이 되어 type이 깨지면 칸이 없을 때도 지금처럼 `forbidden`으로 두는 한 줄만. `screen`·`terminal` 갈래는 `use-send`)
  - `packages/core/apps/calls/{caller,gate,service,intake}.ts`, `packages/core/apps/calls/forward.ts`(새 file, type만), `packages/core/apps/calls/calls_test.ts`(새 dep `forward`를 채우는 것만)
  - `packages/core/apps/invocations/{schema,schema_test,context,rows}.ts`, `packages/core/apps/runtime/entrypoint/{wire,broker-client}.ts`(손 사본)
  - `packages/sdk/cap-tool/{context,connect}.ts`, `packages/sdk/cap-tool/guide.md`, `packages/sdk/cap-tool/package.json`(2.2.0 → 2.3.0), `packages/core/agent-workspaces/skills/migrate-sdk/cap-tool-2.3.0.md`(새 file)
  - pin 자리(`sdk-note`의 grep으로 찾은 것만): `packages/core/apps/packages/template/app/{lophn.ts.tmpl,package.json.tmpl}`(지금 `cap-tool` 2.2.0), `tests/support/app/sample/lophn.ts.tmpl`, `package-lock.json`
  - `packages/shell/renderer/app-frame/app-detail/reads.ts`(type이 깨지는 `remote` 갈래 한 줄만)
  - `project-docs/architecture/app-call.md`, `project-docs/architecture/approval.md`, `project-docs/flows/tests/{libs-tooling,core-apps}.yaml`
- 읽을 것:
  - 계획 README "정한 것" 전부, roadmap `project-docs/products/roadmap/multi-device.md`("주고받는 것 네 가지", "해도 되나", "사람이 정한 것")
  - 조사 `reports/multi-device/survey-n3-remote-use.md` 1.1~1.5, 5절, 8절(조사 뒤 `multi-device-fixes`·`carry-paths`·`one-screen`이 올라가 줄 번호와 몇 곳이 바뀌었다. 이 brief의 이름이 맞다). review `reports/multi-device/review-core-setup.md` finding 1과 "Facts the next plans build on"
  - 변경 기록: `project-docs/products/change-log/0.23/multi-device-fixes.yaml`(`machines/*`의 capability, 기기 허락의 가장자리), `one-screen.yaml`(기기 route 목록, 구독자마다의 watch)
  - architecture: `app-call.md`("호출의 흐름", 지키는 것 "호출 경로" 2·8, "경계와 계약"), `approval.md`("폰(기기) 자격", 지키는 것 2·6·7), `agent-call.md`(call 정책), `remote.md`
  - boundary·module: `remote-protocol`, `core-api`, `child-supervision-protocol`, `sdk-api`; module `remote`, `apps`, `approvals`, `coding-agent-cli`
  - skill: `.claude/skills/sdk-note/SKILL.md`, `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `callFrameSchema`(`frames.ts`의 export하지 않은 const. 이 file 안에서 고친다), `machinesCall`·`machinesWatch`(`routes.ts`. 지금 입력은 `machinesCall {machine, resource, method, body, shell_capability}`와 `machinesWatch {machine, watcher, conditions, shell_capability}`), `appToolCallerSchema`, `appToolTargetSchema`, `toolCallOutputSchema`, `brokerAppCallInputSchema`, `assignmentEntrySchema`, `callPolicySchema`, `multi-device-fixes`가 둔 `createMachineRoutes`(`packages/core/remote/machine-routes.ts`), `parseCommandLine`, `Late`·`LATE_KEYS`(`wiring/context.ts`)
  - 내놓는 것(뒤 task가 이 이름으로 짓는다):
    - `requester.ts`: `requesterSchema`(type `Requester`), kind로 가른다. `{kind:"screen"}`(그 기계의 shell이 그린 사람의 화면: 살아 있는 shell capability를 실은 `machines/call`), `{kind:"terminal"}`(사람의 터미널: capability 없이 부른 사람의 CLI token), `{kind:"agent", agent: AgentId, session: ses_ | null, name: 1~64자}`(session null은 core가 그 agent 대신 읽을 때), `{kind:"app", app: app_}`. `machineRefSchema`(trim 1~64자: 컴퓨터 이름, `mch_`, `dev_`). `MachineCandidate = {machine: mch_, device: dev_, name, self: boolean}`과 그 schema. 순수 함수 `resolveMachine(ref, computers): Result<MachineCandidate>`: `mch_`로 시작하면 기계 id, `dev_`면 기기 id, 아니면 이름이 글자 그대로 같은 것. 없으면 `not_found`, 둘 이상이면 고르지 않고 `invalid_input`(`details.candidates: [{machine, device, name}]`, 문구는 기기 id로 고르라고 한다).
    - `frames.ts`: `call` frame(strictObject)에 `by: requesterSchema.optional()`. 컴퓨터의 core만 싣고 폰은 싣지 않는다. `REMOTE_PROTOCOL_VERSION`과 `REMOTE_PROTOCOL_MIN_VERSION`을 4에서 5로 올려 같게 둔다(0.23.90에서 둘 다 4다. `multi-device-fixes`가 4로 올렸고 `carry-paths`·`one-screen`은 올리지 않았다). `use-grant`가 명단 항목의 모양을 바꾸는 것도 같은 5에 얹는다(그 task는 상수를 고치지 않는다). 상수의 주석(판 4는 명단 규칙이다)에 판 5를 더한다.
    - `routes.ts`: `machinesCall.input.machine`을 `machineRefSchema`로 넓힌다(화면은 지금처럼 `mch_`를 준다). `machinesCall` 위 주석("받는 기계는 `device:<이 컴퓨터의 id>`인 사람으로 보고")을 요청한 쪽 기준으로 고친다. `machinesCall.input.shell_capability`(`multi-device-fixes`가 둔 칸)를 optional로 바꾼다: 살아 있는 capability면 `screen`, 칸이 없으면 `terminal`, 있는데 살아 있지 않으면 `forbidden`(`createMachineRoutes`가 정한다, `use-send`). `machinesWatch`의 칸은 그대로 필요하다(구독은 화면의 것이다. 이 core 안 구독자는 `machines/watch`를 거치지 않고 `links.watch`를 바로 부른다: `use-events`). 주석: 요청한 쪽은 core가 capability로 정하고 입력의 다른 칸으로 싣는 길은 없다. 새 `machinesAppTools` = `machines/app_tools`(memory, `actors: ["machine"]`), 입력 `{agent: AgentId, workspace: Workspace | null}`, 출력 `{machines: MachineCandidate[], apps: [{machine: mch_, app: app_, name, view: appTools.output | null}]}`(view null은 닿지 않거나 거절됨). agent runtime이 그 agent에 할당된 다른 기계 앱의 command 목록을 읽는다.
    - `apps/calls/remote.ts`: `appRemoteCall` = `apps/remote_call`(memory, `actors: ["user"]`, errors는 `appCallTool`과 같다), 입력 `{app: app_, command: ToolName, input?: JsonValue, by: Requester}`, 출력 `toolCallOutputSchema`. 받는 기계의 앱 command 입구다. `by`는 받는 기계의 `createRemoteCall`만 frame에서 옮겨 쓰고, handler는 명단의 컴퓨터인 `device:` principal이 아니면 `forbidden`이다.
    - `caller.ts`: `{kind:"remote", machine: mch_, device: dev_, requester: Requester}`(부른 컴퓨터와 그 안의 요청한 쪽). `event` caller의 `machine?: mch_`는 `carry-paths`가 이미 두었고(폴더로 온 event의 난 기계), `person`에는 `device`·`machine`이 따로 있다(폰이나 폴더에서 맞춘 변경). 새 `remote`와 이름이 겹치지 않게 그 둘은 그대로 둔다.
    - `call.ts`: target에 `{mode:"remote", machine: MachineRef, app: app_}`. 규칙 주석: command만, caller는 agent와 app만.
    - `broker.ts`: `brokerAppCallInputSchema`에 `machine?: MachineRef`.
    - `assignment.ts`: 줄에 `machine?: mch_`와 `name?: 1~64자`(그 기계 앱의 표시 이름, machine이 있을 때만 있고 그때는 있어야 한다). 같은 줄은 `(machine, app)`로 본다(refine).
    - `agent-values.ts`: 정의 칸 `remote_apps: [{machine: mch_, app: app_, name, removed: ToolKey[]}]`(optional, 입력과 출력 칸 둘 다, 사람만 쓰는 칸).
    - `call-policy.ts`: `isPrivate(policy, workspace: Workspace | null): boolean`(Home은 늘 false).
    - `parser.ts`: `splitOn(argv): Result<{on: string | null; argv: string[]}>`. `--on <값>`을 어디서든 떼어 낸다. 값이 없거나 `--`로 시작하면 `flag needs a value: --on`, 두 번이면 `duplicate flag: --on`(둘 다 `invalid_input`).
    - `wiring/context.ts`: Late 자리 `machineLinks: { computers(): MachineCandidate[]; resolve(ref: string): Result<MachineCandidate>; call(machine: Id<"mch">, call: {resource: string; method: string; body: unknown}, by: Requester): Promise<Result<unknown>> }`. remote wiring이 낸다(`use-send`). 구독은 `use-events`가 더한다.
    - `core/apps/calls/forward.ts`: `type RemoteForward = (call: {caller: agent|app VerifiedCaller; target: {machine: string; app: Id<"app">}; name: string; input: JsonValue | undefined}) => Promise<Result<ToolCallOutput>>`. `AppCallsDeps.forward: RemoteForward`.
    - `Flight`(`intake.ts`)에 `remote: boolean`: 이 호출의 caller가 `remote`이거나 부모 flight가 `remote`면 참이다. 부르는 기계가 "받은 call은 다시 넘기지 않는다"를 이것으로 본다.
    - `CallAuth.actor`에 `"remote"`, `CallAuth.remote?: {machine, device, requester}`(route는 만들지 못하고 받는 기계의 입구 handler만 만든다). `VerifiedCaller`에 `{kind:"remote", machine, device, requester}`.
    - ledger step `apps.invocations.remote-caller`(export `invocationsRemoteCallerSchemaSteps`, `packages/core/apps/invocations/schema.ts`).
    - 뒤 task가 protocol에 더할 이름(이 task는 쓰지 않는다): job trigger 입력 `machine?: MachineRef`(`jobTriggerInputSchema`), 저장 `source_machine?: mch_`(`jobTriggerSchema`), `jobEventSchema.machine?: mch_`, `jobFireEvent` 입력과 `jobEventTriggers` 줄의 `machine`, 앱 선언 `subscriptions[].machine?: <컴퓨터 이름>`(`use-events`).

## 할 일

1. `requester.ts`를 위 모양으로 쓴다. 머리 주석에 누가 어느 kind를 싣는지 적는다: `screen`은 살아 있는 shell capability를 실은 `machines/call`만, `terminal`은 capability 없이 부른 사람의 CLI token의 `machines/call`(agent·앱 자격은 `machines/call`의 actor가 아니다), `agent`는 agent 자격의 앱 호출과 core가 그 agent 대신 하는 `machines/app_tools`, `app`은 앱 자격의 앱 호출. 입력의 칸으로 싣는 길은 없다. 받은 call은 다른 기계로 다시 넘기지 않는다(README "정한 것", 계획 README의 review 항목).
2. `frames.ts`, `routes.ts`, `apps/calls/remote.ts`, `caller.ts`, `call.ts`, `broker.ts`를 고친다. route는 정의만 하고 등록하지 않는다(handler 없는 route를 올리면 core가 뜨지 않는다).
3. `assignment.ts`, `agent-values.ts`, `call-policy.ts`를 고친다(README "허락은 부르는 기계에서 본다", "private은 기계 사이에도 선다").
4. `parser.ts`에 `splitOn`. `packages/protocol/apps/declaration/tools.ts`의 command 입력 flag 검사(314~327줄의 `flags` 표, 지금은 같은 flag끼리의 충돌만 본다)에서 flag가 `--on`인 최상위 칸을 거절한다(`command <x> field on has the CLI flag --on, which picks a machine`). 전역 flag는 `--json`, `--help`, `--input`, `--input-file`, `--idempotency-key`, `--on`이다. 0.23.90 main의 명령 표(`COMMANDS` 80개 `packages/cli/commands/mod.ts`, `LOCAL_COMMANDS` 7개 `packages/coding-agent/mod.ts`, `CORE_COMMANDS` 1개 `packages/cli/commands/core.ts`)를 `fieldsOf`(`packages/cli/parser.ts`)로 훑으면 flag가 `--on`·`--no-on`인 칸이 없다(2026-11-19 확인. `--machine`은 `machine forget`의 칸이라 쓰지 않는다). `use-grant`의 새 명령 `remote terminal-input`은 `--off`를 쓰므로 부딪치지 않는다. 시작할 때 같은 훑기를 다시 해 보고에 적는다(test로 두지 않는다).
5. core type 맞추기: `caller.ts`(CallAuth·VerifiedCaller·`verifyCaller`: `remote`는 `auth.remote`와 본문이 같을 때만 통과, agent·app의 `remote` target을 받는다), `gate.ts`(`remote` caller는 아직 `ok(false)`), `intake.ts`·`service.ts`(flight를 만들 때 `remote`를 채운다. `verifyCaller` 바로 뒤에 `target.mode === "remote"`면 command가 아니거나 caller가 agent·app이 아닐 때 `forbidden`, 아니면 `deps.forward`로 넘긴다), `wiring/apps.ts`(forward 자리에 `unavailable`을 돌려주는 함수). `forward.ts`는 type만 둔다. `createRemoteCall`의 dep `kind`(받는 쪽이 기기의 종류를 보는 자리)는 이 task가 두지 않는다. `use-receive`가 `call.ts`에 두고 `call_test.ts`의 준비와 `wiring/remote.ts`의 한 줄을 넘길 줄로 맞춘다(`wiring/remote.ts`는 같은 wave 1의 `use-grant`가, `call_test.ts`는 wave 2의 `use-send`가 소유한다). 이 task는 `call.ts`·`call_test.ts`·`wiring/remote.ts`를 고치지 않는다. `call_test.ts`의 `multi-device-fixes` test(441줄)는 `use-send`가 바꾼다.
6. ledger step: `apps.invocations.event-caller`(`invocations/schema.ts` 120줄)처럼 `invocations`를 다시 짜 `caller_kind` CHECK(지금 `'person','agent','app','program','flow','event'`)에 `'remote'`를 더한다. index·trigger는 그 step의 SQL이 아니라 지금 ledger의 모양을 옮긴다. `invocations_no_delete`는 `apps/registration/schema.ts` 90줄이 erase window 조건으로 다시 만든다: 새 data root로 모든 step을 돈 뒤 `sqlite_master`에서 읽어 맞춘다. 낸 step의 SQL은 고치지 않는다. `rows.ts`가 kind를 읽으면 같이 맞춘다. lead가 `packages/core/main/daemon/wiring/remote.ts`의 `schemaStepsAfterTeams` 끝에 `...invocationsRemoteCallerSchemaSteps`를, `schema-steps.lock.json` 끝에 `{id, sha256}`을 더한다.
7. 손 사본(`app-call.md` 지키는 것 8): `core/apps/invocations/context.ts`, `core/apps/runtime/entrypoint/wire.ts`(parser가 `remote`를 받는다. 지금 event caller의 `machine`과 person의 `device`·`machine`은 세 손 사본 모두에 없고 parser가 아는 칸만 옮겨 버린다: event의 `machine`도 같이 더한다), `entrypoint/broker-client.ts`(`appsCall` 본문 `machine?`), SDK `cap-tool/context.ts`. SDK `connectCommands(app, commands, options?: {on?: string})`(`connect.ts` 158줄, 지금 `(app, commands)`)가 broker 본문에 `machine`을 싣는다. `guide.md`에 한 단락(다른 기계의 앱 부르기, `remote` caller). `sdk-note` skill대로 `cap-tool` 2.2.0 → 2.3.0(minor), pin, `migrate-sdk` 메모, Instruction diff. `cap-tool`은 다른 SDK package를 pin하지 않고 `@lophn/declaration`(4.10.0)·`@lophn/app-ui`(2.21.0)·`@lophn/app-ui-native`(1.8.0)는 이 task가 올리지 않는다(`use-events`가 올린다).
8. renderer `app-detail/reads.ts`의 `callerOf`가 type으로 깨지면 `remote` 갈래를 가장 작게 둔다(보이는 모양은 `use-screens`).
9. `app-call.md` 초안: caller 일곱, `remote` target과 받는 기계 입구, 손 사본 목록. `approval.md` 초안: "폰(기기) 자격"의 넘긴 call 단락을 요청한 쪽 표(아래)로, 할당의 기계, private의 두 자리. 할당한 앱 command는 다른 기계의 것도 묻지 않고 돈다(승인 카드는 그대로다). code path는 적지 않는다.

받는 기계의 표(`approval.md`에 그대로 적는다. 구현은 `use-receive`):

| 요청한 쪽 | 기기 목록(`REMOTE_ALLOWED_ROUTES`) | 사람 목록과 확인이 필요한 command | 앱 command 입구 `apps/remote_call` |
|---|---|---|---|
| 없음(폰) | 된다 | 허락이 있으면 | 안 된다(컴퓨터만) |
| `screen` | 된다 | 허락이 있으면(지금처럼 handle을 붙인다) | 허락이 있으면 |
| `terminal` | 된다 | 안 된다 | 허락이 있으면 |
| `agent`, `app` | 앱 읽기 셋(`apps/list|get|tools`)만 | 안 된다 | 허락이 있고 대상 앱의 workspace가 private이 아니면 |

모든 입구 호출은 `public` command만 받는다. 폰이 `by`를 실으면, 컴퓨터가 `by` 없이 부르면 `invalid_input`이다.

정한 것:
- 사람의 터미널은 새 route 없이 `machines/call`을 같이 쓰고 요청한 쪽만 자격으로 가른다: 넘기는 길이 하나다. `multi-device-fixes`가 막은 CLI 길을 `terminal`로 다시 연다(그 변경 기록 decisions: "CLI에서 다른 기계를 부르는 것은 `remote-use`가 요청한 쪽을 실어서 연다").
- 받는 기계의 입구는 새 route다. `apps/call_tool`은 기기 자격이 `person` caller가 되어 Gate를 건너고 operation(화면용)까지 닿는다. `runs/start`는 run 기록이 사람 caller이고 agent run까지 연다(a2a는 범위 밖).
- 부르는 기계의 agent·앱 길은 새 route가 아니라 `apps/call_tool`의 `remote` target이다: 부른 쪽 확인(도는 turn, 부모 invocation)이 그 service 안에 있다.
- 앱의 `app.call` grant는 기계와 상관없이 그 앱을 덮는다: 앱 id는 기계 사이 같고 README가 grant 모양을 바꾸지 않았다.
- 기계 사이에는 call 정책의 workspace 쌍 규칙을 보지 않는다: 그 key는 기계마다의 id다. private 목록만 본다.
- 이름 풀기는 글자 그대로다(대소문자도). 이 컴퓨터를 고른 `--on`은 `invalid_input`이다(그냥 빼면 된다).
- 승인 카드의 subject(`gate-call.ts`)에는 기계를 싣지 않는다: 할당한 앱 command는 묻지 않으므로(`judge.ts`의 `ASK_EXTERNAL_WHEN_ATTENDED = false`) 그것을 읽는 곳이 없다. 기계는 할당 줄과 호출 기록에만 있다.
- 할당의 다른 기계 앱은 정의 파일의 새 칸 `remote_apps`에 id로 둔다: 그 앱은 이 기계에 slug가 없다. 이름은 꺼진 기계의 앱을 보일 표시값이다. 옛 파일에는 그 칸이 없으므로 data step이 없다.

## 끝남

- `npm run check`가 통과한다. protocol을 폰이 같이 쓰므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test: "호출 기록을 옮긴 뒤 지난 기록이 그대로 읽힌다"(`schema_test.ts`, 38줄의 기존 event-caller test 옆에. 여섯 종류의 행을 넣고 step을 돈 뒤 행과 index·trigger가 같고 `remote` 행이 들어간다). `requester_test.ts`: "같은 이름의 컴퓨터가 둘이면 고르지 않고 후보를 돌려준다"(순수 함수 표 하나).
- 새로 subprocess·서버를 띄우는 test는 만들지 않는다.
- 남지 않음: 없음(지우는 것이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는: `packages/protocol/remote/mod.ts`(requester.ts export, `machinesAppTools`), `packages/protocol/apps/calls/mod.ts`·`apps/mod.ts`(`appRemoteCall`), `allowlist.ts`에 `REMOTE_AGENT_ROUTES = [appList, appGet, appTools, appRemoteCall]`(거르기용. scope 목록이 아니라 지금 넣어도 된다), schema step(`wiring/remote.ts`의 `schemaStepsAfterTeams` 끝의 `...invocationsRemoteCallerSchemaSteps`와 `schema-steps.lock.json` 끝 `{id, sha256}`. `use-grant`의 step과 둘이라 lead가 차례를 정해 둘 다에 같은 차례로 넣는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 시작 전에 다시 볼 것

- 없음(이 brief를 쓴 날 code로 위를 확인했다). 시작할 때 `REMOTE_PROTOCOL_VERSION`이 4(하한 4)이고 `schema-steps.lock.json`의 끝이 `projects.registry.former-identities`인지 한 줄로 본다. 다른 계획이 먼저 올렸으면 다음 수와 그 뒤에 붙인다.
- 이 task가 크다. 한 session에 안 끝나면 SDK와 손 사본(7)을 wave 1의 둘째 task `use-contract-sdk`로 뗀다. 그 부분은 위 "내놓는 것"의 모양만 쓰므로 다른 부분을 기다리지 않는다.
