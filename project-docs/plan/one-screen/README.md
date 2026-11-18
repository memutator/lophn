# one-screen

- 목표: 사람이 지금 앉은 기계의 창 하나, 폰의 목록 하나에서 내 모든 기계의 것을 본다. 다른 기계의 대화, coding agent, 터미널, 앱 화면, agent의 browser page가 내 것과 같은 목록에 기계 꼬리표를 달고 보이고, 그 자리에서 열어 이어서 시킨다. 기계 하나에 창 하나이던 것을 없앤다.
- 재료: `project-docs/products/roadmap/multi-device.md`("어떻게 보이나", "가리키는 법"), `project-docs/architecture/remote.md`("desktop에서 다른 기계 보기"), `project-identity.md`("다른 기계의 창"), `workspace-layout.md`, `terminal-agent.md`, `phone-screen.md`, `attention.md`, 조사 `reports/multi-device/survey-n1-one-screen.md`(지금 code, file 묶음 G1~G11, 부록 넷), review `reports/multi-device/review-core-terminals.md`("Facts the next plans build on")
- 기대는 것: `multi-device-fixes`(터미널 입력 자격, `machines/*`의 자격), `core-browser`(page를 멀리서 보는 route. `screen-pages`만 기다린다)
- 범위 밖: agent와 앱이 다른 기계를 부르기(`remote-use`), session의 기록을 맞추기(하지 않는다), 여러 기계의 Home을 하나로 합치기(하지 않는다), 다른 기계의 file을 여는 editor와 file tree, 다른 기계의 사람 browser 탭·artifact·DevTools, 다른 기계의 project 설정과 앱 상세 화면

## 정한 것

화면의 바닥:
- **화면은 "어느 기계"를 고르는 층 하나를 거친다.** 화면의 code가 core를 읽고 부르는 모양은 그대로 두고, 그 앞에 기계를 고르는 범위를 둔다. 범위 안의 읽기, 부르기, event는 그 기계로 간다. 목록의 줄과 탭이 자기 기계의 범위 안에서 그려진다. 지금 49개 file이 한 자리에서 core를 받으므로 그 자리에서 고른다(호출마다 기계를 넘기지 않는다). (agent: 화면 code를 기계마다 갈라 쓰지 않는다)
- **창은 기계에 묶이지 않는다.** 창을 만들 때 정하던 "다른 기계의 창" 표시와 그 갈래(창 하나에 약 26곳), 기계마다의 창과 창 자리 기억, 시작할 때 여는 기계를 없앤다. shell main은 화면이 준 기계로 `machines/call`·`machines/watch`를 고른다. (사람: "내 머신에서도 보고 싶으니까 remote를 하는 게 아니겠어")
- **다른 기계의 event는 보는 것마다 따로 구독한다.** 지금 기계 하나에 구독 목록 하나를 통째로 갈아 끼우는 것을, core가 구독자들의 합을 보내는 것으로 바꾼다. 창이 여럿이어도, 뒤에 core 안의 구독자가 생겨도(`remote-use`) 서로 덮지 않는다. (agent)
- **권한은 받는 기계가 본다.** 화면이 숨기는 것으로 막지 않는다. 기기 route 목록에 없는 것은 받는 기계가 거절하고 화면은 그 까닭을 보인다. (agent)

목록:
- **같은 project는 한 묶음이다.** 정체(`pri_`)가 같은 project는 한 줄이고 그 안의 session, coding agent, 터미널에 기계 꼬리표가 붙는다. 이 기계에 없는 project도 줄로 보인다(가져오기는 지금의 Clone here). (사람의 roadmap)
- **Home은 기계마다 따로다.** "Home · 기계 이름"으로 줄이 따로 선다. (사람: "home도 따로 두는 게 맞을 듯")
- **같은 앱은 한 줄이다.** 앱 id는 이미 기계를 건넌다. 여는 화면은 이 기계에 그 앱이 있으면 이 기계의 것, 없으면 가진 기계의 것이고 꼬리표로 보인다. 그 앱 workspace의 session은 기계 꼬리표를 단다. (agent)
- **꺼진 기계의 줄은 꺼짐으로 남는다.** 이름과 마지막으로 본 목록은 보이고 열 수 없다. 나머지 기계는 그대로다. (agent)
- **git이 아닌 project를 잇는다.** "이 project는 저 기계의 그 project와 같다"를 사람이 고르면 그 정체를 이 기계의 project에 적는다. git project는 지금처럼 저장소의 file이 정한다. (agent: `project-address`가 이 화면을 이 계획에 넘겼다)
- **정체가 바뀌어도 앱의 data가 주인을 잃지 않는다.** 잇기, 새 정체 만들기, 저장소 file의 정체가 lophn이 만든 정체를 덮는 것 모두 바뀌기 전의 정체를 project에 남기고 앱에 같이 준다. 앱은 옛 정체로 붙인 줄을 옮긴다(SDK 지침). (agent: review가 짚은 것. 앱이 `pri_`로 저장한 뒤로는 정체가 바뀌면 그 data가 떨어진다)

열리는 것:
- **대화**: 지금 그대로다(이미 열린다).
- **터미널과 coding agent**: desktop의 터미널 그대로 그린다. 다른 기계의 터미널을 보고 닫고 크기를 맞추는 route와 그 event를 기기 목록에 더한다. 보기는 내 기기 모두, 치기와 닫기와 다시 시작은 터미널 입력 허락이 있어야 한다(`multi-device-fixes`가 맞춘 선). 날 출력이 연결을 넘쳐 다른 event를 떨어뜨리지 않아야 한다: `screen-terminals`가 먼저 재 보고, 안 되면 폰처럼 화면 사본으로 그린다. (agent)
- **앱 화면**: 그 기계의 core가 주는 화면 file을 받아 이 기계의 창이 그리고, 앱에 시키는 것은 그 기계로 간다. 격리 자리(partition)에 기계가 든다(같은 앱 id라도 기계가 다르면 저장소가 섞이지 않는다). 폰이 이미 같은 길로 화면을 받는다. (사람의 roadmap)
- **agent의 browser page**: `core-browser`의 page 보기를 탭으로 연다. (사람의 roadmap)
- 그 밖의 탭 종류(문서 editor, 사람 browser 탭, artifact, project 설정, 앱 상세)는 지금처럼 이 컴퓨터의 것만 연다.

저장과 알림:
- **탭은 자기 기계를 기억한다.** layout에 다른 기계의 탭이 저장되고, 그 기계가 꺼져 있으면 탭은 꺼짐으로 보이다가 붙으면 이어진다. 이 기계에 없는 project의 layout은 기계와 함께 key한다. layout file의 판을 올리고 옮기는 step을 둔다. 창 자리와 시작 기계 file(`shell/viewer/`)은 지운다. (agent)
- **Inbox와 알림은 한데 모인다.** 다른 기계의 승인 대기와 끝난 turn이 같은 Inbox에 꼬리표를 달고 뜬다. 읽음과 "보고 있음"은 지금처럼 그 기계에 알린다. (agent)
- **Settings는 기계를 골라 연다.** `core-setup`이 다른 기계의 창에 연 Settings 항목은 Settings 안에서 기계를 고르는 것으로 옮긴다. (agent)

폰:
- **목록 하나에 모든 컴퓨터의 session이 보인다.** "컴퓨터 고르기"는 꼬리표와 거르기가 된다. 폰은 이미 컴퓨터마다 연결과 data 묶음을 따로 든다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `screen-base-core` | 없음 | IPC의 기계 칸, shell main이 기계로 길을 고르기, core의 구독을 구독자들의 합으로 |
| 1 | `screen-base-scope` | 없음 | 화면이 기계를 고르는 범위(읽기·부르기·event), 창에 박힌 기계 갈래를 범위로 바꾸기, 탭과 목록 줄이 기계를 드는 type. `architecture/remote.md` 초안 |
| 1 | `screen-link` | 없음 | git이 아닌 project를 다른 기계의 project와 잇는 route와 dialog, 바뀌기 전의 정체를 남겨 앱에 주기(SDK) |
| 2 | `screen-lists` | `screen-base-core`, `screen-base-scope` | 한 창의 목록: project를 정체로 묶기, Home은 기계마다, 앱은 한 줄, 기계 꼬리표, 꺼짐. 잇기 dialog를 줄에 붙인다 |
| 2 | `screen-terminals` | `screen-base-core`, `screen-base-scope` | 다른 기계의 터미널과 coding agent 탭: 기기 route와 event 더하기, 날 출력 재 보기, 받는 쪽의 자격 |
| 2 | `screen-apps` | `screen-base-core`, `screen-base-scope` | 다른 기계의 앱 화면: 화면 file과 앱 호출이 그 기계로, partition에 기계 |
| 2 | `screen-phone` | `screen-base-core`, `screen-base-scope` | 폰: 모든 컴퓨터의 session을 한 목록에, 꼬리표와 거르기 |
| 3 | `screen-windows` | `screen-lists` | 기계마다의 창과 그것만을 위한 code, 창 자리·시작 기계 file 지우기 |
| 3 | `screen-layout` | `screen-lists`, `screen-terminals`, `screen-apps` | 다른 기계의 탭을 layout에 저장, 꺼진 기계의 탭, 옮기는 step |
| 3 | `screen-inbox` | `screen-lists` | Inbox와 알림을 기계를 건너 모으기, Settings에서 기계 고르기 |
| 3 | `screen-pages` | `screen-lists` | agent의 browser page를 탭으로(`core-browser`가 main에 올라간 뒤) |
| 3 | `screen-rest` | `screen-lists`, `screen-terminals`, `screen-apps` | `screen-lists`가 남긴 목록 쪽 일: 다른 기계의 터미널·coding agent 줄, 바뀐 session 이름 따라오기, palette, 기계 꼬리표를 칩 하나로 |
| 4 | `screen-cleanup` | `screen-windows`, `screen-layout`, `screen-inbox`, `screen-pages`, `screen-phone`, `screen-link` | 남은 "이 컴퓨터에서만" 갈래와 옛 이름, flows·catalog, 문서 |

`screen-base-core`와 `screen-base-scope`는 같은 계약(둘의 brief 맨 위에 같은 글로 있다)을 두고 같이 돈다. 큰 file 둘(`workspace-window.tsx`, `entry.tsx`)은 wave 1에서 `screen-base-scope`가, wave 2에서 `screen-lists`가 갖는다. 다른 task는 그 file을 고치지 않고 고칠 줄을 보고에 적는다.

## 위험 test (brief에 있다)

- 한 기계의 범위에서 부른 것이 다른 기계로 가지 않는다(특히 쓰는 호출: 보내기, 승인, 터미널 입력).
- 터미널 입력 허락이 없는 컴퓨터는 다른 기계의 터미널에 치지 못하고, 받는 기계가 거절한다.
- 같은 앱 id의 화면이 기계가 다르면 저장소(cookie, storage)를 같이 쓰지 않는다.
- layout을 옮긴 뒤 이 컴퓨터의 탭이 그대로 열린다.
- 두 구독자가 같은 기계를 볼 때 한쪽이 그만 봐도 다른 쪽의 event가 끊기지 않는다.
- 잇기는 git project의 정체를 바꾸지 못한다.
- 잇기나 새 정체 만들기로 정체가 바뀐 뒤 앱이 옛 정체를 받는다.

## lead가 할 일

- `multi-device-fixes`가 main에 올라간 뒤에 시작한다. 이 계획은 중간에 land하지 않는다(wave 3 안에서 기계마다의 창을 지우는 동안 다른 기계의 Settings와 "보고 있음" 알리기가 잠깐 빠진다).
- `screen-link`는 SDK와 앱 지침을 바꾼다. `sdk-note` skill을 따른다. `screen-pages`는 `core-browser`가 올라간 뒤에 띄우고 그 brief의 "시작 전에 다시 볼 것"을 그때의 code와 댄다.
- 띄우기 전에 계약 commit 하나를 한다: `packages/shell/ipc/{core,core-api,machines,secret-input}.ts`에 기계 칸을 더한다(모양은 두 base brief 맨 위의 같은 글에 있다). 이 file들은 두 base task가 다 기대서 어느 쪽도 갖지 않는다.
- merge 뒤에 lead가 붙이는 줄이 있다(brief의 "넘길 줄"): wave 1의 `screen-link`가 `workspace-window.tsx`에 넘기는 한 줄, wave 3의 `screen-pages`가 같은 file에 넘기는 줄, `screen-inbox`의 flows 줄.
- `screen-link`는 크다(약 50개 file. 대부분 칸 하나를 앱까지 나르는 일이다). 한 session에 안 끝나면 "잇기와 정체 남기기"와 "옛 정체를 앱까지 나르기와 SDK"로 쪼갠다.
- 화면 task는 `ui-design` skill대로 wireframe을 먼저 고친다. 목록의 꼬리표와 묶음은 본보기가 없다: `screen-lists`가 gallery에 먼저 그리고 merge하기 전에 사람에게 보인다.
- `carry-paths`가 같은 `packages/core/remote/links.ts`와 `packages/protocol/remote/allowlist.ts`를 고친다. `status.py ready`가 거르는 대로 따르고, 나중에 올리는 쪽이 rebase 충돌을 푼다.
- `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다. 실제 Electron에서 한 번 돌려 본다(wave 2가 끝났을 때: 가짜 둘째 기계로 목록과 터미널).
- subprocess나 browser를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다. 실제 relay에 붙지 않는다.
- 끝나면: `architecture/remote.md`("다른 기계 보기"를 새 모양으로), `workspace-layout.md`, `project-identity.md`, `phone-screen.md`, `attention.md`, PRODUCT.md의 "desktop은 그 기계의 앱 화면을 보이지 않는다", flows, change-log, roadmap `multi-device.md`.
- 사람에게: 끝난 뒤 컴퓨터 둘과 폰으로 확인을 부탁한다.
