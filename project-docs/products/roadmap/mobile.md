# mobile: lophn 모바일 앱과 사용자의 모바일 앱

상태: **설계안.** 2026-11-08 사람이 방향을 냈고 planner가 대화를 정리했다. 2026-11-14 planner가 지금 코드와 remote 비교를 조사해 설계안을 냈다. 2026-11-14 아르곤의 검토 일곱 가지를 반영했다. 사람이 정할 것 다섯이 남았다(아래 "사람이 정할 것"). 설계안과 추천은 planner의 것이고 결정이 아니다. 계획으로 열기 전에 사람이 정한다.
배경 문서: `project-docs/architecture/{platform,app-call,terminal-agent,app-notice,event,approval,acp,harness-gui,browser-tab}.md`, `project-docs/products/roadmap/{agent-surface,tool-extension,standalone-core,app-sdk,screen-sync}.md`. 비교: `../harness-lab/_report/remote-control/`(README와 `omp.md`, `t3code.md`, `open-code.md`, `paseo.md`, `happy.md`, `orca.md`, `mixdog.md`).
browser use(desktop의 browser 탭·앱 preview·기기 emulation)는 계획 `browser-use`가 했다(changelog 0.22.0, `architecture/browser-tab.md`). 실제 폰의 앱을 다루는 것은 이 로드맵에 남는다. 아래 "browser-use와 닿는 곳".
먼저 할 일: 화면 갱신(`roadmap/screen-sync.md`). 폰 화면을 그 공통 읽기 위에 짓는다.

## 사람의 말 (원문)

2026-11-08:

> mobile은 두 가지가 있어
> 1. 우리 lophn 자체 모바일 앱
> 2. lophn에서는 사용자의 앱을 만드는데 사용자의 모바일 앱을 만들게 되는거야
>
> 1은 주로 우리 lophn과 remote하기 위한 것 그리고 또 2 앱을 위한 host 지금 우리 lophn처럼
> 그리고 브라우즈 유즈도 이걸 고려해야해 , 단순하게 브라우저 탭만 하는 게 아니라 우리 lophn에서 만드는 앱 또한 그 뭐라하냐 cdp 조작? 뭐시기 하면서 테스트 해볼 수 있겠지? 모바일 앱도 마찬가지고

> (가)가 개인 개발 생산성을 고려했을 때, 더 낫지 않음? 글고 (가)로 가도 위젯 만드는 거 가능한가?

> 2는 우리 preview를 좀 활용하면서 (가)로 가는 게 좋을 것 같은데 번들 많이 무거워짐? emulation 두면? extension으로 빼도 되고 그럼
> 3 remote protocol은 좀 더 구체적으로 정해야할 듯

> 2에 대해서 중요한 점은 사용자 개인의 앱을 만드는 것이기 때문에
> 사용자 머신만 등록하고 그에 따른 반응형은 구현하지 않는다는거야
> 반응형이 그니까 여러 머신에서도 동작하는 그런 걸 포기하고 (대가가 없음 사용자 자신이 쓰는거기 때문에) 생산성과 최적화를 확보하는 그런 느낌인거지
> 그리고 remote는 단순하게 우리 lophn 이제 터미널이랑 그런 것들을 조작할 수 있게하는 것 뿐만 아니라 앱 간의 통신이나 이벤트 발행이나 그런 것도 가능해야할 듯? core가 server 역할을 할 수도 있는거고 사실 모바일 앱이 서버 역할을 할 수도 있게 되는거기도 하고

2026-11-14:

> mobile 로드맵 읽고 와봐 이제 구체적으로 설계 좀 들어가자

> 그리고 remote에 관려해서는 ../harness-lab/_report/ 에서 리모트 보고서도 참고하고

> 그리고 reactor를 만드는 것도 좋아보여 왜냐하면 이제는 이벤트 발행하고 shell에서 렌더링이 바뀌어야하는 경우가 앞으로 더 늘어날 것 같거든
> 모바일 앱도 있고, loph도 cli로 이제 더 많은 그런 기능에 대한 접근을 열 생각이라서

마지막 말은 `roadmap/screen-sync.md`가 받는다.

## 개념

2026-11-08에 정리한 것이다. 그 뒤의 설계는 아래 "설계안"이다.

```
 사람의 폰                                    사람의 컴퓨터
┌──────────────────────────────┐            ┌─────────────────────────────┐
│ lophn 모바일 앱 (native 껍데기) │            │ lophn core (원본: ledger,    │
│  ├ remote: session, 승인, 터미널│◀── remote ─▶│   앱 process, agent)         │
│  ├ host: 사용자 앱을 WebView로   │            │ lophn shell (터미널, browser)│
│  ├ native 위젯                  │            └─────────────────────────────┘
│  └ 폰 기능을 command로 내놓기     │
└──────────────────────────────┘
```

### 1. lophn 모바일 앱

두 역할을 한다.

- **remote.** 사람의 컴퓨터에서 도는 lophn에 붙어 agent session을 보고 말을 걸고, 승인과 질문에 답하고, 터미널을 다룬다. 원본은 컴퓨터 쪽이고 폰은 의도만 보낸다(비교한 harness 다섯이 모두 이 꼴이다).
- **host.** 지금 desktop shell이 사용자 앱을 `<webview>`로 띄우듯, 모바일 앱이 사용자의 모바일 앱을 WebView로 띄운다.

### 2. 사용자의 모바일 앱

- 사람이 기운 쪽(아직 정하지 않음): 지금 사용자 앱과 같은 web app(SDK)을 lophn 모바일 앱이 띄운다. native app(Swift, Kotlin, React Native)으로 따로 빌드하지 않는다. 고치면 바로 반영되고 빌드·서명·스토어가 없어 개인 개발 생산성이 높다. 대가는 폰 기능을 host가 연 만큼만 쓰는 것이다.
- **반응형을 만들지 않는다(사람).** 사용자가 등록한 자기 기기(화면 크기, DPR, OS)에만 맞춘다. 여러 기기에서 도는 것을 포기하고 생산성과 최적화를 얻는다. 쓰는 사람이 한 명이라 잃는 것이 없다.
  - 생각: pairing이 기기 등록을 겸하면 폰이 붙을 때 자기 화면 정보를 보낸다. preview emulation과 앱 agent의 지침이 그 등록된 기기를 쓴다. 앱 agent 지침이 바뀌므로 `sdk-note`의 일이 따라온다.
- **위젯.** iOS WidgetKit, Android App Widget 모두 WebView를 넣지 못해 web으로 그리지 못한다. lophn 모바일 앱이 native 위젯 하나를 들고, 사용자 앱이 SDK로 위젯 내용(정해진 component: text, 숫자, 목록, 진행 막대, 버튼)을 데이터로 내면 native가 그린다(Scriptable이 이 꼴이다). 갱신 횟수와 위젯 안 버튼은 OS가 제한한다.
- **홈 화면 아이콘.** Android는 pinned shortcut으로 앱마다 아이콘을 꽂을 수 있다. iOS는 단축어로 비슷하게 된다.

### 3. remote

사람의 말대로 remote는 폰이 컴퓨터를 조작하는 한 방향에 그치지 않는다. 앱 사이 통신과 event 발행도 오가고, core도 폰도 server 역할을 할 수 있다. 비교한 harness는 모두 폰 → host 한 방향이라 양방향은 lophn이 새로 정한다.

비교에서 가져올 뼈대(공통 패턴):
- host가 원본이고 client는 투영이다. 다시 붙으면 snapshot을 받고 seq 뒤로 이어 받는다.
- pairing은 짧은 일회용 code(QR, URL fragment)로 하고 device token을 받는다. 서버는 token hash만 저장하고 기기마다 끊을 수 있다.
- 전송 보호(TLS나 E2EE)와 기기 인증(token)을 나눈다.
- push에는 대화 내용을 넣지 않고 상태(질문 대기, 끝남)와 deep link만 넣는다.
- lophn에 가장 가까운 꼴은 omp다. desktop 앱이 HTTPS·WS listener를 직접 열고, self-signed TLS, QR `#pair=<code>`, 일회용 300초 code를 쓰며 relay가 없다.

## browser-use와 닿는 곳

- browser-use의 대상은 browser 탭만이 아니라 lophn이 만든 사용자 앱(desktop `<webview>`)과 사용자 모바일 앱이다(사람). desktop의 둘은 같은 `<webview>`라 같은 CDP 길로 된다.
- 모바일 앱 테스트는 먼저 desktop preview에서 mobile emulation으로 한다(사람이 기움). emulation은 Chromium에 들어 있어(`webContents.enableDeviceEmulation`, CDP `Emulation`) 번들이 거의 늘지 않는다. 기기는 일반 목록이 아니라 등록한 사람의 기기다.
- preview 탭과 등록한 기기의 emulation은 있다(설정 `shell.devices`, `architecture/browser-tab.md`).
- 실제 폰의 앱을 agent가 다루는 것(옛 browser-use 로드맵 단계 5)은 이 로드맵의 일이다. Android WebView는 CDP로 원격 디버깅이 되고 iOS WKWebView는 Web Inspector다. T3 Code와 Orca는 desktop browser 화면을 `Page.startScreencast`로 폰에 흘려 보이고 폰에서 take control도 한다(`../harness-lab/_report/browser-use/{t3code,orca}.md`).
- emulation은 진짜 폰이 아니다(iOS WKWebView는 WebKit). 실제 폰 확인은 remote가 선 뒤다.

## 지금 코드 (2026-11-14 조사, main, 제품 판 0.23.52)

### core API와 자격

- listener는 한 쌍이다. `127.0.0.1`과 `::1`의 같은 port(기본 7431)에 HTTP `POST /<resource>/<method>`와 WebSocket `GET /gateway`를 연다(`packages/core/server/server.ts:448-456`). 원격 bind 설정, TLS, pairing, device token 코드는 없다.
- 문 앞 검사(`packages/core/server/request.ts:64-130`): `Host`가 loopback 셋이 아니면 `invalid_input`, `Origin` header가 있으면 `forbidden`, 그다음 `Authorization: Bearer`.
- route는 344개다(command 130, read 104, memory 103, upload 4, file 3). actor ceiling에 user가 든 것이 243개, user만인 것이 129개다. 사람 token의 scope는 그 243개 전부다(`packages/core/server/control/handler.ts:40`).
- 사람 token은 control socket `connect {client: cli|shell}`로만 나오고 만료가 없다. core는 token의 SHA-256만 메모리에 둔다(`packages/core/server/identity/registry.ts`). 사람 자격의 principal은 모두 `"user"`라 admission 한도(HTTP 16, Gateway 4)를 shell과 CLI가 같이 쓴다(`packages/core/supervision/responsiveness/admission.ts`).
- renderer는 core를 직접 부르지 않는다. IPC `shell:core-call` → shell main → core HTTP이고, main이 renderer가 부를 route를 allowlist로 좁힌다(`packages/shell/main/desktop/core/allowlist.ts`).
- Gateway는 `watch {conditions}` → `ready` → `event`다. seq, replay, ack가 없고 끊기면 다시 watch하고 snapshot을 다시 읽는다(`packages/protocol/events/gateway.ts`). 느린 client는 buffer 1 MiB에서 끊는다. Gateway actor는 user뿐이다.
- 대화는 `acp/snapshot {session}`(전체, paging 없음)과 `AcpUpdated`(24종)다. item마다 session 안 seq가 있고 어긋나면 `reread`다. 쓰기는 `acp/send` 하나(send, stop, answer, decide)이고 `key`로 멱등이다.
- core → shell 요청은 host queue다. core 메모리에 쌓고 shell main이 `host/take`를 long-poll로 가져간다(`packages/protocol/lophn-agent/host-queue.ts`). 종류는 탭 열기·닫기·보이기, extension tool 호출, browser 호출, `terminal_interrupt`다. host는 하나라고 가정한다.
- idle-exit는 일도 client도 없이 600초다(`packages/core/main/daemon/idle.ts`). client는 진행 중 HTTP 요청과 Gateway socket이다.

### 기능마다 누가 갖고 있나

| 기능 | 정본 | core API로 닿나 | shell 없이 |
|---|---|---|---|
| lophn agent의 session, 대화, 보내기 | core ledger와 agent-runtime child | 됨(`workspaceSessionList`, `session_snapshots/list`, `acp/*`) | 됨 |
| harness agent session | core ledger. turn은 shell main의 harness extension이 돌린다 | 읽기는 됨 | turn이 돌지 않는다 |
| 터미널의 coding agent(TUI) 상태 | shell main tracker(hook socket) | shell이 5초마다 report한 줄만 `app_sessions/list`에 있다. shell이 떨어지면 3초 안에 사라진다 | 안 됨 |
| harness GUI 대화 | shell main 메모리의 handle(`AcpState`) | 안 됨(IPC `harness-gui:tab-*`) | 안 됨 |
| 승인과 질문 | core 메모리(turn request, ask). harness GUI의 card는 shell main | 됨(`turn_requests/decide`, `ask/answer`. actor user, 창에 묶이지 않고 먼저 온 답이 이긴다) | 됨(core가 다시 뜨면 사라진다) |
| 터미널 | `packages/shell/terminal-host`(shell main의 stdio child, node-pty, headless xterm scrollback 10,000) | 안 됨(host queue의 `terminal_interrupt`, `tab_open`뿐) | 안 됨(Quit하면 PTY가 죽는다) |
| 탭 layout | shell main file과 renderer | 안 됨 | 안 됨 |
| notice | core ledger `notices`. toast, OS 알림, `unseen` 점은 shell main 메모리 | 표는 됨 | 표만 |
| secret, 설정 | core file | 됨(secret 넣기는 shell의 보호 입력 창만) | 됨 |

client가 둘일 때 부딪치는 곳:
- 터미널 입력은 그 터미널을 focus한 webContents 하나만 받는다(`TerminalFocusTable`, `packages/shell/main/terminal/controller.ts`). PTY 크기는 하나다.
- `unseen` 점과 알림을 누를지는 desktop 창이 보이는지로 정한다(`packages/shell/main/notice/rule.ts`). 폰에서 봐도 desktop의 점은 남는다.
- session 상태를 접는 곳이 둘이다(renderer `sessions-store.ts`, core `packages/core/lophn-agent/session/lifecycle.ts`).

### 앱 화면 hosting

- 앱 화면은 `lophn-app://app-<ulid>/<screen>/index.html`에서 뜬다. shell main의 protocol handler가 core file route `apps/screen_file`에서 bytes를 받아 준다(`packages/shell/main/app-frame/app-protocol.ts:186`). bundle은 release 준비 때 core가 esbuild로 짓고 `<data root>/apps/<app_id>/bundles/<bundle_hash>/screens/<screen>/`에 봉인한다. dev server는 없다.
- page는 자격이 없다. preload bridge `lophnApp`(member 13)을 부르고, shell main이 IPC sender로 앱을 정해 사람 token으로 core를 부른다. page가 꼭 필요로 하는 것은 `callOperation` 하나다.
- shell main이 하는 일(`packages/shell/main/app-frame/`, 약 5.4k줄): view ↔ `{app, release, bundle hash, process nonce}` binding, asset 주기, 선언한 operation만 통과, 앱 event를 release의 구독으로 거르기, `AppViewChanged`에 다시 bind, CSP와 network 정책.
- SDK와 UI kit은 창이 아니라 container 폭으로 배치한다(`useContainerSpace`: 320 아래 `card`, 640 아래 `panel`). Electron API를 쓰지 않는다. touch에는 작다: button 28~36px, 본문 14px, hover로만 드러나는 것(`CodeBlock` 복사 button, tooltip).
- 설정 `shell.devices`(`{name, width, height, dpr, os}`, 32개까지)는 preview 탭의 기기 고르기와 `lophn tab open --preview --device`만 읽는다. 앱 agent 지침(SDK guide, `design-app`, template)은 등록한 기기를 말하지 않는다.
- 대화 화면 `AgentView`는 `AgentTabSource`(`packages/shell/renderer/conversation/agent-tab-source.ts:599`)로 data를 받고 Electron에 묶이지 않는다. wireframe gallery가 fake source로 browser에서 그린다.

## 비교에서 더 본 것 (2026-11-14)

`../harness-lab/_report/remote-control/`의 열하나 가운데 폰 client가 있는 일곱(omp, T3 Code, OpenCode, Paseo, Happy, Orca, mixdog)을 다시 읽었다.

- **pairing.** 128-bit 1회용 code, 300초, 기기마다 자격, host는 hash만 저장, 기기마다 끊기로 모인다(omp). QR에 host 공개 key를 실어 pin한다(Orca, Paseo). 따라 하지 않을 것: 만료 없는 offer(Paseo), 계정 하나의 token(Happy), 비밀번호 하나(OpenCode).
- **전송.** omp는 self-signed TLS인데 폰 browser에서 PWA 설치와 Web Push가 막힌다. Orca는 direct를 평문 `ws://`로 열고 그 위에 X25519 E2EE를 올려 direct와 relay가 같은 protocol이다. Paseo는 relay에만 Noise NK를 쓰고 direct는 평문이라 비밀번호가 샌다.
- **relay.** Paseo의 relay는 상태 없는 전달자(메모리 buffer 200 frame)이고 daemon이 밖으로 건다. Happy는 계정, session, 메시지를 저장하는 중앙 서버다.
- **동기화.** 모두 snapshot과 증분이다. seq를 들고 잇는 것은 T3(`afterSequence`), Paseo, Happy이고, omp와 Orca의 agent session은 전체를 다시 받는다.
- **push.** omp는 host가 Web Push를 직접 보낸다(신뢰된 인증서가 필요하다). Paseo는 daemon이 Expo Push를 직접 불러 relay 없이 된다. Orca, T3, mixdog, Happy는 자기 gateway가 APNs·FCM key를 쥔다. 본문에 대화를 넣지 않는 것이 공통이고(Paseo만 220자), 사람이 보고 있으면 보내지 않는다.
- **host → 폰 요청.** 일곱 모두 없다. push뿐이다.
- **폰 UI.** T3, Paseo, Happy는 RN native다. Orca는 desktop이 내려주는 web bundle을 hash 확인 뒤 cache해 WebView로 띄우고, device token은 native 저장소에만 두며 page의 network를 막는다. mixdog는 relay가 UI를 서빙하고 검증이 없어 relay가 JS를 바꾸면 E2EE가 뚫린다.
- **판 차이.** 껍데기와 host의 판이 따로 논다. Orca는 연결 뒤 capability를 주고받고 protocol 하한을 둔다.
- **폰 lifecycle.** background 30초쯤 뒤 socket을 닫고, 돌아오면 probe하고 다시 구독해 snapshot을 받는다.
- **터미널.** Orca는 raw PTY frame과 scrollback snapshot이고 stream마다 seq가 있다. 크기는 마지막에 만진 client가 갖는다(Paseo).
- **폰 권한.** 넓게 준 쪽(Orca, mixdog, OpenCode)이 보고서의 경고 대상이다. omp는 좁다(고르기, 보내기, 끊기, 답하기).

## 설계안 (2026-11-14, planner)

사람이 정하지 않았다. 아래 "사람이 정할 것"과 "추천대로 가려는 것"이 정해지면 정한 것으로 옮긴다.

### remote와 모바일 앱은 다른 것이다 (사람, 2026-11-14)

사람의 말: "리모트랑 모바일 앱이랑 구분을 해야지. desktop 따위에서 돌고 있는 lophn agent를 원격 조종하는 건 desktop이 켜져 있어야하는건 맞는데 캘린더나 모바일 전용 앱은 그와 상관 없이 돌아야하고 물론 컴퓨터가 커지고 core가 켜지면 동기화 되는 것일 수도 있고 또 agent monitor처럼 데스크탑 앱에서만 도는 것들은 remote로 동작할 수 있어야겠지"

폰에서 보이는 것은 셋이고 컴퓨터가 필요한지가 다르다.

| 무엇 | 예 | 어디서 도나 | 컴퓨터가 꺼져 있으면 |
|---|---|---|---|
| remote | lophn agent와 대화, 승인, coding agent | 컴퓨터 | 안 된다 |
| 폰에서 혼자 도는 앱 | 캘린더, 모바일 전용 앱 | 폰(backend와 data가 폰에 있다) | 된다. 컴퓨터의 core에 닿으면 data를 맞춘다 |
| 컴퓨터에서만 도는 앱 | agent monitor | 컴퓨터 | 안 된다. 폰은 그 앱의 화면을 remote로 띄운다 |

- 앱이 어느 쪽인지는 앱마다 요구에 따라 다르고, lophn agent가 그 앱을 지을 때 SDK로 고른다(사람: "앱에 따라 read-only(remote로 내려받아서 실시간), sync, 독립적으로. 그 길을 sdk로 요구사항에 따라 lophn agent가 개발할 수 있게 해야하는거라고"). lophn이 한 가지로 정하지 않는다. SDK가 내놓는 길은 셋이다.
  - **remote:** backend와 data가 컴퓨터에 있다. 폰은 컴퓨터의 것을 실시간으로 본다. 컴퓨터가 있어야 한다. 예: agent monitor.
  - **sync:** backend와 data가 폰과 컴퓨터 둘 다에 있다. 폰 혼자 읽고 쓰고, core에 닿으면 맞춘다. 예: 캘린더.
  - **독립:** backend와 data가 폰에만 있다. 컴퓨터로 올리지 않는다. 예: 모바일 전용 앱.
- 폰에서 혼자 도는 앱은 desktop 화면이 있어도 되고 없어도 된다.
- 아래 "원칙"과 "remote protocol"은 첫째와 셋째의 것이다. 둘째는 "폰에서 혼자 도는 앱" 절이다.


### 원칙: 폰은 두 번째 host다

지금 core에는 host가 desktop shell 하나다. shell은 core와 세 가지를 한다.

1. 사람 자격으로 route를 부르고 event를 받는다(session 목록, 대화, 승인 답하기).
2. core가 시키는 일을 받아 한다(host queue: 탭 열기, browser 호출).
3. 앱 화면을 띄운다.

폰도 이 셋을 network 너머에서 똑같이 한다. remote 전용 API를 새로 만들지 않고, host가 core에 붙는 길을 하나 더 연다.

```
            ┌─────────────── core (원본) ───────────────┐
            │ route · event · host에 보내는 요청 · 기기 등록 │
            └───▲─────────────────────────────▲────────┘
      loopback  │                             │  LAN, Tailscale
        desktop shell                        폰
        띄우는 것: 앱 화면                     띄우는 것: 앱 화면, remote 화면
        내놓는 것: 터미널, browser 탭,         내놓는 것: 위젯, 위치, 카메라
                  harness GUI
```

따라 나오는 것:

- **폰이 컴퓨터를 다루는 것**은 1이다. lophn agent의 session, 대화, 승인은 core에 있어 desktop 앱을 꺼도 된다.
- **폰이 server가 되는 것**은 2다. core(agent, 앱)가 폰이 내놓는 것을 부른다. 비교한 일곱에는 이 방향이 없고 lophn에는 host queue가 있다. core 안에 붙어 있는 host의 표(desktop, 폰마다 하나, 각자 내놓는 것)를 두고 요청을 그 host로 보낸다. 탭 열기, browser 호출, extension tool은 desktop만 받고 위젯, 위치, 카메라는 폰만 받는다. 전송은 shell main도 폰과 같은 양방향 연결로 옮기고 `host/take` long-poll을 지운다(추천). 이유: 아래 harness GUI 중계에서 shell main이 core로 갱신을 계속 올려야 하는데 long-poll은 core가 시키는 한 방향이다. 다른 안: desktop은 `host/take`를 그대로 두고 폰만 연결의 역방향 요청을 쓴다(고칠 곳이 적지만 같은 일에 전송이 둘 남는다).
- **coding agent는 harness GUI(ACP)가 주 경로다.** harness GUI는 이미 ACP다(`architecture/harness-gui.md`). 지금은 handle이 shell main 메모리에 있고 IPC로만 닫혀 있다. shell main이 handle의 상태와 갱신을 core로 올리고 core가 ACP 길로 중계하면, 폰의 `AgentView`는 lophn agent와 desktop의 Claude Code·Codex를 같은 대화 화면과 승인 card로 다룬다. 터미널 TUI의 승인 대기는 PTY에 글자를 쳐야만 답할 수 있어 폰에서는 GUI여야 한다. desktop 앱이 떠 있어야 된다(창은 닫아도 된다). 폰이 청하는데 shell이 없으면 core가 앱을 띄운다(`architecture/platform.md`의 "core가 shell을 띄운다").
  - GUI와 TUI는 한 번에 하나만 있다(Claude와 omp는 toggle이 process를 다시 띄운다). desktop에서 TUI로 도는 session을 폰이 열 때의 동작은 사람이 정한다(아래 "사람이 정할 것" 6).
  - raw 터미널(PTY 화면 보기와 간단한 입력)은 보조이고 뒤 단계다. 폰의 가상 keyboard로 TUI를 치는 것은 쓰기 나쁘고 desktop과 PTY 크기, 입력 focus가 부딪친다.
- **앱 사이 통신과 event**는 이미 core에 있다(앱 command 호출, 앱 event). 폰에 띄운 앱 화면도 같은 길로 받는다.

### remote protocol

- **연결.** 폰이 core로 WebSocket 하나를 건다. 그 위로 넷이 오간다: 폰의 route 호출(지금 route와 dispatch를 그대로 쓰고 실어 나르는 길만 다르다), core의 event(Gateway의 `watch`, `ready`, `event` 그대로), core가 폰에 보내는 요청과 그 답, stream(앱 화면 asset, 뒤 단계의 터미널 bytes). 누가 연결을 걸었는지와 무관한 양방향 메시지 줄이라 relay를 나중에 더해도 protocol이 같다(Paseo의 꼴).
- **listener.** remote를 켰을 때만 core가 loopback 밖 listener를 연다. 지금 listener의 loopback 검사(`Host`, `Origin`)는 그대로 둔다.
- **암호화.** TLS 인증서를 쓰지 않고 연결 안에서 암호화한다. core가 오래 쓰는 key 쌍을 갖고, QR에 공개 key를 실어 폰이 그 key만 믿는다. 폰도 key 쌍을 만들어 등록하고 연결마다 서로의 key로 handshake한다(Noise). bearer token을 두지 않는다. 이유: self-signed TLS는 폰에서 계속 걸리고(omp), 연결 안 암호화는 direct와 relay가 같은 protocol이 된다(Orca).
- **pairing이 기기 등록이다.** desktop Settings의 기기 화면에서 QR을 띄운다. QR에는 core의 주소 후보(LAN, Tailscale), 공개 key, 1회용 code(128-bit, 300초, 메모리에만 두고 새 code가 옛 code를 무효로 한다)가 든다. 폰이 scan하면 자기 공개 key, 이름, OS, 화면 크기, DPR을 보내고 core가 기기로 등록한다. 틀린 code는 횟수를 제한한다. 기기 목록에서 이름을 바꾸고 끊는다. 끊으면 그 기기의 연결을 바로 닫는다. 폰에서 연결을 지우면 core의 등록도 지운다(Orca는 폰에서만 지워 host에 남는다).
- **기기 정보가 가는 곳.** 등록된 화면 정보가 설정 `shell.devices`(preview emulation, `--device`)의 자리를 채우고, 앱 agent 지침이 그 기기를 말한다(`sdk-note`의 일). `phone` 화면의 기준 기기는 쓰는 사람마다 하나다. 새 폰을 pairing하면 기준이 그 폰으로 바뀌고 Settings에서 바꿀 수 있다. 기준이 바뀌면 옛 크기로 그린 `phone` 화면은 다시 그려야 한다.
- **동기화는 새로 만들지 않는다.** 지금 화면의 약속(구독, `ready`, snapshot, event. 끊기면 처음부터)을 그대로 쓴다(`architecture/event.md` 지키는 것 19~20). 폰이 background에서 돌아오면 다시 구독하고 snapshot을 읽는다. seq와 replay를 더하지 않는다. 쓰기는 이미 있는 멱등 key(`acp/send`의 `key`, command의 `idempotency_key`)로 끊겨도 두 번 가지 않는다. `acp/snapshot`은 paging이 없다. 긴 session에서 폰이 무거우면 그때 나눈다.
- **권한.** 폰 자격은 actor user이되 부를 수 있는 route를 목록으로 좁힌다(shell main이 renderer에 하는 것과 같다). 목록은 폰 화면이 쓰는 route에서 시작한다. principal을 기기마다 따로 두어 admission 한도를 shell과 나누지 않는다.
- **판 차이.** 껍데기는 스토어 판이고 화면과 core는 같은 판이다. 연결할 때 protocol 판과 capability를 주고받고 protocol 하한을 둔다(Orca).
- **폰의 연결 수명.** background로 가면 socket이 끊긴다고 본다. 돌아오면 다시 붙어 처음부터 맞춘다. core에 닿지 않으면 닿지 않는다고 보인다. offline cache는 두지 않는다.

### 폰 앱의 모양

얇은 native 껍데기와 core가 내려주는 web 화면으로 나눈다.

- **껍데기(native):** 연결과 암호화, 기기 key 보관(Keychain, Keystore), QR, push, 위젯, WebView 띄우기, 폰 기능 command.
- **화면(web):** remote 화면(session 목록, 대화, Inbox)과 사용자 앱. core가 hash로 봉인한 bundle을 내려주고 폰이 hash를 확인해 cache한다(Orca의 꼴). page는 network를 직접 쓰지 못하고 bridge로만 core에 닿으며 기기 key를 보지 못한다. cache한 bundle을 `file://`로 열지 않는다(앱끼리 origin이 갈리지 않고 ES module이 막힌다). native scheme handler(iOS `WKURLSchemeHandler`, Android `WebViewAssetLoader`)가 `lophn-app://app-<id>/` 요청을 받아 cache의 bundle만 내주고 바깥 URL을 막는다. 기본 `react-native-webview`로는 안 되어 껍데기에 자체 native module이 들고, Expo Go가 아니라 dev build로 돈다.
- remote 화면은 desktop renderer의 component를 같이 쓴다. `AgentView`는 `AgentTabSource`로 data를 받아 source만 더하면 된다. 화면 갱신은 `roadmap/screen-sync.md`의 공통 읽기를 쓴다.
- 껍데기 stack의 추천은 Expo(React Native)다. protocol과 암호화 코드를 core와 같은 TypeScript로 쓰고 Node에서 test한다. 비교한 폰 앱 다섯 가운데 넷이 Expo다.

얻는 것: 화면을 고쳐도 폰 앱 빌드와 스토어를 거치지 않는다. 화면과 core가 늘 같은 판이다. 대화 화면을 다시 만들지 않는다.
잃는 것: scroll, keyboard, gesture의 느낌이 native 화면만 못하다.

### 사용자 앱을 폰에 띄우기

- **`phone` 자리.** 앱 선언의 `screens[].places`에 `phone`을 더한다. 그 자리를 선언한 screen이 있는 앱만 폰에 보인다. 앱 하나가 desktop 화면과 폰 화면을 같이 갖고 backend와 data는 하나다.
- **등록한 기기에 맞춘다.** 폰 화면은 등록한 기기의 크기와 DPR에 맞춰 그리고 반응형을 만들지 않는다. 앱 agent 지침(`design-app`, SDK guide, template)에 기기와 touch 규칙(누르는 곳 44px 이상, hover에 기대지 않기)을 더한다. UI kit에 touch용 크기 token을 두고 폰 host가 지금 appearance CSS를 넣는 길로 건다.
- **view binding을 core로 옮긴다.** 지금 shell main이 하는 일(view가 어느 앱과 release인지, 부를 수 있는 operation, event 거르기, release가 바뀌면 다시 bind)을 core가 하고, host는 WebView와 view id를 잇고 bridge 호출을 core로 넘기기만 한다. host 둘이 같은 logic을 따로 들지 않게 한다.
  - 신원은 host가 붙인다. native host(Electron main, 폰 껍데기)가 WebView와 view id의 표를 쥐고 bridge 호출에 view id를 붙여 core를 부른다. page(AI가 짠 코드)가 낸 값은 신원으로 믿지 않는다. 지금 page는 URL query로 `view_session`을 보고 신원은 IPC sender가 보증한다(`architecture/app-call.md` 지키는 것 4).
  - core가 그 host에 어느 앱과 release의 view가 열려 있는지 알므로, 그 host가 구독한 앱 event만 내려보낸다.
- **bridge.** 폰은 `lophnApp`의 member 가운데 desktop 전용(`commands`, `setTabHead`, `setKeepAlive`)을 뺀 것을 준다.
- **위젯.** 앱이 SDK로 위젯 내용(정해진 component)을 data로 내고 native가 그린다. 지금 tray 값(`app_tray.set`, `AppTrayChanged`)과 같은 꼴이다.
- **홈 화면 아이콘.** Android는 pinned shortcut, iOS는 단축어다.
- **폰 기능.** 앱 backend와 agent가 폰의 기능(위치, 카메라)을 core를 거쳐 부른다. grant를 거친다. 폰이 닿지 않으면 `unavailable`이다. 쓰는 예가 생길 때 기능 하나씩 연다.

### 폰에서 혼자 도는 앱 (사람, 2026-11-14)

사람의 말: "화면을 컴퓨터가 내려준다는 게 무슨 말인데 자체적인 앱처럼 동작할 수도 있어야지. 예를 들어서 현재 내가 캘린더 앱이 있는데 그걸 모바일/데스크탑 버전으로 하나의 앱으로 만들고 데이터도 동기화되고 그런 거 아니야? 화면을 컴퓨터가 열려있을 때만 보여준다고? 말이 돼 그게?"

요구: 앱 하나가 desktop 화면과 폰 화면을 갖고, 폰에서는 컴퓨터 없이 읽고 쓰며, data가 두 기기 사이에 맞춰진다. 위 설계안의 "backend는 컴퓨터에서만 돈다"를 버린다.

지금 코드(2026-11-14 조사):
- backend는 Node로 그대로 도는 `.ts`다. bundle 단계가 없고 `node_modules`를 통째로 싣는다(`packages/core/apps/releases/bundle/modules.ts`). handler는 Node 내장 module과 npm package를 아무것이나 쓸 수 있고 막는 장치가 없다(`packages/core/apps/runtime/processes/spawn.ts:1`).
- data는 `@lophn/cap-store`가 `node:sqlite`의 handle을 그대로 내주고 앱이 SQL을 직접 쓴다(`packages/sdk/cap-store/store.ts:51`). schema와 migration은 앱의 것이다.
- write마다 changeset(SQLite session의 row 단위 변경, primary key 기준)을 뜬다(`packages/sdk/cap-store/connection.ts:68-84`). rewind가 이것을 뒤집어 쓴다. 다른 사본에 적용할 수 있는 꼴이지만 충돌 규칙, 기기 id, 순서가 없고 충돌 하나에 전체가 되돌아간다. 다음 activation 뒤에 지운다.
- row의 id는 앱이 정한다. sample은 `integer primary key`라 두 기기가 같은 id를 만든다.
- 효과 선언(`read`, `write`, `external`)을 core가 믿고 쓴다. read는 기록하지 않는다.
- network와 secret은 core의 broker를 거치고 secret 값은 core에만 있다. agent, 다른 앱의 command, event도 core를 거친다.

방향(planner 추천, 폰 runtime은 확인 전):
- **폰에서 도는 backend는 SDK만 쓴다.** 폰용이라고 선언한 앱은 handler가 Node 내장 module을 쓰지 않고 SDK의 data API로만 읽고 쓴다. release 준비가 그 backend를 한 file로 bundle해 폰의 JavaScript engine과 폰의 SQLite로 돌린다. 버린 안: 폰에 Node를 싣는다(폰용 Node는 판이 늦어 지금 쓰는 `node:sqlite`와 session 기능이 있는지 확인이 필요하고 iOS는 JIT가 없다).
- **changeset을 맞추는 단위로 쓴다.** 두 기기가 write마다 changeset을 남기고, 닿았을 때 주고받아 적용한다. 쓰는 사람이 하나라 같은 row를 양쪽에서 고친 경우만 충돌이고 나중에 고친 것이 이긴다.
- **id는 기기가 달라도 겹치지 않아야 한다.** 폰용 앱의 table은 정수 자동 증가 id를 쓰지 못한다. release 검사가 잡는다.
- **판을 같이 올린다.** 폰은 컴퓨터와 같은 release일 때만 맞춘다. 새 release는 폰이 받아 migration을 돌린 뒤에 맞춘다.
- **컴퓨터가 있어야 되는 것은 그대로다.** agent, 다른 앱의 command, job, secret을 쓰는 요청은 컴퓨터에 닿을 때만 된다. 앱은 닿지 않을 때 그 기능이 `unavailable`임을 다룬다.
- lophn의 remote 화면(session, 대화, 승인)은 컴퓨터의 것을 보는 화면이라 컴퓨터가 있어야 한다.


### 알림과 push

- core가 push를 보낸다. 계기는 사람을 기다리는 상태로 새로 넘어간 것(승인, 질문, 동의, job hold), 오래 돈 turn의 끝, 앱의 `notify()`다. 글에는 상태와 제목만 넣고 대화 내용을 넣지 않는다. 누르면 그 session이나 앱으로 간다.
- 누구에게 알릴지는 core가 host들의 보고로 정한다. host가 "사람이 무엇을 보고 있다"를 core에 알리고, 보고 있는 host가 있으면 push를 보내지 않는다. desktop의 보고에는 창 focus뿐 아니라 마지막 keyboard·mouse 입력 뒤 지난 시간(Electron `powerMonitor.getSystemIdleTime()`)을 넣는다. 창을 띄워 놓고 자리를 비우면 보고 있지 않은 것이다. desktop의 toast와 OS 알림을 가르는 것은 지금처럼 shell의 정책이다.
- 터미널 coding agent의 대기와 끝은 지금 shell main tracker에만 있다. shell main이 core에 올리는 `terminal_sessions/report`에 그 상태 변화를 실어야 폰 push와 `unseen`에 든다(단계 4).
- `unseen` 점을 core로 옮긴다. 폰에서 읽으면 desktop의 점도 꺼진다.

## 단계

다 한다(사람, 2026-11-14). 순서는 planner가 정했다. 앞의 것이 뒤의 것의 바탕이라 이 순서다.

0. 화면 갱신(`roadmap/screen-sync.md`). 단계 1과 나란히 간다.
1. core: 기기 등록, pairing, 폰 연결(암호화, route 목록), Settings의 기기 화면. 폰 없이 Node client로 확인한다.
2. 폰 껍데기(iOS, Android)와 remote 화면: lophn agent의 session 목록, 대화, 승인과 질문 답하기.
3. push와 알림 정하기(host의 보고, `unseen`).
4. coding agent: desktop의 harness GUI 대화를 폰에서 다룬다.
5. remote 앱: 컴퓨터에서 도는 앱의 화면을 폰에 띄운다(`phone` 자리, view binding, 기기 지침, touch token).
6. sync 앱과 독립 앱: 폰에서 backend와 data가 돈다(SDK의 길 셋, 폰 runtime, changeset으로 맞추기).
7. 위젯, 홈 화면 아이콘, 폰 기능 command.
8. raw 터미널 보기와 간단한 입력.
9. 실제 폰의 browser-use.

단계 6은 폰에서 backend를 실제로 돌릴 수 있는지에 달려 있다. 그 확인(spike)은 단계 1~2와 나란히 먼저 한다. 안 되면 단계 6의 방향을 다시 잡는다.

## 사람이 정할 것

1. **원칙.** "폰은 두 번째 host다"로 가나. 터미널을 shell에 둔 채 core가 잇는 것까지 포함이다. 다른 안: terminal-host를 core 밑으로 옮겨 Quit 뒤에도 PTY를 살린다. mobile과 따로 정할 수 있는 큰 구조 변경이다.
2. **폰 기종.** 정할 것이 아니다. 쓰는 사람마다 폰이 달라 iOS와 Android를 둘 다 낸다(Expo 하나로 짓는다). 개발은 Linux에서 바로 빌드되는 Android로 먼저 확인한다. iOS는 빌드에 Mac이나 cloud 빌드가, push와 배포에 Apple Developer 계정(연 $99)이 든다. 이 비용은 lophn 쪽이 지고 쓰는 사람이 지지 않는다.
3. **폰 앱의 모양.** 추천: 얇은 껍데기(Expo)와 core가 내려주는 web 화면. 다른 안: 화면까지 RN native로 만든다(느낌이 좋지만 대화 화면을 다시 만들고 화면을 고칠 때마다 폰 앱을 빌드한다). native 앱 없이 폰 browser만 쓴다(위젯, 폰 기능, 앱 host가 안 된다).
4. **망과 push.** 추천: 망은 direct만(집 LAN과 Tailscale), push는 Expo Push. 잃는 것: 집 밖에서는 Tailscale이 필요하다. push는 Expo에 기대고 Expo가 알림 글(상태와 제목)을 본다. 다른 안: relay를 둔다(Paseo 꼴의 상태 없는 전달자라도 lophn이 서버를 돌린다). 자기 push gateway를 돌린다. push를 두지 않는다.
5. **순서.** 정했다. 다 하고(사람), 순서는 위 "단계"다(agent).
6. **TUI로 도는 session을 폰이 열 때.** 추천: GUI로 바꿀지 묻고, 바꾸면 desktop도 GUI로 바뀐다. 다른 안: 말없이 바꾼다(desktop에서 쓰던 TUI가 예고 없이 끊긴다). 이미 GUI인 session만 폰에 보인다(TUI로 쓰는 사람은 폰에서 못 본다).

## 추천대로 가려는 것

사람이 반대하지 않으면 계획을 열 때 정한 것으로 옮긴다. 괄호는 2026-11-08의 열린 질문 번호다.

- **폰이 server일 때 폰에서 도는 것(3).** 뒤집혔다(사람, 2026-11-14). 사용자 앱은 컴퓨터가 꺼져 있어도 폰에서 혼자 돌아야 한다. 아래 "폰에서 혼자 도는 앱".
- **앱 event(4).** 닫힘(2026-11-11). 저장하지 않는 앱 event를 열었다(`architecture/event.md`). 폰에 띄운 앱 화면은 view binding을 core로 옮기면 같은 길로 받는다.
- **폰의 권한(5).** 폰은 일하는 창이다: 보기, 말하기, 답하기(승인, 질문, 동의), 앱 쓰기. 관리(secret, provider 설정, 기기 추가와 끊기, 앱 지우기)는 desktop에서만 한다. secret 넣기는 지금도 shell의 보호 입력 창만 한다(`architecture/approval.md`의 사람 결정 handle).
- **core 깨어 있기(6).** Settings의 Remote access가 켜져 있으면(바깥 listener가 열려 있으면) idle-exit로 끝나지 않는다. 폰은 꺼진 core를 띄우지 못하기 때문이다. 조건을 "등록된 기기가 있음"으로 두지 않는다. pairing은 한 번 하면 지우지 않아 idle-exit가 사실상 없어진다. 사람이 `Stop lophn`을 누르면 remote가 켜져 있어도 core가 끝난다. 로그인 때 core를 띄우는 것은 지금 autostart가 한다. PC 잠자기는 OS 설정에 맡긴다.
- **`PRODUCT.md`(7).** "원격, 여러 사람용 서비스"를 "여러 사람용 서비스는 하지 않는다. 한 사람이 자기 폰에서 자기 컴퓨터에 붙는 것은 한다."로 고친다.
- **폰용 앱 화면.** `phone` 자리를 선언한 앱만 폰에 보인다. 지금 `tab` screen을 좁게 보이는 길은 두지 않는다.

## 하지 않는 것

- 사용자 앱을 native app으로 빌드하기(Xcode, 서명, 스토어).
- 사용자 앱의 반응형, 등록하지 않은 기기 지원.
- 여러 사람이 쓰는 서비스, 다른 사람과 session 공유.
- 컴퓨터가 꺼져 있을 때 폰에서 agent 부르기, 다른 앱의 command 부르기, job, secret을 쓰는 요청.
- event의 seq와 replay.
- 폰에서 secret 넣기와 기기 관리.
- terminal-host를 core 밑으로 옮기기. 따로 정한다.
- PC를 깨우거나 잠자지 않게 하기.

## 같이 고칠 문서

- `PRODUCT.md` 5절 "하지 않는 것".
- `architecture/platform.md`: 비목표 "원격 머신이나 다른 OS 사용자가 core에 붙는 길", listener, idle-exit.
- `architecture/event.md`: Gateway가 받는 principal.
- `architecture/approval.md`: 폰 자격과 사람의 결정.
- `architecture/app-call.md`, `workspace-layout.md`: view binding.
- `architecture/app-notice.md`, `terminal-agent.md`: 알림 정하기, `unseen`.
- `architecture/harness-gui.md`, `acp.md`, `terminal-agent.md`: handle을 core로 올리기, host의 표와 양방향 연결, 터미널 agent 상태 보고.
- `architecture/browser-tab.md`: 기기 등록과 `shell.devices`.
- SDK guide, `design-app`, 앱 template: `phone` 자리와 기기 지침(`sdk-note`).
- `boundary-catalog.yaml`, `module-catalog.yaml`: remote 연결과 기기 등록의 경계.
