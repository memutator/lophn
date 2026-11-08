# mobile: lophn 모바일 앱과 사용자의 모바일 앱

상태: **개념 정리만 했다.** 2026-11-08 사람이 방향을 냈고 planner가 대화를 정리했다. 사람이 더 고민하기로 해서 아래 "열린 질문"은 정하지 않았다. 추천은 planner의 것이고 결정이 아니다. 계획으로 열기 전에 사람과 다시 정하고, "지금 코드"는 그때 worker 조사로 채운다.
배경 문서: `project-docs/architecture/{platform,app-call,terminal-agent,app-notice}.md`, `project-docs/products/roadmap/{agent-surface,tool-extension,browser-tab,app-preview}.md`. 비교: `../harness-lab/_report/remote-control/`(README와 `t3code.md`, `paseo.md`, `orca.md`, `happy.md`, `omp.md`).
browser use(desktop의 browser 탭·앱 preview·기기 emulation)는 계획 `browser-use`가 했다(changelog 0.22.0, `architecture/browser-tab.md`). 실제 폰의 앱을 다루는 것은 이 로드맵에 남는다. 아래 "browser-use와 닿는 곳".

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

## 개념

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

## 지금 lophn과 닿는 곳 (문서로 확인한 것)

- core API는 loopback HTTP·WebSocket이다. token은 control socket `connect`로만 받고, control socket은 filesystem 권한이 인증 경계다(`architecture/platform.md` control socket). 폰은 이 길로 붙지 못하므로 remote listener와 기기 인증을 새로 둔다.
- 일도 client도 없이 10분이 지나면 core가 끝난다(`platform.md` idle-exit). 폰은 꺼진 core를 띄우지 못한다.
- 앱 화면의 operation은 core API(`app.call_tool`)로 간다(`architecture/app-call.md` 흐름). 그래서 폰에 띄운 앱도 core API에 닿으면 지금 길로 돈다. 앱 process는 core가 띄우는 Node process다.
- 터미널은 core가 아니라 shell의 `terminal-host`에 있다(`architecture/terminal-agent.md`). 원격 터미널은 shell이 떠 있을 때만 있고 core에서 shell로 한 번 더 넘겨야 한다.
- 앱 event 발행·구독은 일부러 열지 않았다(`architecture/app-notice.md`: 반응을 믿으려면 저장, 구독자 cursor, 재시도, 멱등 key가 다시 필요하다).
- `PRODUCT.md` "하지 않는 것"에 "원격, 여러 사람용 서비스"가 있다. 이 roadmap은 그 줄과 부딪친다.

## browser-use와 닿는 곳

- browser-use의 대상은 browser 탭만이 아니라 lophn이 만든 사용자 앱(desktop `<webview>`)과 사용자 모바일 앱이다(사람). desktop의 둘은 같은 `<webview>`라 같은 CDP 길로 된다.
- 모바일 앱 테스트는 먼저 desktop preview에서 mobile emulation으로 한다(사람이 기움). emulation은 Chromium에 들어 있어(`webContents.enableDeviceEmulation`, CDP `Emulation`) 번들이 거의 늘지 않는다. 기기는 일반 목록이 아니라 등록한 사람의 기기다.
- preview 탭과 등록한 기기의 emulation은 있다(설정 `shell.devices`, `architecture/browser-tab.md`).
- 실제 폰의 앱을 agent가 다루는 것(옛 browser-use 로드맵 단계 5)은 이 로드맵의 일이다. Android WebView는 CDP로 원격 디버깅이 되고 iOS WKWebView는 Web Inspector다. T3 Code와 Orca는 desktop browser 화면을 `Page.startScreencast`로 폰에 흘려 보이고 폰에서 take control도 한다(`../harness-lab/_report/browser-use/{t3code,orca}.md`).
- emulation은 진짜 폰이 아니다(iOS WKWebView는 WebKit). 실제 폰 확인은 remote가 선 뒤다.

## 열린 질문 (사람이 고민 중)

각 질문 끝의 추천은 planner의 것이다.

1. **remote 망.** direct(LAN, Tailscale)만 할까, relay를 둘까? 비교 다섯 중 relay가 없는 것은 omp뿐이고 이유는 집 밖 접속이다. relay를 둔다면 Paseo 꼴(desktop이 밖으로 연결을 열고 relay는 내용을 모르는 E2EE)이 가장 싸다. 추천: direct만. 대가는 집 밖에서 Tailscale이 필요한 것.
2. **push.** native push(APNs·FCM)는 key를 가진 서버가 보낸다. lophn 서버 없이 가려면 Expo Push 같은 바깥 서비스에 기댄다(Paseo). omp의 Web Push는 PWA라서 서버가 없다. 추천: 바깥 push 서비스.
3. **폰이 server일 때 폰에서 도는 것.**
   - (가) 폰 기능(위치, 카메라, 알림, 위젯 갱신)만 command로 내놓는다.
   - (나) 사용자 앱 backend도 폰에서 돌아 desktop 없이도 된다.
   - 추천: (가). (나)는 폰에 Node를 실어야 하고(nodejs-mobile 등, 판이 늦고 iOS는 JIT 없음) `app.sqlite`, invocation, changeset, rewind를 두 기기에서 맞춰야 한다.
   - 폰은 연결을 받지 못한다(NAT, iOS background socket 끊김). 그래서 폰이 core로 연결을 열어 두고 그 위로 양쪽 요청이 오간다. 폰이 background면 desktop은 폰을 부르지 못하고, 깨우는 길은 OS가 제한하는 silent push뿐이다.
4. **앱 event를 다시 열까.** 연다면 저장, 구독자 cursor, 멱등 처리를 처음부터 둔다(폰은 자주 끊긴다). 추천: 앱 사이 통신은 지금 command 호출로 하고, event는 쓰는 예가 생기면 연다.
5. **폰의 권한.** 비교한 쪽은 대개 거의 전부를 준다(T3 기본 scope, Paseo owner, Orca 넓은 allowlist). 추천: 사람 권한 전부. 단 secret 보기·고치기와 remote 설정(기기 추가·끊기)은 desktop에서만.
6. **core 깨어 있기.** remote가 켜져 있으면 idle-exit가 core를 끝내지 않게 할까? 추천: 그렇다. PC 잠자기는 OS 설정에 맡긴다.
7. **`PRODUCT.md` 고치기.** 추천 문구: "여러 사람용 서비스는 하지 않는다. 한 사람이 자기 폰에서 자기 컴퓨터에 붙는 것은 한다."

## 순서 (생각)

browser-use(desktop: browser 탭, 사용자 앱, preview mobile emulation) → lophn 모바일 앱(remote, host, 위젯) → 모바일 browser-use(실제 폰). 열린 질문이 정해지면 단계로 다시 쓴다.

## 하지 않는 것 (지금 기운 것)

- 사용자 앱을 native app으로 빌드하기(Xcode, 서명, 스토어).
- 사용자 앱의 반응형, 등록하지 않은 기기 지원.
- 여러 사람이 쓰는 서비스, 다른 사람과 session 공유.
