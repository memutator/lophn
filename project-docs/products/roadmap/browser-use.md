# browser use: agent가 web 화면을 보고 다룬다

상태: 로드맵. 2026-11-08~09 사람이 방향을 냈고 planner가 정리했다. 계획 `browser-use`로 연다.
배경 문서: `project-docs/architecture/{browser-tab,workspace-layout,app-call,annotation,extension,coding-agent}.md`, `project-docs/products/roadmap/{agent-surface,tool-extension,app-preview,mobile,agent-platform,command-surface}.md`. 비교: `../harness-lab/_report/browser-use/`(README, `gooey-pi.md`, `paseo.md`, `t3code.md`, `orca.md`, `codex.md`, `claude-code.md`).

## 사람의 말 (원문)

2026-11-08 (`agent-surface.md`):

> 이후에는 browse-use 같은 기능도 들어올 것이기 때문에
> (browse use 로드맵은 이번 목표는 아님, 브라우즈를 띄울 수 있고 알 수 있는 그런 경로만 둔다는 말)

2026-11-08:

> 그래서 browse use에서도 브라우즈 탭하고 agent하고 연결하는 길이 좀 생긴 것 같아, 넓혀야할 수도 있고

> 그리고 브라우즈 유즈도 이걸 고려해야해 , 단순하게 브라우저 탭만 하는 게 아니라 우리 lophn에서 만드는 앱 또한 그 뭐라하냐 cdp 조작? 뭐시기 하면서 테스트 해볼 수 있겠지? 모바일 앱도 마찬가지고

> 2는 우리 preview를 좀 활용하면서 (가)로 가는 게 좋을 것 같은데 번들 많이 무거워짐? emulation 두면? extension으로 빼도 되고 그럼

> 사용자 머신만 등록하고 그에 따른 반응형은 구현하지 않는다는거야

2026-11-09:

> 우리는 cli + skill 기반이라서 그걸로 가는 게 좋을 거 같은데 그리고 그 방식이면 다른 agent harness도 우리 lophn에서 browse use 할 수 있는 거 아님?

host queue의 1초 poll을 long-poll로 바꾸자는 추천에: "그렇게 가자".

## 왜

- agent는 탭을 열고 자기가 연 browser 탭의 url·title·loading만 읽는다. page를 보지도 누르지도 못해 dev server 화면 확인은 사람이 한다.
- 앱 workspace의 agent는 `preview call`로 handler는 부르지만 화면이 어떻게 그려지고 눌리는지 보지 못한다.
- 사용자 모바일 앱(`mobile.md`)은 자기 폰 크기로 확인해야 하는데 desktop에서 그 크기로 띄울 길이 없다.

## 지금 코드 (2026-11-09 worker 조사)

host queue (`architecture/workspace-layout.md` "agent가 연 탭")
- `packages/core/host-queue/queue.ts`: core 메모리의 `pending` 목록과 탭 표 `tab → {opener, workspace, kind: agent|browser, state}`. 요청 종류는 `tab_open`, `tab_close`, `tool_call`(`packages/protocol/lophn-agent/host-queue.ts:74-92`). `tab_open` 대상은 `{session}`, `{tui}`, `{browser:{url}}`(`:38-44`).
- `host/take`(actor user)는 기다리지 않고 요청 하나나 null을 준다. shell main `packages/shell/main/desktop/wiring/surface.ts`가 `POLL_MS = 1000`으로 부른다(`:21`, `setInterval` `:175`). 부를 때마다 shell이 붙어 있다고 3초 동안 표시한다(`ATTACHED_MS`).
- **요청 → 결과 길이 있다.** 계획 `agent-surface`의 `ext-tools`가 `HostQueue.callTool(payload)` → `{id, result: Promise}`, `abandon(id)`(`unavailable`), `host/done {id, result, output}`을 두었다. core 쪽은 `wiring/extension-tools.ts`(shell이 떨어지면 1초 watch로 abandon), shell 쪽은 `desktop/wiring/extensions.ts:471`. 호출마다 기한은 없다.

agent가 쓰는 명령
- `lophn tab open|close`, `lophn browser read`는 `packages/cli/commands/{tab,browser}.ts`, route는 `tabsOpen`·`tabsClose`·`browserRead`(`host-queue.ts:174-199`)다. 모두 `actors: ["agent"]`이고 handler(`core/main/daemon/wiring/host-queue.ts`)가 `conditions.session`을 요구한다. 사람 token(터미널의 coding agent)은 `forbidden`이다.
- 탭 주인은 `opener`(연 session id)로 남고 `owned()`가 본다. 남의 탭 닫기는 `forbidden`, 읽기는 `not_found`다.
- harness 자격은 workspace 종류 명령의 route 합집합이라(`core/agent-workspaces/credentials.ts:87-95`) 새 명령의 route가 그대로 열린다.
- skill: lophn agent 내장 skill은 `packages/core/agent-workspaces/skills/`, harness·coding agent 공유 skill은 `packages/coding-agent/skills/lophn-agent.ts`(사본은 `harness sync-skills`)다. 공유 skill은 `tab`·`browser`·`preview`를 적지 않고 "사람 token이면 명령이 실패한다"고 적는다.

browser 탭
- guest는 `wv-<guest id>`로 `packages/shell/main/browser/registry.ts`에 들고, raw `WebContents`는 `webContents.fromId`로 얻는다. `host:<tab>` → guest 짝은 renderer만 안다(`renderer/workspace/use-surface-requests.ts`의 `keyOf`).
- partition `persist:lophn-browser` 하나(`main/browser/session.ts:7`), 이동 규칙 `main/browser/navigation.ts`(main frame은 http(s)와 `about:blank`), DevTools는 page마다 하나(`main/browser/devtools.ts`). popup·download는 최근 사용자 입력이 있어야 한다(`activation.ts`).
- `webContents.debugger`와 JS dialog 처리는 어디에도 없다.

앱 preview
- core preview: `packages/core/apps/preview/service.ts`(앱마다 하나, start → `process_nonce`), route `previews.start|get|stop`, CLI `lophn preview start|stop|call`(`packages/cli/commands/preview.ts`, 앱 workspace만). preview 호출은 invocation을 남기지 않고 일회용 DB다(`architecture/app-call.md`).
- shell은 `mode: "preview"` view를 받지만(`packages/shell/ipc/app-frame.ts:64-81`, partition `persist:app-<app>:preview-<bundle>`) renderer에서 preview로 여는 곳이 없다. 탭 kind 14개(`main/workspace/kinds/registry.ts:23-38`)에 preview 탭이 없다. `main/app-frame/annotate.ts`는 release 없는 view를 거절한다.
- operation은 사람과 preview만 부른다. agent·job·flow는 `denied(gate_blocked)`다(`app-call.md`).

결과에 붙는 것
- image: lophn agent의 `image.read`(`core/lophn-agent/tools/file/image.ts`)는 workspace file, `annotation:<id>`, `attachment:<id>`를 읽는다. 명령 결과의 `image` content는 `tool_result_image`로 바뀌지만 그렇게 쓰는 명령은 없다. harness CLI에는 image를 돌려줄 길이 없다.
- untrusted: `UNTRUSTED_SOURCES = ["web.search","web.fetch"]`(`packages/protocol/lophn-agent/input-tags.ts:39`)를 tool 이름으로 맞춰 감싼다(`run-loop/untrusted.ts`). `lophn` 명령 출력과 extension tool 결과는 감싸지 않는다.

## 무엇을 만드나

### 누가 쓰나

`lophn browser …` CLI 명령과 skill 하나라서 lophn 안에서 도는 agent는 다 쓴다.

| 누가 | 자격 | 다루는 탭 |
|---|---|---|
| lophn agent | `lophn` tool, session 자격 | 자기가 연 탭 |
| harness agent(lophn session인 Claude Code·Codex·OpenCode) | turn 자격 `LOPHN_AGENT_CREDENTIAL` | 자기가 연 탭 |
| 터미널 탭의 coding agent(`claude`, `codex`, `opencode`, `omp` …), 사람 | 사람 token | 사람 token으로 연 탭 |

사람이 손으로 연 탭과 앱 live 화면은 아무도 다루지 않는다.

### 1. preview 탭

- 탭 kind `app_preview {app}`. layout에 저장하지 않는다. 지금 앱 view를 `mode: "preview"`로 쓰고, 안내 줄(preview, fixture data, 바깥 연결 대역)과 [Stop]을 둔다. preview가 멈추면 "돌고 있는 preview 없음"을 보인다.
- `lophn tab open --preview <app>`. 그 앱 workspace의 session과 사람 token만 연다(`preview call`과 같은 규칙). 돌고 있는 preview가 없으면 `conflict`다.
- preview 탭의 annotation은 release 대신 preview의 bundle hash를 싣는다.
- `roadmap/app-preview.md`의 1~3을 이것이 가져온다.

### 2. host queue long-poll과 browser 호출

- `host/take`가 기다릴 수 있게 한다: 요청이 오면 바로, 없으면 정한 시간 뒤 null. shell main은 답을 받자마자 다시 부른다. 기다리는 동안 shell은 붙어 있는 것으로 본다. 새 통로는 만들지 않는다(`workspace-layout.md`).
- 요청 종류 `browser_call {tab, action}`을 `tool_call`과 같은 결과 길(`host/done`)로 둔다. 호출마다 기한을 두고 넘으면 `unavailable`이다.

### 3. `lophn browser` 명령

| 명령 | 하는 일 |
|---|---|
| `read <tab>` | url, title, loading (있음) |
| `snapshot <tab>` | accessibility tree를 글로, 요소마다 ref(`e12`). ref는 snapshot마다 새로 나고 page가 바뀌면 무효다 |
| `act <tab> <action>` | `click`, `type`, `fill`, `press`, `hover`, `select`, `scroll` 중 하나. 대상은 ref |
| `navigate <tab> <url>` | browser 탭만. http(s)와 `about:blank` |
| `screenshot <tab>` | PNG |
| `evaluate <tab> <js>` | page에서 식 하나, JSON 결과 |
| `logs <tab>` | 최근 console 줄과 page 오류 |
| `wait <tab> --text|--url` | 조건이 맞을 때까지, 기한 있음 |

- 낡은 ref는 `conflict`와 "다시 snapshot하라"는 글이다.
- page에서 온 글(snapshot, logs, evaluate 결과, title)은 `<lophn-untrusted>`로 감싼다. lophn agent는 tool 이름 규칙에, harness CLI는 stdout 글에 같은 tag를 둔다.
- screenshot: lophn agent에게는 image content로 바로 준다. harness CLI는 PNG를 file로 쓰고 path를 찍는다(harness가 자기 Read tool로 본다).
- 사람 token도 `tab open`·`tab close`·`browser *`를 부른다. 주인은 "사람"으로 남는다.
- 공유 skill `lophn-agent`에 `tab`, `preview`, `browser` 쓰는 법을 더한다. "사람 token이면 실패한다"는 줄을 고친다.

### 4. shell main의 CDP

- 대상 탭의 guest에 `webContents.debugger.attach()`로 붙는다. 입력은 CDP `Input.*`이다(`sendInputEvent`는 `<webview>` guest에 닿지 않는다, GooeyPi).
- DevTools가 열려 있으면 붙지 못한다(webContents 하나에 debugger 하나). 그때는 `conflict`.
- JS dialog는 자동으로 닫고 결과에 적는다(Paseo).
- 뒤에 숨은 탭은 그리기를 멈춘다. agent가 다루는 동안 focus emulation을 건다(T3).
- **take control.** agent가 다루는 탭 머리에 "agent 조작 중"과 [가져오기]를 둔다. 사람이 가져오면 agent의 쓰기(act, navigate, evaluate)는 `conflict`이고 읽기는 된다. [돌려주기]로 푼다(T3).
- agent가 연 browser 탭도 사람의 browser 탭과 같은 partition(`persist:lophn-browser`)을 쓴다. 사람이 로그인한 site를 agent가 그대로 쓴다.

### 5. mobile emulation

- 사람이 Settings에 자기 기기를 등록한다(이름, 크기, DPR, OS). `mobile.md`의 pairing이 서면 폰이 붙을 때 채운다.
- preview 탭에 기기 고르기와 폰 테두리를 둔다. 고르면 그 guest에 크기, DPR, touch, user agent를 건다(Chromium 내장 emulation이라 번들이 거의 늘지 않는다).
- `lophn tab open --preview <app> --device <name>`.
- emulation은 진짜 폰이 아니다(iOS WKWebView는 WebKit). 실제 폰은 `mobile.md` 뒤다.

## 정한 것

1. CLI + skill이다. `lophn browser` 명령을 본체에 두고 extension tool로 만들지 않는다. (사람, 2026-11-09) 그래서 lophn agent, harness agent, 터미널의 coding agent가 같은 구현을 쓴다. Orca(`orca` CLI verb와 번들 skill)와 같은 꼴이다.
2. `tool-extension.md` 정한 것 8("extension tool의 첫 사용자는 browser-use extension")은 맞지 않게 됐다. extension tool은 실제 사용자 없이 test fixture로만 남는다. 남길지는 사람이 따로 정한다.
3. CDP는 shell main에서 Electron `webContents.debugger`로 붙인다. 바깥 browser(Playwright Chromium, 사람의 Chrome)를 쓰지 않는다. (agent) 사람이 같은 탭을 보고, 앱 preview는 `window.lophnApp` bridge가 있어야 돈다.
4. host queue는 long-poll로 바꾸고 browser 호출은 지금 `tool_call` 결과 길을 같이 쓴다. (사람, 2026-11-09: 1초 poll을 long-poll로)
5. 다루는 탭은 host queue 표에 있는 탭, 곧 `tab open`으로 연 탭뿐이다. 주인(session 또는 사람 token)만 다룬다. 사람이 손으로 연 탭은 표에 없어 다루지 않는다. (agent) `agent-surface.md` "자기가 연 탭만"과 같은 선이다.
6. 앱은 preview만 다룬다. live 화면은 다루지 않는다. (agent) 앱 화면의 operation은 sender view 신원으로 사람 caller가 된다. agent가 live 화면을 누르면 operation 막기(`gate_blocked`)를 사람 신원으로 건너 운영 data를 바꾼다. preview는 일회용 DB다.
7. `agent-platform.md`의 "agent는 앱 화면을 읽거나 조작하지 않는다"는 "자기 앱의 preview를 테스트하려고 다루는 것은 연다"로 고친다. (사람, 2026-11-08: 앱을 CDP로 테스트한다)
8. page에서 온 글은 `<lophn-untrusted>`로 감싼다. (agent) page는 인터넷이다(AGENTS.md "막는 것은 … 인터넷에서 온 것"). GooeyPi도 모든 page 반환을 감싼다.
9. tool 행동은 `act` 하나로 묶는다. (agent) T3 `preview_act`와 같다. help와 skill이 짧아진다.
10. 묻지 않는다. (agent) 비교한 하네스 모두 행동마다 승인을 두지 않는다. 다룰 수 있는 탭을 주인으로 좁힌 것이 경계다.
11. agent가 연 browser 탭도 사람의 browser 탭과 같은 partition을 쓴다. (사람, 2026-11-09: agent 전용 partition 추천을 뒤집음) 사람이 로그인한 dev site와 서비스를 agent가 다시 로그인 없이 쓴다. 대가: page의 글이 agent를 속이면(prompt injection) 사람의 로그인으로 그 site를 건드릴 수 있다. 막는 것은 다룰 수 있는 탭을 주인으로 좁힌 것(정한 것 5)과 untrusted 감싸기(정한 것 8), take control이다. Paseo가 같은 꼴(사람 profile 공유)이다.
12. `evaluate`는 browser 탭에도 준다. (agent, 사람이 뒤집을 수 있음) 비교한 하네스 대부분이 준다. click·type으로 할 수 있는 것보다 넓히는 것은 page 안의 값 읽기·쓰기이고, 11로 같은 로그인을 이미 쓴다.
13. mobile emulation은 shell 본체의 preview 탭에 둔다. 기기 목록은 사람이 등록한 기기뿐이다. (사람, 2026-11-08)

## 단계

| 단계 | 하는 일 |
|---|---|
| 1 | preview 탭, `tab open --preview`, preview annotation |
| 2 | host queue long-poll·`browser_call`·기한, `lophn browser` 명령, 사람 token 열기, untrusted, screenshot, skill |
| 3 | shell main CDP, take control |
| 4 | 기기 등록과 mobile emulation |
| 5 | 실제 폰의 앱(`mobile.md` 뒤) |

## 하지 않는 것

- 사람이 손으로 연 탭, 앱 live 화면, artifact 화면을 agent가 다루기.
- 바깥 browser를 띄우거나 붙기.
- file upload, download, 권한 prompt 답하기, 행동 녹화.
- 일반 기기 표(iPhone·Galaxy 목록), 반응형 검사.
- site allow/block list(`browser-tab.md`와 같다).
