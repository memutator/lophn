# core-setup

- 목표: 한 기계의 처음 설정(secret 넣기, provider 연결과 로그인, 기본 model, project 더하기, 그 밖의 Settings)을 그 기계의 창 없이 사람의 다른 기기에서 한다. 순서를 쥐고 있던 화면의 code를 core의 route로 옮겨 모든 화면이 같은 route를 부른다.
- 재료: `project-docs/products/roadmap/shell-as-client.md`, `project-docs/architecture/agent-definition.md`(secret 저장소), `approval.md`, `remote.md`, `project-identity.md`, roadmap `secret-request.md`(끝남), 조사 `reports/multi-device/survey-s4-setup-tabs.md`(지금 code, file 묶음 G1~G10)
- 범위 밖: remote 켜기와 pairing의 CLI(`device-roster`), 화면 없는 기계에서 browser가 필요한 로그인(`core-browser`의 멀리서 보기로 한다), agent가 닿는 CLI에 secret 넣기나 provider 연결을 열기, 폰에 Settings 전체를 짓기, site login vault의 값을 기기에서 넣기

## 정한 것

- **값은 그 기계의 core로만 간다.** 사람의 기기에서 넣은 secret은 그 기계와 맺은 암호화된 연결로 core에 바로 간다. relay와 다른 기계는 읽지 못한다. 넣는 칸은 그 기기의 보호된 입력이다(desktop은 지금의 보호 입력 창, 폰은 native 입력). 값은 화면의 state, log, event, 대화에 남지 않는다(지금 규칙 그대로). (agent: 사람의 roadmap)
- **설정을 하는 기기는 터미널 입력을 허락받은 기기다.** 터미널에 칠 수 있는 기기는 이미 그 기계를 온전히 다룬다. 그래서 허락을 하나 더 만들지 않고, 그 허락이 있는 기기에 사람의 route(secret, provider, 설정 쓰기, agent·project 만들고 고치기)를 연다. 허락이 없는 기기는 지금의 목록 그대로다. 기기·pairing·명단 관리, 터미널 입력 허락 바꾸기, site login vault는 허락이 있어도 열지 않는다. (agent: 사람 "기존의 approval이랑 크게 다를 게 없다")
- **사람이 확인했다는 표.** 확인이 필요한 명령(provider 끊기 같은 것)은 지금 그 기계의 shell main만 통과한다. 허락받은 기기에서 온 것도 사람이 한 것으로 본다(기기 자격은 agent가 얻을 수 없다). agent와 CLI에는 열지 않는다. (agent)
- **순서는 core의 route 하나가 쥔다.** provider 연결(id 만들기, 값 넣기, 충돌 확인, 연결)과 project 더하기(id와 slug 만들기, 충돌이면 다시)는 지금 desktop 화면의 code에 있고 shell main에 사본이 하나 더 있다. core의 route 하나로 옮기고 desktop Settings, agent가 청한 입력 card, 폰, 다른 기계의 창이 그것을 부른다. 화면과 shell main의 사본은 지운다. (agent)
- **구독 로그인의 기다림도 core가 한다.** 화면이 돌리던 poll을 core로 옮긴다. 화면은 상태를 읽고 보일 것(주소, 코드)을 보인다. 화면이 부르던 옛 route(`providers/login-begin`, `login-complete`)는 지우고, 그것을 쓰던 e2e는 새 route로 다시 쓴다. (agent)
- **폴더는 그 기계의 것을 고른다.** 다른 기기에서 project를 더할 때는 그 기계의 폴더 목록을 읽어 고른다(읽는 범위는 사람의 home 아래). OS의 폴더 고르기 창은 그 기계의 화면에서만 쓴다. (agent)
- **화면은 둘이다.** desktop의 다른 기계 창에는 그 기계의 core에 걸린 Settings(General, Providers, Agents, Tools, Shell rules, Diagnostics)와 project 더하기를 연다(화면 code가 이미 있고 막아 둔 것을 푼다). 이 컴퓨터의 shell이나 OS에 걸린 pane(Appearance, Browser, Keyboard 같은 것)은 열지 않고 한 줄로 알린다. 폰에는 꼭 필요한 것만 짓는다: agent가 청한 secret·입력 card에 답하기, provider 연결(API key와 device code). 폰의 "컴퓨터에서 하세요"는 폰이 이제 할 수 있는 것에서만 지운다(site login, loopback 로그인, 앱과 MCP의 OAuth에는 남는다). (agent: 폰에 Settings 전체를 짓는 값이 크고, 화면 없는 기계는 다른 컴퓨터에서 설정하는 것으로 충분하다)
- **화면 없는 기계의 loopback 로그인.** ChatGPT, Claude, Antigravity 로그인은 그 기계의 browser로 돌아와야 한다. 이 계획은 고치지 않는다. API key와 device code는 된다. browser가 필요한 로그인은 `core-browser`가 끝나면 그 기계의 화면 없는 browser를 멀리서 보며 한다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `setup-provider` | 없음 | provider 연결·끊기·로그인·기본 model의 순서를 core route로. desktop Settings와 shell main의 입력 card가 그것을 쓰고 사본을 지운다 |
| 1 | `setup-project` | 없음 | project 더하기를 core route 하나로(id·slug·충돌), 그 기계의 폴더 목록 읽기. desktop의 등록 dialog가 그것을 쓴다 |
| 1 | `setup-scope` | 없음 | 터미널 입력을 허락받은 기기에 사람의 route를 연다(목록을 둘로), 기기에서 온 secret upload, 확인이 필요한 명령 |
| 2 | `setup-viewer` | `setup-provider`, `setup-project`, `setup-scope` | desktop의 다른 기계 창: Settings와 project 더하기를 열고, 보호 입력 창의 값이 그 기계로 간다 |
| 2 | `setup-phone` | `setup-provider`, `setup-scope` | 폰 앱: secret·입력 card에 답하기, provider 연결 화면 |

`setup-scope`는 `device-roster`의 `roster-core`와 같은 file(`packages/core/remote/call.ts`, `packages/protocol/remote/allowlist.ts`)을 고치고, 다른 컴퓨터가 넘긴 call을 받는 길(`roster-links`)이 같은 거르기를 타는지 봐야 한다. `roster-links`가 merge된 뒤에 띄운다. `setup-viewer`는 `device-roster`의 `roster-desktop`이 merge된 뒤에 띄운다(다른 기계 창이 붙는 길이 바뀐다).

## 위험 test (brief에 있다)

- 터미널 입력 허락이 없는 기기는 secret, provider, 설정 쓰기 route를 부르지 못한다.
- agent 자격은 기기의 길로도 secret을 넣거나 확인이 필요한 명령을 통과하지 못한다.
- 기기에서 넣은 값이 event, log, ledger의 명령 기록에 없다.
- provider 연결이 중간에 실패하면 임시 secret이 남지 않는다.
- 폴더 목록 읽기가 정한 범위 밖을 읽지 못한다.

## lead가 할 일

- `packages/protocol/remote/allowlist.ts`와 `packages/core/main/daemon/wiring/`의 등록 줄은 lead가 합친다.
- 실제 provider를 부르지 않는다(개발은 `npm run dev`의 fake). 실제 로그인 확인은 끝난 뒤 사람에게 부탁한다.
- `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다.
- 화면을 바꾸는 task(`setup-viewer`, `setup-phone`)는 `ui-design` skill대로 wireframe을 먼저 고친다.
- 끝나면: `architecture/agent-definition.md`(secret이 들어오는 길), `approval.md`(기기의 범위, 확인), `remote.md`, flows, change-log, roadmap `shell-as-client.md`.
- 사람에게: 끝난 뒤 실제로 확인을 부탁한다(폰에서 agent의 secret 요청에 답하기, 다른 컴퓨터의 창에서 provider 연결).
