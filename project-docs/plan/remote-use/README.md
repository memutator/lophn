# remote-use

- 목표: agent와 앱이 다른 기계의 앱을 쓰고 그 앱의 event를 받는다. 내 PC의 agent가 VM의 monitoring 앱 command를 부르고, 그 앱이 낸 event로 내 PC의 job이 돈다. 사람은 터미널에서 다른 기계에 명령을 보낸다. workspace의 private 설정이 기계 사이에도 선다.
- 재료: `project-docs/products/roadmap/multi-device.md`("주고받는 것 네 가지"의 remote와 event, "해도 되나", "사람이 정한 것"), `project-docs/architecture/agent-call.md`(call 정책, private), `app-call.md`, `approval.md`, `event.md`, `job.md`, `remote.md`, 조사 `reports/multi-device/survey-n3-remote-use.md`(지금 code, file 묶음 G1~G10, 열린 물음), review `reports/multi-device/review-core-setup.md`("Facts the next plans build on")
- 기대는 것: `multi-device-fixes`(`machines/*`의 자격), `one-screen`(다른 기계의 event를 구독자마다 따로 구독하는 바닥), `carry-paths`(끊긴 동안의 event가 늦게 오는 길)
- 범위 밖: a2a(다른 기계의 agent에게 일을 맡기기, handoff), 꺼진 기계의 것을 쓰기, agent가 다른 기계의 터미널·browser page·file·job을 다루기(사람의 화면은 `one-screen`이 한다), 다른 기계에 job 만들기

## 정한 것

- **대상은 앱의 command와 앱의 event다.** 정해진 동작을 가진 것만 부른다. 다른 기계의 agent에게 판단을 맡기는 것은 a2a다. (사람: remote와 a2a를 나눴다)
- **요청에 누가 시켰는지가 실린다.** 지금 다른 기계로 넘기는 call에는 요청한 쪽이 없고, 받는 기계는 모두를 "그 컴퓨터의 사람"으로 본다. 넘기는 call에 요청한 쪽(사람의 화면, 사람의 터미널, 어느 agent, 어느 앱)을 싣고, 받는 기계는 그것을 기록하고 종류마다 다르게 대한다. 사람의 화면이 아닌 요청은 사람의 route(secret, 설정)와 자동 확인을 받지 못한다. (agent: `core-setup` review의 지적)
- **허락은 부르는 기계에서 본다.** agent가 다른 기계의 앱을 쓰려면 사람이 부르는 기계에서 그 앱을 그 agent에 할당한다(할당에 "어느 기계의"가 붙는다). 할당된 앱의 command는 지금처럼 묻지 않고 돈다(이 기계의 앱도 그렇다. 승인 card는 지금 앱 command에 뜨지 않는다). 호출 기록에는 어느 기계의 누가 불렀는지가 남는다. (사람: "기존의 approval이랑 크게 다를 게 없을 거 같은데")
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
| 1 | `use-contract` | 없음 | 넘기는 call에 싣는 요청한 쪽, 받는 쪽의 새 입구 route와 기록(호출 기록의 새 종류와 ledger step), 할당·trigger·구독에 붙는 기계, 기계 이름 풀기, `--on`. `architecture/app-call.md`·`approval.md` 초안 |
| 2 | `use-receive` | `use-contract` | 받는 기계: 입구 route, 요청한 쪽을 종류마다 대하기, 터미널 입력 허락·private·내놓은 command 검사, 기록 |
| 2 | `use-send` | `use-contract` | 부르는 기계: agent의 tool과 앱의 호출이 다른 기계의 앱으로 가는 길, 할당과 승인, private, 닿지 않을 때 |
| 2 | `use-cli` | `use-contract` | CLI의 `--on`과 기계 이름 풀기, 사람의 터미널에서 다른 기계로 |
| 3 | `use-events` | `use-receive`, `use-send` | 다른 기계의 앱 event 구독: 선언에서 구독 걸기, 이 기계에서 내기, job trigger와 앱의 구독, SDK |
| 3 | `use-screens` | `use-send` | 다른 기계의 앱을 agent에 할당하는 화면, 호출 기록에 "어느 기계의" 보이기 |
| 4 | `use-cleanup` | `use-events`, `use-screens`, `use-cli` | 요청한 쪽 없이 넘기던 옛 길, flows·catalog, 문서 |

## 위험 test (brief에 있다)

- agent나 앱이 요청한 call은 받는 기계에서 사람의 route와 확인이 필요한 명령을 통과하지 못한다(부른 컴퓨터에 허락이 있어도).
- 요청한 쪽을 속여 "사람의 화면"이라고 실어 보낼 수 있는 것은 그 기계의 shell뿐이다(agent와 CLI의 자격으로는 그 값을 싣지 못한다).
- 할당이 없는 agent는 다른 기계의 앱을 부르지 못한다.
- private인 workspace의 agent와 앱은 다른 기계를 부르지 못하고, private인 workspace의 앱은 다른 기계에서 불리지 않는다.
- 터미널 입력 허락이 없는 컴퓨터의 요청은 받는 기계가 앱 command를 돌리지 않는다.
- private인 workspace의 앱 event는 다른 기계의 구독자에게 가지 않는다.
- 호출 기록을 옮긴 뒤 지난 기록이 그대로 읽힌다.

## lead가 할 일

- `one-screen`과 `carry-paths`가 main에 올라간 뒤에 시작한다(같은 연결과 route 목록 file을 고치고, 구독의 바닥이 `one-screen`에 있다). brief는 그 전에 썼다: 띄우기 전에 brief마다 "시작 전에 다시 볼 것"을 그때의 code와 대고 달라진 이름을 고친다.
- 권한 경계를 바꾸는 계획이다. `use-contract`가 끝나면 merge하기 전에 다른 worker(opus)에게 review를 맡긴다. 볼 것: 요청한 쪽을 누가 실을 수 있는가, 받는 기계가 믿는 것과 다시 보는 것, 한 hop을 더 건너 넓어지는 길(A가 B를 거쳐 C).
- `use-contract`는 크다(SDK 판, 손으로 맞춘 caller parser 사본들, ledger step을 한 번에 든다). 한 session에 안 끝나면 SDK와 사본 부분을 wave 1의 둘째 task로 뗀다.
- `multi-device-fixes`가 둔 test "CLI의 사람 token으로 `machines/call`을 부르지 못한다"는 이 계획이 대신한다: 사람의 터미널은 "터미널"로 실려 부르게 되고, 그 요청이 사람의 route와 자동 확인을 받지 못하는 것을 새 test가 본다(`use-send`).
- 다른 기계로 보낸 긴 command가 연결의 한도(같이 도는 call 8개, call 하나 120초)에 걸리는 것은 알려진 미완이다. 걸리면 이슈로 올린다.
- SDK와 앱 지침을 바꾸는 task는 `sdk-note` skill을 따른다. 화면 task는 `ui-design` skill대로 wireframe을 먼저 고친다.
- 실제 relay와 실제 provider를 쓰지 않는다. subprocess를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- 끝나면: `architecture/app-call.md`, `agent-call.md`, `approval.md`, `event.md`, `job.md`, `remote.md`, flows, change-log, roadmap `multi-device.md`.
- 사람에게: 끝난 뒤 컴퓨터 둘로 확인을 부탁한다(한 컴퓨터의 agent가 다른 컴퓨터의 앱 command를 부르고, 그 앱의 event로 job이 도는지).
