# core-browser

- 목표: 화면 없는 기계에서 agent가 browser를 쓴다(core가 화면 없는 browser를 띄운다). agent의 page를 사람의 다른 기기에서 열어 보고 끼어든다(화면 있는 기계의 page도 같다).
- 재료: `project-docs/products/roadmap/shell-as-client.md`("browser"), `project-docs/architecture/browser-tab.md`("agent가 다루는 탭"), `workspace-layout.md`("agent가 연 탭"), `platform.md`(launch intent, core 수명), `remote.md`, roadmap `agent-browser-lifetime.md`(그때 "하지 않는다"로 둔 D와 screencast를 이 계획이 연다), 조사 `reports/multi-device/survey-s5-browser.md`, spike `reports/multi-device/spike-headless-browser.md`(실제로 돌려 본 것)
- 범위 밖: 화면 있는 기계에서 agent page를 화면 없는 browser로 돌리기(사람의 로그인과 갈린다), 사람이 연 browser 탭과 앱 화면·artifact를 멀리서 보기, 다른 기계의 page를 내 목록에 섞어 보이기(`one-screen`), 폰의 앱 화면을 다루는 길(지금 그대로), 소리와 file 올리고 내리기, macOS·Windows의 화면 없는 길

## 정한 것

spike로 확인한 것 위에 선다: display 없는 Linux에서 Electron은 `--ozone-platform=headless`로 뜨고, page는 offscreen 창이어야 그린다. 그 page에서 screenshot, AX tree, click, 입력, 크기 emulation, 남는 cookie가 다 된다. CDP screencast는 offscreen page와 보이는 창의 `<webview>`(구석에 세워 둔 것 포함) 둘 다에서 frame을 낸다. 창이 최소화되거나 숨겨지면 frame이 멈춘다.

화면 없는 browser:
- **page를 주는 쪽은 같은 link의 host다.** core는 지금처럼 link 건너편 host에 탭 열기와 `browser.*`를 시킨다. 화면 있는 기계에서는 그 host가 desktop 앱이고, display가 없는 기계에서는 core가 띄운 "page host"다. page host는 같은 Electron binary를 창 없이 띄운 것이고 탭마다 offscreen page 하나를 든다. core 쪽에 provider를 새로 만들지 않는다. (agent: driver와 link가 이미 host를 가리지 않는다)
- **driver는 하나다.** page host는 desktop 앱이 쓰는 CDP driver를 그대로 쓴다. 다른 것은 "탭의 page를 어떻게 찾나" 하나다(화면이 알려 주던 것을 page host는 스스로 만든다). (agent)
- **어느 쪽인지는 lophn이 고른다.** display가 있으면 지금 그대로다(창이 없으면 창을, 앱이 없으면 앱을 띄운다). display가 없는 Linux에서만 page host를 띄운다. 한 기계에서 둘이 같이 돌지 않는다. agent에게는 같은 tool이다. (사람: "core에서 headless로 브라우저를 열 수 있게하는 길 하나만")
- **browser profile은 하나다.** page host는 desktop 앱과 같은 profile 자리를 쓴다. 화면 없는 기계에서 사람이 멀리서 한 로그인이 남고, 나중에 그 기계에 화면이 생겨도 이어진다. site login vault도 그대로 쓴다. (agent)
- **page의 크기는 정해 준다.** offscreen page는 처음 크기가 없어 만들자마자 기본 크기를 준다. page 수의 상한은 지금 창 하나의 상한과 같다. (agent: spike)

멀리서 보기:
- **터미널 보기와 같은 모양이다.** 보는 쪽이 lease를 잡으면 host가 그 page의 frame을 밀고, core는 마지막 frame만 들고, 내용 없는 event가 나면 보는 쪽이 읽어 간다. 보는 쪽이 없으면 frame을 만들지 않는다. 느린 연결에서는 읽어 간 만큼만 다음 frame이 간다. (사람: "기반은 다 있을 거 아니야")
- **대상은 core가 아는 browser 탭이다.** agent가 연 탭과, 사람이 그 기계에 열라고 시킨 탭이다. 화면 없는 기계의 로그인은 사람이 탭을 열고 멀리서 보며 직접 한다. (agent)
- **보는 것은 내 기기 모두, 다루는 것은 터미널 입력을 허락받은 기기다.** 로그인된 browser를 다루는 것은 터미널에 치는 것만큼 센 권한이다. agent 자격은 이 길을 쓰지 못한다. (agent: `core-setup`과 같은 선)
- **끼어들면 agent가 멈춘다.** 지금의 take control과 같다. 멀리서 잡아도 agent의 쓰기 동작이 `conflict`로 막히고, 놓으면 풀린다. 그 기계의 화면에도 잡혀 있음이 보인다. (agent)
- **멀리서 하는 것**: pointer, 글자와 key, scroll, 주소로 가기, 뒤로, 다시 읽기. (agent)
- **그리지 않는 page는 그렇다고 보인다.** 화면 있는 기계의 창이 최소화되거나 숨겨져 있으면 frame이 없다. 보는 쪽에 그 이유를 보인다(지금 screenshot이 같은 이유로 실패한다). (agent: spike)
- **보는 화면은 둘이다.** 폰 앱의 화면 하나와, desktop의 다른 기계 창에서 여는 탭 하나. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `page-contract` | 없음 | protocol: host에 시키는 것(frame 켜고 끄기, 입력, 잡기)과 host가 미는 frame, `page_view/*` route, event, 기기 목록에 더할 것. `architecture/browser-tab.md` 초안 |
| 2 | `page-view-core` | `page-contract` | core: lease, 마지막 frame, `page_view/*` route, event, 입력 자격, 사람이 탭을 여는 길 |
| 2 | `page-stream` | `page-contract` | desktop 앱의 host 쪽: page의 screencast 켜고 끄기, 입력 넣기, 멀리서 잡기를 take control에 잇기, 그리지 않는 상태 알리기 |
| 3 | `page-host` | `page-stream` | 창 없는 page host: offscreen page, 탭과 page 잇기, 같은 driver와 stream, core가 display 없을 때 띄우기, profile, 화면 없다는 옛 오류 문장 고치기 |
| 3 | `page-view-phone` | `page-view-core` | 폰 앱: page 보기 화면(그림, 손가락과 keyboard, 주소·뒤로·다시 읽기, 잡기) |
| 3 | `page-view-desktop` | `page-view-core` | desktop의 다른 기계 창: page 보기 탭 |

## 위험 test (brief에 있다)

- agent 자격과 터미널 입력 허락이 없는 기기는 page에 입력하지 못한다.
- 남의 탭(다른 session이 연 탭)의 frame은 agent 자격으로 읽지 못한다.
- 멀리서 잡은 동안 agent의 쓰기 동작이 `conflict`다.
- 보는 쪽이 없으면 host가 frame을 만들지 않는다(lease가 끝나면 꺼진다).
- display가 있는 기계에서는 page host를 띄우지 않는다.

## lead가 할 일

- `core-terminals`가 같은 link와 host queue file을 고친다. 이 계획의 core 쪽 task(`page-view-core`)와 `page-host`는 `core-terminals`의 `coding-core`가 merge된 뒤에 띄운다. `page-view-desktop`은 `device-roster`의 `roster-desktop`이 merge된 뒤에 띄운다.
- `page-host`가 끝나면 display 없는 환경을 흉내 내어 한 번 돌려 본다(`env -u DISPLAY -u WAYLAND_DISPLAY`로 core를 띄워 `lophn tab open --url`, `lophn browser snapshot`, `screenshot`). spike의 script(`.dev-data/spike-browser/`)가 본보기다.
- browser를 띄우는 test와 E2E는 새로 만들기 전에 사람에게 묻는다.
- `packages/mobile`을 고친 task는 그 폴더의 typecheck와 test도 통과해야 한다. 화면 task는 `ui-design` skill대로 wireframe을 먼저 고친다.
- 끝나면: `architecture/browser-tab.md`, `workspace-layout.md`, `platform.md`, `remote.md`, roadmap `agent-browser-lifetime.md`의 D와 "하지 않는 것", flows, change-log, roadmap `shell-as-client.md`.
- 사람에게: 실제 화면 없는 VM에서의 확인을 부탁한다(Electron이 뜨는 데 필요한 library가 최소 server image에 있는지는 spike가 보지 못했다). Wayland에서 창을 최소화했다 되돌리면 page가 다시 그리지 않는 것을 spike가 봤다. 지금 제품에서도 같은지 확인해 이슈로 올린다.
