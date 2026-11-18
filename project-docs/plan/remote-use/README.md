# remote-use

- 목표: agent와 앱이 다른 기계의 앱을 쓰고 그 앱의 event를 받는다. 내 PC의 agent가 VM의 monitoring 앱 command를 부르고, 그 앱이 낸 event로 내 PC의 job이 돈다. 사람은 터미널에서 다른 기계에 명령을 보낸다. workspace의 private 설정이 기계 사이에도 선다.
- 재료: `project-docs/products/roadmap/multi-device.md`("주고받는 것 네 가지"의 remote와 event, "해도 되나", "사람이 정한 것"), `project-docs/architecture/agent-call.md`(call 정책, private), `app-call.md`, `approval.md`, `event.md`, `job.md`, `remote.md`, 조사 `reports/multi-device/survey-n3-remote-use.md`(지금 code, file 묶음 G1~G10, 열린 물음), review `reports/multi-device/review-core-setup.md`("Facts the next plans build on")
- 기대는 것(셋 모두 main에 올라갔다. 기록은 `project-docs/products/change-log/0.23/<이름>.yaml`): `multi-device-fixes`(0.23.88. `machines/call|watch`가 살아 있는 shell capability를 요구하고 사람의 CLI token으로는 다른 기계를 부르지 못한다), `one-screen`(0.23.90. 창 하나가 모든 컴퓨터를 보고 다른 기계의 event 구독이 구독자마다의 합으로 걸린다. 기기 route 목록이 넓어졌고 Settings에 기계 고르기가 있다), `carry-paths`(0.23.89. 앱이 `across_machines`로 낸 event와 `data.changed`가 file로 가 도착한 기계에서 한 번 나온다. 따라가기는 `computers`로만 온 release를 늘 묻는다)
- 범위 밖: a2a(다른 기계의 agent에게 일을 맡기기, handoff), 꺼진 기계의 것을 쓰기, agent가 다른 기계의 터미널·browser page·file·job을 다루기(사람의 화면은 `one-screen`이 한다), 다른 기계에 job 만들기

## 정한 것

- **대상은 앱의 command와 앱의 event다.** 정해진 동작을 가진 것만 부른다. 다른 기계의 agent에게 판단을 맡기는 것은 a2a다. (사람: remote와 a2a를 나눴다)
- **요청에 누가 시켰는지가 실린다.** 지금 다른 기계로 넘기는 call에는 요청한 쪽이 없고, 받는 기계는 모두를 "그 컴퓨터의 사람"으로 본다. 넘기는 call에 요청한 쪽(사람의 화면, 사람의 터미널, 어느 agent, 어느 앱)을 싣고, 받는 기계는 그것을 기록하고 종류마다 다르게 대한다. 사람의 화면이 아닌 요청은 사람의 route(secret, 설정)와 자동 확인을 받지 못한다. (agent: `core-setup` review의 지적)
- **허락은 부르는 기계에서 본다.** agent가 다른 기계의 앱을 쓰려면 사람이 부르는 기계에서 그 앱을 그 agent에 할당한다(할당에 "어느 기계의"가 붙는다). 할당된 앱의 command는 지금처럼 묻지 않고 돈다(이 기계의 앱도 그렇다. 승인 card는 지금 앱 command에 뜨지 않는다). 호출 기록에는 어느 기계의 누가 불렀는지가 남는다. (사람: "기존의 approval이랑 크게 다를 게 없을 거 같은데")
- **허락은 받는 컴퓨터가 정한다.** 터미널 입력 허락은 명단의 칸이 아니라 각 컴퓨터가 자기에서 켠 것만 인정한다. 지금은 명단의 컴퓨터가 자기 허락을 스스로 켤 수 있다(이슈 `roster-computer-self-grants-terminal-input`). 잃는 것: 한 번 켜면 모든 컴퓨터에 서던 것이 없어져 컴퓨터마다 한 번씩 켠다. 초대장의 허락은 초대장을 낸 컴퓨터에만 선다. (사람, 2026-11-19)
- **받는 기계는 자기 규칙을 본다.** 받는 기계는 요청한 기계가 명단의 컴퓨터이고 터미널 입력 허락이 있는지(앱에 시키는 것은 그 기계를 다루는 것이다), 대상 앱의 workspace가 private이 아닌지, command가 밖에 내놓은 것인지를 본다. 부른 기계의 할당을 다시 따지지 않는다: 명단의 컴퓨터는 대등하고 그 사람의 것이다. (agent)
- **private은 기계 사이에도 선다.** private인 workspace의 agent와 앱은 다른 기계를 부르지 못하고(부르는 기계가 막는다), 다른 기계에서 불리지 않는다(받는 기계가 막는다). 각자 자기 workspace의 설정으로 본다. 사람의 화면과 터미널은 private이어도 된다. agent가 같은 기계의 앱을 부를 때는 지금처럼 할당만 본다. (사람, 2026-11-17)
- **기계는 인자 하나로 고른다.** CLI와 agent의 `lophn` tool에 `--on <기계 이름>`이 붙는다. 안 붙이면 이 기계다. 이름은 명단의 컴퓨터 이름이고, 같은 이름이 둘이면 고르지 않고 후보를 보인다(기기 id로도 고른다). `--machine`은 그 이름의 입력을 가진 명령과 부딪혀 쓰지 않는다. (agent)
- **사람의 터미널은 다른 기계에 명령을 보낸다.** `lophn <명령> --on <기계>`는 기기 route 목록에 있는 명령만 된다. 요청한 쪽이 "터미널"로 실리므로 받는 기계는 사람의 route와 자동 확인을 주지 않는다. (agent)
- **다른 기계의 앱이 무엇을 할 수 있는지는 그 기계에 묻는다.** agent는 할당된 다른 기계의 앱 command 목록과 입력 모양을 그 기계에서 읽는다(읽는 route는 이미 기기 목록에 있다). 그 기계가 꺼져 있으면 그 앱은 "지금 닿지 않는다"로 보인다. (agent)
- **구독하는 주체가 있다.** job의 trigger와 앱의 event 구독에 "어느 기계의 어느 앱"을 적을 수 있다. 부르는 기계의 core가 구독자를 대신해 그 기계에 구독을 걸고, 온 event를 이 기계에서 낸다(난 기계를 싣고). 구독은 선언(job, 앱)에서 오므로 core가 다시 떠도, 연결이 끊겼다 붙어도 이어진다. 끊긴 동안의 event는 `carry-paths`의 길로 늦게 온다. (사람: "구독하는 주체가 있을 거 아니야")
- **받는 기계가 내주는 event는 앱이 밖에 낸 것뿐이다.** private인 workspace의 것은 내주지 않는다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `use-grant` | 없음 | 터미널 입력 허락을 받는 컴퓨터의 ledger로 옮긴다: 명단의 칸을 없애고, 초대장과 My devices의 스위치(과 화면 없는 컴퓨터를 위한 CLI)가 이 컴퓨터의 허락만 바꾼다. 쓰던 허락은 첫 기동에서 옮긴다. 여기서 허락한 컴퓨터의 새 release는 묻지 않고 따라간다 |
| 1 | `use-contract` | 없음 | 넘기는 call에 싣는 요청한 쪽, 받는 쪽의 새 입구 route와 기록(호출 기록의 새 종류와 ledger step), 할당·trigger·구독에 붙는 기계, 기계 이름 풀기, `--on`. `architecture/app-call.md`·`approval.md` 초안 |
| 1 | `use-contract-sdk` | 없음 | 앱 process의 caller 손 사본 셋과 SDK `cap-tool` 2.3.0(`remote` caller, event의 `machine`, `connectCommands`의 `on`), `migrate-sdk` 메모와 pin. `use-contract`가 고정하는 모양과 같게 짓고 서로의 code를 기다리지 않는다 |
| 2 | `use-receive` | `use-contract`, `use-grant` | 받는 기계: 입구 route, 요청한 쪽을 종류마다 대하기, 터미널 입력 허락·private·내놓은 command 검사, 기록 |
| 2 | `use-send` | `use-contract` | 부르는 기계: agent의 tool과 앱의 호출이 다른 기계의 앱으로 가는 길, 할당과 승인, private, 닿지 않을 때 |
| 2 | `use-cli` | `use-contract` | CLI의 `--on`과 기계 이름 풀기, 사람의 터미널에서 다른 기계로 |
| 3 | `use-events` | `use-receive`, `use-send` | 다른 기계의 앱 event 구독: 선언에서 구독 걸기, 이 기계에서 내기, job trigger와 앱의 구독, SDK |
| 3 | `use-screens` | `use-send` | 다른 기계의 앱을 agent에 할당하는 화면, 호출 기록에 "어느 기계의" 보이기 |
| 4 | `use-cleanup` | `use-events`, `use-screens`, `use-cli` | 요청한 쪽 없이 넘기던 옛 길, flows·catalog, 문서 |

## 위험 test (brief에 있다)

- 명단의 컴퓨터가 자기 항목이나 다른 기기의 항목을 어떻게 서명해도 다른 컴퓨터의 터미널 입력 허락은 켜지지 않는다.
- agent나 앱이 요청한 call은 받는 기계에서 사람의 route와 확인이 필요한 명령을 통과하지 못한다(부른 컴퓨터에 허락이 있어도).
- 요청한 쪽을 속여 "사람의 화면"이라고 실어 보낼 수 있는 것은 그 기계의 shell뿐이다(agent와 CLI의 자격으로는 그 값을 싣지 못한다).
- 할당이 없는 agent는 다른 기계의 앱을 부르지 못한다.
- private인 workspace의 agent와 앱은 다른 기계를 부르지 못하고, private인 workspace의 앱은 다른 기계에서 불리지 않는다.
- 터미널 입력 허락이 없는 컴퓨터의 요청은 받는 기계가 앱 command를 돌리지 않는다.
- private인 workspace의 앱 event는 다른 기계의 구독자에게 가지 않는다.
- 호출 기록을 옮긴 뒤 지난 기록이 그대로 읽힌다.

## 남는 한계

- 다른 컴퓨터만 가진 앱의 event는 이 컴퓨터가 꺼져 있거나 닿지 않는 동안 낸 것이 남지 않는다. 연결은 그 순간의 event만 나르고 저장하지 않는다. 늦게 오는 것은 두 컴퓨터가 다 가진 앱(`sync_to`)의 `across_machines` event뿐이다. 이 계획은 대기열을 만들지 않는다.

## 시작할 때의 code

0.23.90 main(세 계획이 올라간 뒤)에서 확인한 것이다. brief의 "시작 전에 다시 볼 것"은 여기서 남은 것만 적는다.

- **판**: remote protocol 판은 4(하한 4)다. 세 계획 가운데 `multi-device-fixes`만 올렸다(`packages/protocol/remote/frames.ts`). `use-contract`가 call frame에 `by`를 더하며 5로 올리고, `use-grant`가 바꾸는 명단 항목 모양도 같은 5에 얹는다.
- **기계를 고르는 길**: `machines/call`·`machines/watch`는 입력의 살아 있는 `shell_capability`를 요구한다(`createMachineRoutes`, `packages/core/remote/machine-routes.ts`). 창은 기계에 묶이지 않고 shell main이 IPC의 `machine` 칸으로 그 기계의 core를 고른다(`packages/shell/main/desktop/viewer/machine-route.ts`). 사람의 CLI token은 capability가 없어 지금 `forbidden`이다(`call_test.ts` 441줄의 test). `use-send`가 이것을 `terminal`로 연다.
- **link와 구독**: `packages/core/remote/links.ts`는 기계마다 구독자별 조건 `{capability | null, watcher}`를 모아 그 합을 건다(core 안 구독자는 `capability: null`). 나르기가 `StateChanged` 조건을 늘 더해 걸고 구독자가 원하지 않으면 화면에 싣지 않는다. 받은 frame은 bus의 `MachineFrameReceived {machine, frame, watcher?}`이고 `watcher`는 `ready`에만 실린다. link 하나의 call은 같이 8개, 하나 120초다(`remote-client/connection.ts`).
- **기기 route 목록**(`packages/protocol/remote/allowlist.ts`): 모든 기기의 목록에 `terminals/list`, `coding_sessions/cli_sessions|rewind_preview`, `app_grants/list`, `app_sessions/*`, `app_calls/*`, `app_agents/list`, `carry/*`가 들어 있고 사람 route 목록(허락받은 기기만)에 `terminals/close|restart`가 있다. event 목록에 `TerminalRuntimeChanged`, `TerminalAgentSignaled`, `AppRemoved`가 있고 `AppEventPublished`는 없다. `apps/call_tool`은 어느 목록에도 없다. 앱 session·call route는 기기가 자기가 연 view로만 부른다(`packages/core/main/daemon/wiring/app-principal.ts`).
- **허락**: `ctx.terminalInputGrant(principal)`는 명단 항목의 `terminal_input`을 읽는다(`wiring/remote.ts` 855줄 한 자리). `use-grant`가 이 컴퓨터의 ledger 표로 옮긴다. 따라가기 규칙은 `followAsksPerson`(`packages/core/folder/import/follow.ts`)이고 지금은 `computers`로만 온 release를 늘 묻는다.
- **다른 기계의 event(늦은 길)**: 선언 `across_machines: true`(`sync_to`가 있는 앱)의 event는 file로 가고 도착한 기계가 `readArrivedEvents`(`folder/import/events.ts`)로 읽어 `folder_events_seen`에 적은 새 줄만 `createEventArrival`(`apps/events/publish.ts`)로 낸다. 난 기계는 발행 기록의 `machine`과 event caller의 `machine`에 실린다. 앱 event가 연결(live)로도 오게 하는 `use-events`는 이 길과 한 번만 내는 자리를 맞춘다(brief의 "늦은 길과 만나는 곳").
- **ledger step**: 맨 뒤 wiring은 `remote`(`wiring/remote.ts`의 `schemaStepsAfterTeams`)이고 `schema-steps.lock.json`의 끝은 `folder.events-seen`, `apps.event-publications.machine`, `folder.carry-marks`, `projects.registry.former-identities`다. `use-grant`와 `use-contract`가 각각 step을 더하므로 lead가 둘의 차례를 정해 둘 다에 같은 차례로 넣는다.
- **화면**: Settings의 기계 고르기(`packages/shell/renderer/desktop/settings/machine-picker.tsx`)는 `MACHINE_PANES`(General, Providers, Agents, Tools and skills, Shell rules, Diagnostics)만 다른 컴퓨터로 연다. Remote와 Sync는 이 컴퓨터의 것이다. 기계 범위는 `desktop/machines/`(`MachineHub`, `MachineScope`, `useMachineData`), 기계 꼬리표는 `MachineTag`(`shell/left-sidebar.tsx`), 목록은 `MachineListsProvider`다. Agents 탭과 App details는 이 컴퓨터에서만 열린다.
- **SDK 판**: `@lophn/declaration` 4.10.0, `@lophn/app-ui` 2.21.0, `@lophn/app-ui-native` 1.8.0, `@lophn/cap-tool` 2.2.0.
- **이미 있는 안내**: 허락이 없는 컴퓨터를 만나면 화면은 그 컴퓨터의 Settings › Remote › My devices에서 켜라고 말한다(`machines.gate.*`·`remote-desk.ts`, 터미널의 "View only"). 이 계획이 허락을 컴퓨터마다의 것으로 바꿔도 문구는 맞다.
- 이슈 `remote-call-errors-drop-details`는 `multi-device-fixes`가 고쳐 fixed다(`call.ts`가 `details`를 싣는다).

## lead가 할 일

- 세 계획이 올라간 뒤의 code로 brief를 다시 맞췄다(2026-11-19). brief마다 "시작 전에 다시 볼 것"에 남은 것만 있다. 띄울 때 `git log --oneline -5`로 그 사이 바뀐 곳만 본다.
- 권한 경계를 바꾸는 계획이다. `use-contract`와 `use-grant`가 끝나면 merge하기 전에 다른 worker에게 review를 맡긴다. 볼 것: 요청한 쪽을 누가 실을 수 있는가, 받는 기계가 믿는 것과 다시 보는 것, 한 hop을 더 건너 넓어지는 길(A가 B를 거쳐 C), 허락이 명단 view로 다시 새지 않는가.
- wave 1을 합칠 때 lead가 맞출 줄: `schemaStepsAfterTeams`와 `schema-steps.lock.json`에 두 task의 step을 같은 차례로, `wiring/context.ts`(`use-contract`의 `machineLinks`와 `use-grant`의 `computerGranted`를 둘 다), `protocol/remote/mod.ts`·`core/remote/mod.ts`의 export, `protocol/remote/routes.ts`의 허락 주석(`use-grant`가 문장을 적는다), `approval.md`의 허락 문장(`use-grant`가 문장을 적는다), `REMOTE_PROTOCOL_VERSION` 5(`use-contract`가 올리고 `use-grant`는 그 5에 얹는다). wave 2에서 `use-receive`가 `call_test.ts`와 `wiring/remote.ts`에 맞추는 `kind` 한 줄, `use-send`가 `wiring/apps.ts`의 forward 자리.
- `use-contract`에서 SDK와 손 사본 부분을 `use-contract-sdk`로 뗐다. 둘이 같은 모양(`remote` caller, event의 `machine`, broker 본문의 `machine?`)을 각 brief에 적었으니 바꿀 때 두 brief를 같이 고친다.
- `use-grant`: 한 초대장으로 두 방향이 서도록 합류하는 컴퓨터가 초대한 컴퓨터를 허락한다(`roster/join`·합류 화면·`lophn remote join`의 `terminal_input`, 기본 켬). 새 CLI 명령 `remote terminal-input`은 그 밖에 허락을 바꾸는 길이다(화면 없는 컴퓨터 포함).
- `multi-device-fixes`가 둔 test "CLI의 사람 token으로 machines/call을 부르지 못하고 shell main의 capability는 다른 기계로 가지 않는다"(`call_test.ts`)는 이 계획이 대신한다: 사람의 터미널은 "터미널"로 실려 부르게 되고, 그 요청이 사람의 route와 자동 확인을 받지 못하는 것을 새 test가 본다(`use-send`).
- 다른 기계로 보낸 긴 command가 연결의 한도(같이 도는 call 8개, call 하나 120초)에 걸리는 것은 알려진 미완이다. 걸리면 이슈로 올린다.
- SDK와 앱 지침을 바꾸는 task는 `sdk-note` skill을 따른다. 화면 task는 `ui-design` skill대로 wireframe을 먼저 고친다.
- 실제 relay와 실제 provider를 쓰지 않는다. subprocess를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- 끝나면: `architecture/app-call.md`, `agent-call.md`, `approval.md`, `event.md`, `job.md`, `remote.md`, flows, change-log, roadmap `multi-device.md`. 이슈 `roster-computer-self-grants-terminal-input`을 닫는다.
- 사람에게: 끝난 뒤 컴퓨터 둘로 확인을 부탁한다(한 컴퓨터의 agent가 다른 컴퓨터의 앱 command를 부르고, 그 앱의 event로 job이 돈다. 화면 없는 컴퓨터가 끼면 그 컴퓨터에서 허락을 켜는 법도 본다).
