# mobile-push: 폰이 사람을 기다리는 일을 알리고, 누구에게 알릴지 core가 정한다

- 목표: core가 "사람이 지금 무엇을 보고 있나"를 host(desktop, 폰)의 보고로 알고, 사람을 기다리는 일(승인, 질문, 동의, job hold), 오래 돈 turn의 끝, 앱의 `notify()`가 생기면 보고 있지 않은 폰에 Expo Push를 직접 보낸다. `unseen` 점도 core가 든다(폰에서 읽으면 desktop 점도 꺼진다). 폰은 알림 허락을 묻고, Settings › Notifications로 고르고, 알림을 누르면 그 session으로 간다. 실제 배달은 사람의 Expo·Firebase 계정이 있어야 해서 마지막에 사람이 하고, 그 전까지는 모두 fake push server로 확인한다.
- 재료: `project-docs/products/roadmap/mobile.md`("알림과 push", 단계 4), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/push-survey.md`, `project-docs/architecture/{app-notice,remote,terminal-agent,event}.md`, wireframe `tools/wireframes/drafts/phone/{start.tsx(Paired), more.tsx(Notifications), inbox.tsx(Lock)}`(그림 `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/`), 실행 중인 계획 `phone-app`(폰 앱을 native로 다시 짓는다. 이 계획의 폰 task는 그것이 main에 올라간 뒤에 선다).
- 범위 밖: iOS(APNs, Apple 계정), 암호화한 push(native 확장이 글을 푸는 길), 폰의 알림 목록 화면, 코딩 agent session을 폰에서 여는 화면(단계 5. 터미널 session의 push는 가지만 누르면 Inbox로 간다), 알림 묶기·지연 같은 다듬기, lophn gateway.
- 단위: `mobile-attention`(core의 "주의" 모양: 보고, 알릴 자리와 대상, `unseen`, desktop 쪽 보고), `mobile-push`(보내는 길, 기기의 token·설정, 폰 화면). 소유 path는 brief가 정한다.
- 순서:
  - wave 1: `mobile-attention-core`와 `mobile-push-send`를 나란히. 둘은 서로 기대지 않고(결합은 brief에 적은 type 모양뿐), 지금 돌고 있는 `phone-app`과도 path가 겹치지 않아 지금 띄울 수 있다.
  - wave 2: `mobile-attention-desktop`. shell main이 보고하고 `unseen`을 core에서 읽는다. `phone-app`과 path가 겹치지 않는다.
  - wave 3: `mobile-push-device`, 이어서 `mobile-push-phone`. **둘 다 `phone-app`이 main에 올라간 뒤에 띄운다.** `mobile-push-device`가 `packages/core/remote/**`와 폰 allowlist를, `mobile-push-phone`이 폰 앱(`packages/mobile`)의 Paired·Settings 화면과 native build를 고치는데, 모두 `phone-app`이 쓰는 path다. `phone-app`이 land되기 전에는 wave 3를 띄우지 않는다.
  - land는 계획 끝에 한 번. 그 뒤 사람이 계정을 만들어 실제 배달을 확인한다("사람이 할 것").

## 정한 것

- 배달은 Expo Push를 core가 직접 부른다. lophn이 gateway(`packages/relay` 옆의 service)를 돌리면 service 하나와 FCM key를 lophn이 쥐어야 하는데, 어차피 글은 평문이라 privacy를 얻는 것이 없다(planner).
- push 글에는 session 제목과 상태 한 문장만 싣고 대화 내용이나 명령은 싣지 않는다. 폰에 스위치 하나 "Show session names"(기본 켜짐)가 있고 끄면 글이 "An agent needs you" 같은 일반 문장이 된다. 글에 컴퓨터 이름을 넣지 않는다(첫 판. QR에 이름이 없다). session 제목은 대화에서 나온 글이라 켜져 있으면 제목이 Expo와 Google을 평문으로 지난다. 스위치 부제에 그렇게 쓴다(planner).
- 알림 설정은 폰 하나에 있고 pairing한 모든 컴퓨터에 사본으로 보낸다. 컴퓨터마다 따로 두면 화면이 늘고 폰 하나가 컴퓨터 둘에서 다르게 울릴 이유가 없다(planner).
- 보고 있는 동안은 push를 보내지 않는다. desktop은 창 focus와 마지막 입력 뒤 시간(`powerMonitor.getSystemIdleTime()`)을, 폰은 앱이 앞에 있는지를 보고한다. `unseen`은 core에 둔다(planner, roadmap).
- 실제 Expo endpoint를 개발과 test에서 부르지 않는다. endpoint가 locked 설정 `remote.push`이고, `npm run dev`·`dev:core`는 fake push server를 띄워 거기를 가리키고, test용 `bootCore`는 비워 push를 끈다(planner).
- 실제 배달에는 사람의 Expo·Firebase 계정이 든다. 그 전까지는 만들 수 있는 것을 모두 짓고 fake로 확인한다. 계정 일은 맨 뒤에 사람이 한다(planner).
- 터미널 coding agent의 대기·끝은 core가 `report` 변화를 비교해 알아내지 않는다. shell main tracker가 이미 있는 debounce(1.5초) 뒤에 새 route `terminal_sessions/signal`로 알린다(survey 그대로).
- survey보다 줄인 것(agent): presence의 `looking`은 session 참조 목록(`ses_…` 또는 터미널은 `term:<탭>`)뿐이다. 앱 화면과 Inbox는 target으로 두지 않는다. 알릴지는 host 단위(`present`)로만 정하고 target은 `unseen`을 위해서만 쓰는데, `unseen`은 session과 터미널에만 있다. 폰은 `unseen/*`를 부르지 않으므로 폰 allowlist에는 `presence/report`와 `devices/set_push`만 더한다.
- push 글은 영어 고정 문장이다(core에 i18n이 없다. 폰 화면 문구는 `@lophn/i18n`). 글 문장표는 `mobile-attention-core` brief에 있다.
- worker는 `sonnet-high`로 띄운다(planner).

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-attention-core` | `presence/report`, `unseen/list·dismiss`, `terminal_sessions/signal`, 알림 계기 규칙과 대상 정하기와 글 만들기, `JobHeld` event. 기기 목록과 보내기는 주입 port |
| 1 | `mobile-push-send` | Expo Push 보내기(ticket, receipt, 죽은 token), `remote.push` 설정, fake push server, dev와 test 연결 |
| 2 | `mobile-attention-desktop` | shell main이 presence를 보고하고 tracker가 signal을 보내고 `unseen`을 core에서 읽는다. main의 `unseen`을 지운다 |
| 3 | `mobile-push-device` | `devices`에 token·설정 열과 `devices/set_push`, 폰 allowlist, 기기가 끊기면 presence 지우기, 위 둘을 wiring으로 잇기 |
| 3 | `mobile-push-phone` | `expo-notifications`, 채널, Paired의 알림 묻기, Settings › Notifications, token 등록, presence 보고, 알림 눌러 이동 |

## 돌리기 전에

- wave 1은 지금 띄워도 된다(`phone-app`과 path가 겹치지 않는다. 겹칠 수 있는 공유 줄은 brief가 한 줄씩 허락하고 보고하게 했다: `assembly.ts`, `context.ts`, `protocol/mod.ts`, catalog. lead가 `phone-app`·다른 계획의 branch와 합칠 때 두 쪽을 다 남긴다).
- wave 3 전에 lead가 한다: (1) `phone-app`이 main에 올라가 `packages/mobile`이 있는지 확인한다. (2) `packages/design/i18n/catalog/mobile-notifications.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린다(`phone-app`이 한 것과 같은 길). (3) `mobile-push-phone` brief의 "소유"에 Paired 화면 file과 Settings 화면 file의 실제 path를 채운다(`phone-frame` 보고에 있다. 지금은 아직 없어 자리만 두었다).
- 폰 emulator: `mobile-push-phone`만 쓴다. port 5580, Metro 8220. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. 폰 개발의 core는 `npm run dev:core`(fake push server가 같이 뜬다)와 `packages/mobile/README.md`의 pairing 길을 쓴다. 사람의 `~/.lophn`, 실제 relay, 실제 Expo endpoint를 쓰지 않는다.
- fake push server는 폰에 알림을 그리지 못한다(Expo의 일이다). `mobile-push-phone`은 fake가 받은 글을 core에서 확인하고, 폰에서는 같은 `data`를 가진 local 알림으로 누르기 이동을 확인한다.

## 사람이 할 것

실제 배달에만 든다(만드는 데는 필요 없다). 계획이 land된 뒤에 한다.

1. Expo 계정을 만들고 project를 하나 만들어 project id를 받는다(`packages/mobile/app.json`의 `extra.eas.projectId`에 lead가 넣는다).
2. Firebase project를 만들고(Spark, 무료) Android 앱 `dev.lophn.mobile`을 등록한다. `google-services.json`을 `packages/mobile/`에 두고(`android.googleServicesFile`) FCM V1 service account key를 Expo에 올린다(dashboard나 `eas credentials`).
3. 새 dev build를 실제 폰에 깔고 pairing해 알림을 받아 본다(실제 폰에 build 깔기는 사람에게 묻는다). 이 계정은 lophn의 것이라 fork는 자기 것을 만들어야 한다.
4. iOS는 Apple Developer 계정(연 $99)과 APNs key가 필요하고 iOS build와 함께 따로 연다.
5. Expo의 "enhanced push security"(access token)는 켜지 않는다: 열린 build에 token을 실을 수 없다. 대신 폰의 push token을 아는 사람은 그 폰에 push를 보낼 수 있는데, token은 사용자의 core와 Expo에만 있다(받아들인다).

## lead가 할 일

- merge 때마다: `npm run check`. 폰 task(`mobile-push-phone`)는 `cd packages/mobile && npm run typecheck && npm test`도, emulator 그림(`.dev-data/<id>/shots/`)을 wireframe(`Paired`, `Notifications`, `Lock`) 그림과 대조한다.
- 공유 줄(`assembly.ts`, `context.ts`, `protocol/mod.ts`, catalog)은 `mobile-attention-core`가 한 줄씩 더하고 "넘길 줄"에 적는다. 다른 계획의 branch와 합칠 때 두 쪽을 다 남긴다.
- wave 1 뒤: dev(`npm run dev:core`)를 한 번 띄워 fake push server가 뜨고 `remote.push`가 거기를 가리키는지 본다(`mobile-push-send` 보고).
- 끝에(문서는 task가 아니라 lead의 일): `architecture/app-notice.md`("지키는 것" 1의 "`NoticePosted`를 받아 행동하는 core code를 두지 않는다"를, 받는 쪽이 사람뿐이므로 push 보내기는 그 예외라고 고친다. `unseen`과 push 길을 더한다), 새 `architecture/attention.md`(presence, 대상 정하기, `unseen`, 글 규칙), `remote.md`(devices의 push 열, 폰이 부르는 route), `terminal-agent.md`(signal), `boundary-catalog.yaml`·`module-catalog.yaml`(`attention`), `project-docs/flows/`(새 route, 설정, test file. `flows` skill), roadmap `mobile.md` 단계 4, `packages/mobile/README.md`(알림 개발 길), change-log `0.23/mobile-push.yaml`(실제 배달은 계정 뒤라는 것을 적는다), `sdk-note`는 SDK를 건드리지 않아 필요 없다. 계정 일은 위 "사람이 할 것"대로 사람에게 알린다.
