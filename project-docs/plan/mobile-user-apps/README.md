# mobile-user-apps: lophn agent가 사람의 앱에 폰 화면을 짓고, 폰 앱이 그것을 띄운다

- 목표: 앱 선언에 `phone` 자리를 더하고, 앱 agent가 폰 UI kit(React Native)으로 쓴 폰 화면을 release하면 폰 앱이 그 화면을 받아 돌린다. 화면이 어느 앱·release의 것인지, 어떤 operation을 부를 수 있는지, 어떤 event를 받는지(view binding)는 core가 쥐어 desktop과 폰이 같은 로직을 따로 들지 않는다. agent는 등록한 기준 폰의 크기를 읽고, desktop preview로 자기가 쓴 폰 화면을 확인한다.
- 재료: `project-docs/products/roadmap/mobile.md`("사용자 앱을 폰에 띄우기", 단계 6, 진행), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/app-place-survey.md`, spike 보고서 `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`(판정. 그림은 같은 폴더), `project-docs/architecture/{app-call,remote,ui-kit,browser-tab,event}.md`, `project-docs/issues/preview-screen-cannot-call-operation.yaml`.
- 범위 밖: 폰에서 backend가 도는 앱(단계 7), 위젯·홈 화면 아이콘·폰 기능(단계 8), iOS(아래 "사람이 할 것"), 폰 화면의 실제 폰 확인(단계 10. 이 계획의 확인은 emulator의 guest runtime과 desktop preview까지), 폰 화면을 desktop 탭에 띄우기(roadmap은 desktop에 web 화면을 둔다), react-native-web WebView 길(roadmap이 이름 붙인 fallback으로만 남는다), Hermes bytecode를 core에서 만들기.
- 단위: `app-place`(선언의 `phone` 자리, agent가 읽는 기준 폰), `app-views`(view binding을 core로, shell main을 그 위로), `phone-screen`(폰 화면의 계약, 빌드, 읽기, desktop preview, 기준 폰이 바뀔 때의 notice), `phone-sdk`(kit과 hook을 SDK part로), `phone-host`(폰 gate, 폰의 guest runtime, 폰 앱의 앱 화면), `app-guidance`(agent 지침). 소유 path는 brief가 정한다.
- 순서(wave는 "앞 wave가 모두 merged"일 때 열린다. 소유가 겹치는 것은 brief의 "선행"이 순서를 정한다):
  - wave 1(끝났거나 도는 중): `mobile-place-decl`, `mobile-views-core`, `mobile-phone-target`.
  - wave 2: `mobile-shell-views`(shell main이 core의 view binding을 쓰게 하고 옛 로직을 지운다), `mobile-phone-contract`(폰 화면의 계약을 먼저 고정한다. 둘은 서로 기대지 않는다).
  - wave 3: `mobile-build-phone`(opus high. 폰 화면 build와 설치 비용).
  - wave 4: `mobile-phone-reads`와 `mobile-phone-changed-notice`(서로 기대지 않는다. `mobile-app` land와 상관없다).
  - **여기까지는 `mobile-app` 계획이 main에 올라가기 전에 돌릴 수 있다**(`packages/mobile`, `packages/design/native`, `packages/protocol/remote/allowlist.ts`, `packages/core/remote`를 건드리지 않는다). 아래는 모두 `mobile-app`이 main에 land된 뒤에 띄운다.
  - wave 5: `mobile-sdk-kit`, 이어서 `mobile-sdk-phone-hooks`(kit 뒤. `packages/design/native`와 kit을 쓰는 새 part).
  - wave 6: `mobile-preview-phone`(desktop preview), `mobile-remote-gate`(폰 gate. allowlist와 `packages/core/remote`), `mobile-phone-guest`(opus high. 폰 앱의 guest runtime. `packages/mobile`). 서로 path가 겹치지 않아 나란히 돈다.
  - wave 7: `mobile-phone-apps`(폰 앱의 앱 화면. guest와 gate 뒤), `mobile-agent-guidance`(agent 지침. 도구가 다 선 뒤).
  - land는 계획 끝에 한 번. 그래서 SDK 판(declaration 4.6.0, app-ui 2.15.0, ui-native 0.1.0, app-ui-native 1.0.0)은 land 전까지 어느 앱에도 가지 않고, 뒤 task가 같은 판 안에서 guide와 메모를 고칠 수 있다.

## 정한 것

- 사용자 앱의 폰 화면은 폰 UI kit으로 쓴 React Native이고, 폰 앱은 앱마다 native build 없이 그 bundle을 받아 돌린다(사람, 2026-11-15). desktop 화면과 폰 화면은 서로 다른 source file이다. 한 화면이 반응하지 않는다. 앱 하나가 두 화면을 갖고 operation과 data는 하나다.
- `phone`은 한 화면의 `places`에 혼자 선다(`["phone"]`). 이유: source가 DOM이 아니라 RN이라 desktop 자리와 한 key에 두 program을 두지 않는다.
- view binding(어느 앱·release의 view인지, 부를 operation, 받을 event, release가 바뀔 때 다시 묶기)은 core가 쥔다. 신원은 host가 붙인다. page가 낸 값은 신원이 아니다. 이유: desktop과 폰이 같은 로직을 두 벌 들지 않게 한다.
- 기본 앱 template은 폰 의존을 갖지 않는다. agent가 폰 화면을 더할 때 의존을 더한다. 이유: 모든 앱이 install 시간과 bundle 크기를 내지 않게 한다.
- 사람에게는 기준 폰이 바뀔 때만 알린다(옛 크기로 그린 폰 화면을 다시 그려야 해서). 폰 화면의 쓰기에는 앱 operation이 이미 요구하는 것 말고 다른 확인을 더하지 않는다.
- agent는 등록된 기준 폰을 read route로 읽고(`apps/phone_target`), 자기가 쓴 폰 화면은 desktop preview(react-native-web)로 확인한다. 실제 폰 확인은 단계 10이다.
- (spike 판정, planner 2026-11-15)
  - 사용자 앱의 폰 화면은 폰 앱 안의 따로 띄운 React Native runtime(guest)에서 돈다. `@callstack/react-native-sandbox`를 spike가 쓴 판(0.7.0)에 고정하고 spike의 변경 넷은 fork가 아니라 저장소의 patch로 두어 설치 때 적용한다. 이유: 격리(호스트 전역, secure store, file system에 닿지 않는다)와 native 느낌(scroll, keyboard, gesture)을 둘 다 얻고, spike에서 실제로 돌았다. react-native-web WebView 길은 짓지 않고 roadmap의 fallback으로만 남는다(native 느낌을 잃는다).
  - bundle은 둘로 나눈다. 폰 앱이 컴파일해 싣는 base(React, React Native, kit, 아이콘, `@lophn/app-ui-native`)와, core가 앱 릴리스마다 esbuild로 만드는 작은 plain JS 화면 bundle(kit·React·React Native는 external, base가 준다). core는 Hermes bytecode를 만들지 않는다. 이유: `hermesc` binary를 core가 들어야 하고, 작은 화면 bundle은 plain JS로도 충분히 빠르게 읽힌다(`mobile-phone-guest`가 release build에서 재고 틀리면 되돌린다).
  - guest에는 network가 없다. `fetch`와 `Networking` 등을 끈다. 화면은 데이터를 bridge(operation 호출과 event, 둘 다 core를 거친다)로만 받는다(desktop 앱 화면과 같은 규칙). 이유: AI가 쓴 화면이 사람의 data를 바깥으로 보내는 길을 막는다.
  - guest의 오류가 폰 앱을 죽이면 안 된다. host가 load와 render 실패를 잡아 앱의 오류 상태를 보인다. spike는 guest 예외가 debug build에서 host process까지 닿는 것을 봤고 release build는 보지 않았다. 그래서 `mobile-phone-guest`가 release build에서 확인하는 것이 주된 위험 test다. 안 가둬지면 이 길을 접고 fallback으로 가는 결정은 사람과 planner가 한다.
  - 폰이 가진 kit 판과 화면이 기댄 kit 판이 호환이어야 한다. 화면 manifest(`phone.json`)가 kit과 `@lophn/app-ui-native` 판을 싣고, 폰은 자기보다 새 kit으로 지은 화면을 열지 않고 "update the lophn app"을 말한다(옛 major로 지은 화면에는 "ask lophn on your computer to update this app"). 이유: 모르는 약속으로 화면을 돌리다 깨지는 것보다 분명히 거절한다.
  - Android를 먼저 한다. iOS(Apple 지침 2.5.2와 4.7)는 사람과 Apple이 정해야 해서 task가 없다.
  - desktop preview는 react-native-web이고 spike가 찾은 shim 넷을 쓴다. `react-native-keyboard-controller`와 `expo-clipboard`는 preview에서만 web stub이다. 이유: 같은 화면 source가 desktop에서 확인되어야 agent가 폰 없이 고친다.
  - 어려운 task(폰의 guest runtime `mobile-phone-guest`, 폰 화면 build `mobile-build-phone`)는 opus high로 돌린다. 나머지는 sonnet-high다.
- (agent) spike 판정 뒤 task를 자르며 정한 것:
  - 계약 task(`mobile-phone-contract`)를 먼저 둔다: 화면이 import할 수 있는 module 목록, manifest, 호환 검사, host와 guest의 메시지, 전역 이름. build, 읽기, SDK part, 폰 host가 모두 이것 하나에 기대서 나란히 갈 수 있다.
  - `@lophn/app-ui-native`는 base bundle에 들어간다(external). 화면 bundle은 hook을 들고 있지 않고, 앱이 pin한 판은 type 검사와 desktop preview에 쓰인다. 폰에는 `lophnApp`이 desktop과 같은 이름으로 서 있어 같은 hook이 둘 다에서 돈다.
  - desktop preview의 bridge는 새로 만들지 않는다. preview 화면은 desktop 앱 view와 같은 preload의 `lophnApp`을 쓰고 `place`가 `phone`일 뿐이다(`mobile-shell-views`가 core binding을 쓰게 한 덕분이고 core가 preview operation을 판정한다).
  - 폰 앱의 일을 둘로 나눴다. native/보안 쪽 `mobile-phone-guest`(opus high)와 앱 목록·앱 화면·cache·상태 쪽 `mobile-phone-apps`(sonnet). 한 session에 다 끝나지 않는 크기이고 위험이 앞의 것에 몰려 있다.
  - 기준 폰 notice(`mobile-phone-changed-notice`)는 core와 desktop Inbox만 고친다. 폰 Inbox는 desktop과 같은 notice 코드를 쓴다.
  - (lead, `mobile-phone-contract` review) 화면이 import할 수 있는 module 목록(`PHONE_HOST_MODULES`)에서 `react-native-reanimated`를 뺐다. kit이 쓰지 않고 화면은 React Native의 `Animated`를 쓴다. guest의 허용 목록과 preview의 web 대체가 하나 준다. 폰 앱 자신의 의존은 그대로다.
- worker는 `sonnet-high`로 띄운다(사람). 위에서 opus high로 정한 둘은 예외다(planner, 2026-11-15).
- (agent) survey와 다르게 정한 것:
  - `@lophn/app-ui`도 판을 올린다(2.15.0). 이 SDK가 `@lophn/declaration`을 정확한 판으로 의존해(`packages/sdk/app-ui/package.json`) declaration만 올리면 `npm ci`가 깨진다. survey는 "bump 없음"이라 했다.
  - `AppViewEvent`의 owner 거르기는 Gateway session의 `owner` 옵션 하나로 한다(`mobile-views-core`). owner를 주지 않은 session은 `AppViewEvent`를 받지 않는다(기본이 막기). 폰 host는 뒤 task가 같은 옵션에 기기 principal을 준다.
  - core는 앱 `AppViewChanged`마다 그 앱의 모든 view에 `rebound`를 낸다(binding이 같아도). grant가 바뀌어 같은 binding이지만 shell이 CSP host를 다시 읽어야 하는 경우가 있어서다. survey는 binding이 바뀐 때만이라 했다.
  - core view 표는 owner당 64개를 넘으면 가장 오래 안 쓴 view를 내보낸다(`lost`, `evicted`). core가 shell보다 오래 살아 shell이 다시 뜨면 옛 view가 남는다. survey의 "64개면 conflict"는 core 재시작까지 막힌다.
  - `app_views/call`이 preview view의 operation도 preview bundle 선언으로 판정해 부른다. 이슈 `preview-screen-cannot-call-operation`이 닫힌다. 폰 화면을 preview로 확인하려면 필요하다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-place-decl` | `phone` 자리와 혼자 서는 규칙, 같은 literal이 적힌 아홉 곳, `@lophn/declaration` 4.6.0과 `@lophn/app-ui` 2.15.0(메모, pin) |
| 1 | `mobile-views-core` | core의 view 표와 `app_views/{open,call,close}`, `AppViewEvent`, Gateway owner 거르기, release가 바뀔 때 다시 묶기 |
| 1 | `mobile-phone-target` | agent가 기준 폰의 크기·DPR·OS를 읽는 `apps/phone_target`과 `lophn app phone-target` |
| 2 | `mobile-shell-views` | shell main이 연결·호출·event·다시 묶기를 core `app_views/*`로 바꾸고 옛 로직과 test를 지운다 |
| 2 | `mobile-phone-contract` | 폰 화면의 계약: host module 목록, manifest `phone.json`과 호환 검사, host-guest 메시지, 전역 이름, `apps/phone_screens` route 모양 |
| 3 | `mobile-build-phone` | 폰 화면 build: `phone.tsx`에서 plain JS `phone.js`와 manifest, desktop preview 진입(react-native-web), 선언과의 양쪽 대조, 설치 비용 측정과 결정 (opus high) |
| 4 | `mobile-phone-reads` | `apps/phone_screens`의 handler: 켜진 release의 폰 화면과 manifest와 running 상태를 한 번에 |
| 4 | `mobile-phone-changed-notice` | 기준 폰이 바뀌면 폰 화면이 있는 앱 수를 알리는 notice kind `phone_changed` |
| 5 | `mobile-sdk-kit` | 폰 kit을 SDK part `@lophn/ui-native` 0.1.0으로 등록(vendor 규칙, `@lophn/ui` 사본에서 분리, guide, 첫 판 메모). `mobile-app` land 뒤 |
| 5 | `mobile-sdk-phone-hooks` | 새 SDK part `@lophn/app-ui-native` 1.0.0: `useOperation`·`useEvent`·`usePlace`(app-ui의 file을 vendor)와 RN `OperationButton`. `mobile-app` land 뒤 |
| 6 | `mobile-preview-phone` | `lophn tab open --preview <app> --screen <key>`가 폰 화면을 기준 폰 틀로 열고, 진짜 kit 화면이 desktop preview에서 도는 것까지 end-to-end 확인. `mobile-host-link` 뒤 |
| 6 | `mobile-remote-gate` | 폰 gate: `app_views/*`·`apps/phone_screens`·`apps/screen_file`·`AppViewEvent`를 폰 자격에 열고 기기 owner로 거르기, 연결이 닫히면 view 지우기. `mobile-app` land 뒤 |
| 6 | `mobile-phone-guest` | 폰 앱의 guest runtime(Android): sandbox 고정과 patch, base bundle, network 끈 허용 목록, host bridge, guest 오류 가두기를 release build에서 확인. emulator 5596, Metro 8236 (opus high). `mobile-app` land 뒤 |
| 7 | `mobile-phone-apps` | 폰 앱의 앱 화면: 입구, 화면 bundle cache와 hash·호환 검사, `app_views/*`와 앱 event, 새 판·컴퓨터 없음·호환 거절 상태. emulator 5598, Metro 8238. `mobile-app` land 뒤 |
| 7 | `mobile-agent-guidance` | `design-app`의 "Phone screens", `AGENTS.md.tmpl`·template test·build script, app prompt, SDK guide, `declaration-4.6.0.md`의 Instruction diff |

## 돌리기 전에

- wave 1~4는 `mobile-app`이 쓰는 path(`packages/mobile`, `packages/design/native`, `packages/protocol/remote/allowlist.ts`, `packages/core/remote`)를 건드리지 않아 `mobile-app`이 land되기 전에 돌린다. wave 5 이후는 모두 land된 뒤에 띄운다(위 "순서").
- 다른 계획과 같은 file을 만지는 곳(lead가 합칠 때 두 쪽을 다 남긴다):
  - `packages/protocol/events/transient.ts`: `mobile-views-core`가 event 하나를 더했다. `mobile-push`의 `mobile-attention-core`가 이 file을 소유하고 `mobile-coding-agents`의 `mobile-terminal-core`도 event를 더한다. 모두 더하기만이라 먼저 merge된 쪽에 나중 쪽이 rebase한다.
  - `package-lock.json`(`mobile-place-decl`, `mobile-sdk-phone-hooks`의 workspace 항목). 충돌하면 lead가 `npm install --package-lock-only`로 다시 만든다. `packages/mobile/package-lock.json`은 `mobile-phone-guest`가 고친다(`mobile-push-phone`도 고친다. 아래).
  - `project-docs/flows/`(`areas/*.yaml`, `areas.yaml`, `tests/*.yaml`): 모든 task가 자기 입구와 test file의 줄을 더한다. 충돌은 lead가 푼다.
  - `packages/protocol/apps/{mod.ts,registry.ts}`, `packages/core/apps/register.ts`, `packages/core/main/daemon/wiring/apps.ts`: task마다 자기 route와 handler 줄만 더한다(brief가 줄을 허락한다).
  - `packages/core/apps/packages/vendor.ts`: `mobile-sdk-kit`이 고치고 `mobile-sdk-phone-hooks`가 한 줄을 더한다(선행으로 순서가 정해져 있다).
- `mobile-coding-agents`와 겹쳐 순서가 정해지는 것(그 계획의 `tasks/`를 읽어 확인했다):
  - `mobile-preview-phone`이 `packages/protocol/lophn-agent/host-queue.ts`, `packages/core/host-queue`, `packages/core/main/daemon/wiring/host-queue.ts`를 고친다. 이 file들을 `mobile-host-link`(그 계획 wave 1)가 소유하고 `mobile-host-link-cleanup`(wave 5)도 고친다. `mobile-host-link`가 merge된 뒤에 `mobile-preview-phone`을 띄우고, cleanup과는 늦은 쪽이 rebase한다.
  - `mobile-terminal-device-grant`가 `packages/core/remote/devices.ts`, `wiring/remote.ts`, `packages/protocol/remote/routes.ts`를 소유한다. `mobile-remote-gate`가 `wiring/remote.ts`와 `core/remote/host.ts`를 고치므로 running이면 끝난 뒤에 띄운다.
  - `mobile-terminal-phone`·`mobile-coding-phone-data`가 `packages/protocol/remote/allowlist.ts`와 `packages/mobile`을 고친다. `mobile-remote-gate`와 `mobile-phone-guest`·`mobile-phone-apps`와 file이 겹치니 running이면 끝난 뒤에 띄운다(`status.py ready`가 소유 겹침으로 막는다).
  - `mobile-shell-views`는 `desktop/wiring/context.ts`를 고치지 않는다(`mobile-host-link-shell`의 것).
- `mobile-push`와 겹쳐 순서가 정해지는 것: `mobile-push-device`가 `packages/core/remote/**`, `protocol/remote/{routes,allowlist}.ts`, `wiring/remote.ts`를 소유한다(`mobile-remote-gate`와 겹친다). `mobile-push-phone`이 `packages/mobile/{package.json,app.json}`와 native build를 고친다(`mobile-phone-guest`와 겹친다. 같은 파일을 두 native 작업이 동시에 고치지 않게 하나가 끝난 뒤에 다른 것을 띄운다). `mobile-phone-changed-notice`가 고치는 notice 쪽 file(`protocol/apps/notice.ts`, `core/apps/notices`, `shell/renderer/desktop/connection/waiting`)은 `mobile-push`의 `mobile-attention-desktop`이 `shell/renderer/desktop/connection/{events,waiting}`를 소유하므로 겹치면 먼저 merge된 쪽에 나중 쪽이 rebase한다.
- 띄우기 전에 lead가 한다:
  - `mobile-phone-apps` 전에 `packages/design/i18n/catalog/mobile-apps.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린다(`mobile-app`이 한 것과 같은 길).
  - `mobile-phone-apps`에 `mobile-phone-guest`가 지은 dev build APK의 경로를 알린다(native module을 더하지 않는다).
  - `mobile-sdk-kit` 전에 (선택) `packages/core/apps/packages/vendor.ts`의 `design` skip에 `native`를 한 줄 더해 `mobile-app` land에 같이 올릴 수 있다. 안 하면 두 land 사이에 개발 data root의 `@lophn/ui` 1.1.0 사본에 `native/`가 섞이지만(core가 시작할 때 `installCopy`가 다시 쓴다) 앱의 sealed bundle은 영향이 없다.
  - `mobile-build-phone`의 보고에 새 core 의존(`react-native-web` 등)이 있으면 root `package.json`에 정확한 판으로 등록하고 `tools/package`에서 설치본에 들어가는지 확인한다.
- ledger schema step과 새 core wiring은 이 계획에 없다(메모리 route와 읽기, 메모리 상태뿐). 생기면 lead가 등록한다(`mobile-views-core`·`mobile-remote-gate`·`mobile-phone-changed-notice`가 필요해 보이면 보고한다).
- emulator: `mobile-phone-guest`는 port 5596(Metro 8236), `mobile-phone-apps`는 port 5598(Metro 8238)을 쓴다(`mobile-app`의 5562~5574, `mobile-push`의 5580·8220, `mobile-coding-agents`의 5590~5594와 겹치지 않는다). AVD `lophn-phone`을 `-read-only`로 여럿이 쓴다. worker는 모든 adb 명령에 `-s emulator-<port>`를 붙이고 끝나면 `adb -s emulator-<port> emu kill`로 끈다. gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`. `pkill`·`killall`과 process를 `ps`로 찾아 죽이는 일은 하지 않는다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.
- 개발 core는 `packages/mobile/README.md`의 `tools/remote-dev.ts` 길을 쓴다. 사람의 `~/.lophn`, 실제 relay(`wss://lophn-relay.fly.dev`), 실제 model provider를 쓰지 않는다(앱의 폰 화면 source는 worker가 손으로 쓴다).

## 사람이 할 것

- iOS: 폰 화면을 내려받아 도는 길이 Apple 지침 2.5.2(내려받은 코드로 앱 기능을 바꾸기)와 4.7(JavaScript mini app·plug-in, 4.7.2는 native API를 내주는 데 Apple의 사전 허락)에 맞는지는 사람이 Apple에 물어야 정해진다(spike 보고서 "7. Store policy", App Review pre-submission이나 developer support 질문). 그 답과 Apple Developer 계정이 있는 뒤에 iOS를 여는 계획을 따로 연다. 이 계획은 Android만 짓는다.
- 그 밖에 계정, key, 비용이 드는 일은 없다. 실제 폰에서 폰 화면을 처음 확인하는 것은 단계 10(실제 폰의 browser-use) 전에 사람이 dev build를 깔아 보는 일이고, 깔기 전에 planner에게 묻는다.

## lead가 할 일

- merge 때마다: `npm run check`. `packages/mobile`을 고친 task(`mobile-phone-guest`, `mobile-phone-apps`)는 `cd packages/mobile && npm run typecheck && npm test`도, worker가 남긴 emulator 그림(`.dev-data/<task>/shots/`)을 wireframe 그림과 대조한다. 어긋나면 같은 worker에게 돌려보낸다.
- `mobile-views-core` merge 뒤: 이슈 `preview-screen-cannot-call-operation`을 닫는다(`issue` skill). `mobile-shell-views` merge 뒤 shell에서 desktop 앱 화면이 열리고 operation이 불리는지 `npm run dev`로 한 번 본다.
- `mobile-build-phone` merge 뒤: 보고의 설치 비용 안(어느 안을 골랐나, 숫자)을 읽고 `mobile-sdk-kit`·`mobile-agent-guidance`가 따를 것인지 확인한다. 안이 사람의 일(앱 template의 기본 의존을 늘려야 한다 등)을 요구하면 planner에게 올린다.
- `mobile-phone-guest` merge 뒤: 보고의 release build 오류 가두기 결과를 읽는다. **가둬지지 않으면 `mobile-phone-apps`를 띄우지 말고 planner에게 올린다**(fallback 결정). 가둬지면 dev build(x86_64)를 한 번 지어 `mobile-phone-apps` worker에게 APK 경로를 알린다.
- 끝에: `architecture/{app-call,remote,ui-kit,browser-tab,workspace-layout,event}.md`와 새 문서가 필요하면 `architecture/phone-screen.md`(view binding이 core로, `phone` 자리, 폰 화면의 build·bundle·manifest·호환, guest runtime과 허용 목록, `app_views/*`, 기기 owner 거르기, 폰 gate), `boundary-catalog.yaml`·`module-catalog.yaml`(`design/native`의 SDK part, `sdk/app-ui-native`), `project-docs/flows/`(`flows` skill), roadmap `mobile.md` 단계 6, `sdk-note`(declaration 4.6.0, app-ui 2.15.0, ui-native 0.1.0, app-ui-native 1.0.0과 `supported_from`), change-log `0.23/mobile-user-apps.yaml`(실제 폰 확인은 단계 10이라는 것, desktop preview는 web 에뮬레이션이라는 것, iOS는 열지 않았다는 것을 적는다), 이슈 정리(`wrap-plan`). 실제 폰에 새 build를 까는 것은 사람에게 묻는다.
