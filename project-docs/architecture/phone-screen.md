# phone-screen

사용자 앱이 폰 앱 안에서 도는 화면(폰 화면)을 갖는 길이다. 앱 agent가 폰 UI kit(`@lophn/ui-native`, `ui-kit.md`)으로 React Native 화면을 쓰고 release하면 core가 그것을 plain JS bundle로 짓고, 폰 앱이 받아 앱 안에 따로 띄운 React Native runtime(guest)에서 돌린다. 화면이 어느 앱·release의 것인지, 무엇을 부를 수 있는지, 무슨 event를 받는지(view binding)는 core가 쥐어 desktop과 폰이 같은 표를 쓴다. agent는 등록된 기준 폰의 크기를 읽어 그리고 desktop preview(web 에뮬레이션)로 확인한다. 앱의 호출 경로와 화면의 신원은 `app-call.md`, 폰 앱 자체와 폰 gate는 `remote.md`가 맡는다.

## 문제

- 사용자 앱은 agent가 짓는 코드다. 폰에서 쓰려면 화면이 폰 앱 안에서 돌아야 하는데, 앱마다 native build를 하면 사람이 앱을 만들 때마다 폰에 새 앱을 깔아야 한다.
- 폰 앱에 받은 코드를 그냥 돌리면 AI가 쓴 화면이 폰 앱의 전역, 보안 저장소, file, network에 닿는다. 화면이 사람의 data를 바깥으로 보내거나 폰 앱을 죽일 수 있다.
- "이 화면이 어느 앱의 어느 release이고 어떤 operation을 부를 수 있나"를 host(desktop shell main, 폰)가 각자 들면 같은 로직이 두 벌이 되고, 화면 page가 낸 값을 신원으로 믿는 틈이 생긴다.
- 폰이 모르는 kit 판이나 약속으로 지은 화면을 돌리면 깨진다. 사람은 왜 안 열리는지 모르고 고칠 곳(폰 앱인지 컴퓨터의 앱인지)도 모른다.
- agent는 폰이 없는 개발 환경에서 폰 화면을 짓는다. 어느 크기로 그려야 하는지, 짠 화면이 돌기는 하는지 볼 길이 없으면 추측으로 그린다.

## 목표와 비목표

- 목표: release한 앱의 폰 화면이 폰 앱에서 네이티브 느낌(scroll, keyboard, gesture)으로 돈다. 화면은 operation 호출과 앱 event로만 data를 받는다. 화면의 오류와 폭주가 폰 앱을 죽이지 않는다. 폰이 못 돌리는 화면은 이유를 말하고 거절한다.
- 목표: agent가 기준 폰의 크기를 읽고 폰 화면을 desktop에서 열어 operation을 눌러 본다.
- 비목표: 폰에서 backend가 도는 앱(`app-sync.md`. 이 문서의 화면은 그 앱의 화면이기도 하고, guest가 backend를 같이 싣는 것은 그 문서가 정한다). 앱 화면 밖의 위젯과 홈 화면 아이콘(`phone-home-screen.md`)과 폰 기능(`remote.md`의 "컴퓨터가 폰에 묻는 길"). iOS(Apple 지침 2.5.2와 4.7을 사람이 Apple에 물어야 정해진다). 실제 폰에서 폰 화면을 확인하는 일(단계 10). 폰 화면을 desktop 탭에 띄우는 것(desktop은 web 화면을 둔다). 한 화면이 desktop과 폰에서 반응하는 것. core가 Hermes bytecode를 만드는 것.
- 비목표: 폰 화면의 쓰기에 앱 operation이 이미 요구하는 것 말고 다른 확인을 더하지 않는다.

## 모델

```
앱 선언: 화면 {key, places: ["phone"], path} ─ 앱 source: 화면마다 React Native 화면 하나
   │ release prepare (core, 신뢰된 build. 앱 code는 묶일 뿐 실행되지 않는다)
   ▼
release bundle: screens/<key>/ { phone.js, phone.json(manifest), index.html + preview.js(desktop preview용) }
   │
   ├─ apps/phone_screens(목록과 manifest) + apps/screen_file(phone.js) ──▶ 폰 앱
   │      폰: 호환 검사 → cache(hash) → guest에서 실행 ◀─ host bridge ─▶ app_views/*(core view 표)
   └─ lophn tab open --preview <app> --screen <key> ──▶ desktop의 react-native-web 에뮬레이션 틀
```

- **`phone` 자리.** 한 화면의 `places`는 `["phone"]` 하나뿐이다. 앱 하나가 desktop 화면과 폰 화면을 같이 갖고 서로 다른 source이며 operation과 data는 하나다. 폰 화면이 있는 앱만 폰의 앱 목록에 든다. 기본 앱 template은 폰 의존이 없고 agent가 폰 화면을 더할 때 의존을 더한다.
- **기준 폰.** 사람이 pairing한 기기 가운데 기준(`primary`) 하나다. agent가 read `apps/phone_target`(CLI `lophn app phone-target`)으로 이름, OS, 크기, DPR을 읽는다. 기기 id와 공개 key는 내지 않는다. 크기는 CSS px의 폰 화면 전체라 lophn의 top bar 아래 쓸 수 있는 높이는 더 작다. 기기가 없으면 `device`가 null이고 agent는 사람에게 pairing을 청한다. 기준 폰이 바뀌면(새로 pairing하거나 기준을 바꾸면) 폰 화면이 있는 앱 수를 notice 한 줄(kind `phone_changed`)로 알린다. 알리기만 하고 다시 그리지 않는다.
- **build.** release prepare가 폰 화면마다 같은 source를 두 번 묶는다. 폰용 `phone.js`는 즉시 실행 함수 하나의 plain JS(es2015, minify, source map 별도, 2 MiB 한도)이고 진입이 평가 전체를 try/catch로 감싸 오류를 guest의 `fatal`로 넘긴다. 화면이 import할 수 있는 bare module은 목록(`PHONE_HOST_MODULES`: `react`, `react/jsx-runtime`, `react-native`, `react-native-svg`, `react-native-safe-area-context`, `lucide-react-native`, `@lophn/ui-native`, `@lophn/app-ui-native`)뿐이고 이것은 build가 external로 두며 폰의 base bundle이 내준다. 이 밖의 bare import는 앱 자기 npm 의존(순수 JS)이면 묶고, desktop용(`react-dom`, `@lophn/ui`, `@lophn/app-ui`), 목록 밖의 `react-native*`·`expo*`, 목록 module의 sub-path, node 내장, staging 밖으로 풀리는 file은 `file:line:column: reason` 한 줄로 실패한다. desktop preview용 `index.html`과 `preview.js`는 react-native-web으로 묶는다. 폰 화면의 선언과 source는 양쪽으로 맞아야 하고(선언했는데 source가 없다, source가 있는데 선언이 없다, 한 key에 desktop 화면 source와 폰 화면 source가 같이 있다) 어긋나면 준비가 실패한다.
- **설치 비용.** 폰 화면이 있는 앱은 kit과 peer(`react-native` 등)와 `react-native-web`을 모두 `devDependencies`에 둔다. 준비가 폰 화면을 지은 뒤 `devDependencies`를 `npm prune --omit=dev`로 빼서 sealed bundle에 backend가 쓰는 의존만 남긴다. 이 앱의 측정: prune 뒤 51 MB·5,440 file, 안 하면 471 MB·45,890 file로 bundle 한도(256 MiB, file 10,000개)를 넘는다. kit을 `dependencies`에 두면 npm이 peer를 production으로 깔아 prune 뒤에도 남으므로 준비가 한 줄 오류로 거절한다.
- **manifest.** 화면마다 `phone.json`이 `phone.js`의 크기와 sha256, 화면이 요구하는 base 판(`PHONE_BASE_FORMAT`), build 때 기댄 kit 판(`@lophn/ui-native`, `@lophn/app-ui-native`), 실제로 require하는 host module 목록을 싣는다. 판은 앱이 pin한 SDK 설치 사본의 판이다.
- **읽기.** read `apps/phone_screens`가 보관하지 않은 앱 중 켜진 release가 있는 앱의 폰 화면을 앱 id 순으로 싣는다(앱 이름, icon, 화면 key와 label, `params` schema, release, bundle hash, manifest, 그 release가 지금 live로 도는지 `running`). manifest가 없거나 틀린 화면은 뺀다(한 화면이 나머지 앱을 막지 않게). 화면 file은 기존 `apps/screen_file`(target live, `phone.js`)로 받는다. 폰만 부르는 route다(actor user).
- **호환(폰 gate).** `phoneCanRun`이 manifest와 폰이 알리는 자기 모양(base 판, 두 kit 판, 폰이 내주는 module 목록)을 견준다. 화면의 base나 kit이 폰보다 새롭거나 폰이 모르는 module을 쓰면 `phone_too_old`(폰 앱을 올려야 한다), kit의 major가 폰보다 작으면 `screen_too_old`(컴퓨터에서 앱을 새 판으로 다시 지어야 한다)이다. 둘 다 해당하면 `phone_too_old`가 앞선다. 같은 major의 옛 판은 돈다. 폰은 화면을 열지 않고 사람에게 각각 "update the lophn app"과 "ask lophn on your computer to update this app"을 말한다.
- **view binding(core).** host(폰, desktop shell main)가 화면마다 불투명한 view id를 만들어 route `app_views/open`으로 열면 core가 `(owner, view)` 한 줄을 메모리에 쥔다. owner는 요청 credential의 principal이다(shell main과 CLI는 `user`, 폰은 `device:<id>`). 한 줄은 앱, 자리, 화면, 인자와 묶인 release·bundle hash·process nonce, 묶인 release가 선언한 구독을 담는다. `app_views/call`은 그 binding으로만 operation을 부르고 `app_views/close`는 지운다. 앱이 도는 release가 바뀌거나 grant가 바뀌면(`AppViewChanged`) 그 앱의 모든 view를 다시 묶어 view마다 `AppViewEvent`(`rebound`나 `lost`)를 내고, 앱 event는 묶인 release가 구독을 선언한 live view에 `AppViewEvent`(`event`)로 간다. 같은 인자의 다시 열기는 지금 binding을 돌려준다(resume: host가 끊겼다 돌아올 때, 표에서 내보내진 view를 되살릴 때). card가 아닌 live view는 도는 release를 따르고 card는 묶인 release에 고정된다. owner마다 64개까지이고 넘으면 가장 오래 쓰지 않은 view를 내보내며 그 view에 `lost(evicted)`를 낸다. `AppViewEvent`는 view를 연 owner의 Gateway 연결에만 간다(`event.md`).
- **폰 gate(연결).** 폰 자격이 부르는 길에는 `apps/phone_screens`, `apps/screen_file`, `app_views/*`와 event `AppViewEvent`만 열려 있다. 앱을 직접 부르는 `apps/call_tool`, grant, 화면 오류를 쓰는 `apps/log_view_error`는 열려 있지 않다. 폰 연결이 닫히면 core가 그 기기의 view를 모두 지운다(그 기기가 새 연결로 먼저 다시 붙었으면 지우지 않는다).
- **guest runtime(폰 앱).** 화면 하나마다 폰 앱 안에 따로 띄운 React Native runtime(`@callstack/react-native-sandbox` 0.7.0이 `ReactHost`와 Hermes를 화면마다 하나씩 만든다)에서 화면이 돈다. 폰 앱은 base bundle을 컴파일해(Hermes bytecode, APK assets) 싣고 앱 시작 때 files 폴더로 꺼내 둔다. base가 React, React Native, kit, 아이콘, `@lophn/app-ui-native`를 갖고 `require`로 host module 목록만 내주며, 화면이 쓰는 `lophnApp`(`place`, `callOperation`, `events.subscribe`. desktop의 같은 이름과 같은 모양이라 같은 hook이 둘 다에서 돈다)을 세운다. 화면 bundle은 plain JS라 base 위에서 `__lophnMount`로 선다. 폰에서 도는 앱(`runs_on`에 `phone`)의 guest는 base, 그 앱의 backend, 화면 bundle을 이 순서로 싣고 host의 `init`에 `local`(operation의 effect 표와 data schema 판)이 실린다. 그러면 화면의 `callOperation`이 read와 write는 guest 안에서 돌리고 `external`만 host로 보내며, guest는 호출이 변경을 commit했다는 `local_change`를 host에 알린다(내용은 싣지 않는다. 변경은 DB의 outbox에 있다). backend가 평가 중 던지면 화면 평가의 예외와 같이 `fatal`이다. 이 길은 `app-sync.md`다. `PHONE_BASE_FORMAT`은 이 때문에 2이고 1로 지은 화면은 2인 폰에서 그대로 돈다. host와 guest는 JSON 메시지(guest가 `ready`·`call`·`fatal`·`local_change`, host가 `init`·`reply`·`event`·`appearance`)만 주고받고 둘 다 계약 schema로 검사한다. 신원은 host가 준 view뿐이다. 메시지가 앱·release·view를 내세워도 버린다. guest는 `init`을 받기 전에는 그리지 않는다.
- **격리.** guest는 host의 JS 전역, Expo module, 보안 저장소, file system에 닿지 않고 network가 없다. 경계는 native module이 없는 것이다: sandbox 자체의 허용 목록에서 `Networking`, `WebSocketModule`, `BlobModule`, `FileReaderModule`, `StatusBarManager`, `LinkingManager`, `DevLoadingView`를 빼고 kit이 쓰는 native module 몇 개만 더 열었고 Expo의 package는 guest에 넘기지 않는다. `fetch`·`XMLHttpRequest`·`WebSocket`·http 이미지는 막혔고 `data:` 이미지는 그려진다. 화면이 죽지 않고 network 오류를 받도록 JS 쪽에서도 같은 실패를 낸다.
- **오류 가두기.** guest의 상태는 `starting` → `running` → `{failed}`이고 실패는 `fatal`(화면 평가·render의 예외나 guest의 fatal), `crashed`(guest runtime 자체가 쓰러졌다), `did_not_start`(10초 안에 `ready`가 없거나 script file이 없다)다. 폰 앱의 release build에서 평가 중 예외(build의 try/catch 안과 밖), 시작 뒤 render 예외, handler의 throw, 8초 busy loop, 300 MB 할당이 모두 앱을 죽이지 않고 화면이 오류 상태로 간다는 것을 emulator에서 보았다. guest를 mount할 때마다 origin이 새로 서서 다시 mount하면 새 runtime과 새 bundle이 쓰인다. 읽을 bundle file이 없으면 loader가 앱 전체를 죽이므로 mount 전에 host가 file을 확인한다.
- **폰의 bundle cache.** 폰은 `phone.js`를 컴퓨터마다 폴더에 bundle hash로 둔다. 같은 hash의 byte는 고정이라 한 번 둔 hash는 다시 받지 않는다. 받으면 크기와 sha256이 manifest와 같을 때만 두고(틀리면 거절한다) 앱마다 가장 새 둘만 남긴다. 목록에서 사라진 앱과 지운 컴퓨터의 bundle은 지운다. 호환 검사는 받기 전에 하므로 폰이 못 돌리는 화면은 받지도 않는다.
- **폰의 앱 화면.** 컴퓨터가 offline이면 앱 이름과 컴퓨터를 말하는 화면, 앱이 컴퓨터에서 안 돌면(멈춤, 보관, live release 없음) 그 화면, 호환 거절 둘, 시작 실패에 Try again이 선다. 컴퓨터가 돌아오거나 앱이 다시 돌면 저절로 열린다. 열려 있는 동안 새 release가 live가 되면(`rebound`) 목록을 다시 읽어 새 bundle로 guest를 새로 띄우고 guest 아래에 "Updated to Release N" 줄을 잠시 보인다. 화면의 ⋯ menu는 앱 workspace에 변경 청하기, 앱의 session, 실행 기록, live release, 앱의 다른 폰 화면, 홈 화면 아이콘 놓기("Add to Home screen")와 위젯 놓기("Add widget")를 보인다. 앱 화면은 알림, 위젯, 홈 화면 아이콘, `lophn://` URL이 여는 open target의 한 곳이다(`phone-home-screen.md`).
- **desktop preview.** `lophn tab open --preview <app> --screen <key> [--device <name>]`이 preview의 release 선언에서 그 화면을 연다. 폰 화면이면 `phone` 자리로, 기준 폰의 크기·DPR·OS로 에뮬레이션한 틀에 연다(기기가 없고 `--device`도 없으면 `conflict`). 화면은 build가 만든 react-native-web 진입이고 `lophnApp`은 desktop 앱 view와 같은 preload가 주며 core가 preview의 operation을 preview bundle의 선언으로 판정해 부른다. react-native-web은 폰이 아니라서 입력, soft keyboard, scroll, 글꼴(preview bundle은 kit의 글꼴 Pretendard를 싣지 않는다), safe area가 다를 수 있다. `react-native-keyboard-controller`와 `expo-clipboard`는 preview에서만 web 대체다. 마지막 확인은 사람이 폰에서 한다.

## 지키는 것

1. view의 신원은 host가 붙인 view id와 요청 credential의 principal뿐이다. 화면 page와 guest가 낸 앱·release·view·caller 값은 신원이 아니고 core도 host도 쓰지 않는다.
2. 화면은 묶인 release(preview는 preview bundle)의 선언에 있는 operation만 부른다. command, 구독 handler, 다른 앱의 이름은 호출 경로까지 가지 않고 같은 `forbidden`이다. 호출 대상과 caller는 core의 binding에서만 온다.
3. 다른 owner의 view는 없는 view와 같다. `AppViewEvent`는 view를 연 owner의 연결에만 가고 owner를 받지 않은 연결에는 가지 않는다. 폰 연결이 닫히면 그 기기의 view가 지워진다.
4. AI가 쓴 폰 화면 code는 release prepare에서 묶일 뿐 core에서 실행되지 않는다. host module 목록 밖의 module과 staging 밖의 file은 build를 실패시킨다.
5. guest는 host의 JS 전역, 보안 저장소, file system, network에 닿지 않는다. guest에 열어 주는 native module에 secret, file, network를 가진 것을 더하지 않는다.
6. guest의 오류, 시작 실패, 폭주가 폰 앱을 죽이지 않는다. 화면은 오류 상태로 가고 사람은 Try again을 한다.
7. 폰은 자기보다 새 base·kit으로 지은 화면과 폰이 모르는 module을 쓰는 화면, 옛 major의 화면을 돌리지 않고 이유를 말한다.
8. 폰의 cache에는 manifest의 크기와 sha256이 맞은 `phone.js`만 남는다.
9. agent는 기준 폰의 기기 id와 공개 key를 보지 못한다.
10. 폰 화면의 쓰기는 앱 operation의 판정(effect, grant)이 이미 요구하는 것만 거치고 폰을 위한 다른 확인 단계를 두지 않는다.

## 경계와 계약

- boundary `app-releases`(폰 화면 build와 manifest), `app-runtime`(core의 view 표), `remote-protocol`(폰 gate), `mobile`(guest runtime과 앱 화면), `design-native`·`sdk`(kit과 hook), `sdk-api`.
- route: `apps/phone_target`(read, user·agent), `apps/phone_screens`(read, user), `apps/screen_file`(기존), `app_views/open|call|close`(memory, user), `tabs/open`의 preview target `{app, device, screen}`. event: `AppViewEvent`(남지 않음, `event`·`rebound`·`lost`), `AppViewChanged`(기존), notice kind `phone_changed`. CLI: `lophn app phone-target`, `lophn tab open --preview <app> --screen <key>`.
- 계약 상수: host module 목록, `PHONE_BASE_FORMAT`(base bundle의 약속이 바뀌면 올린다. 폰 앱 판이 올라가야 한다), manifest `phone.json`, host-guest 메시지, guest 전역 `lophnApp`·`__lophnMount`·`__lophnFatal`. 모두 protocol의 한 file이 고정하고 build, 읽기, 폰 host, guest base가 같은 것을 쓴다.
- SDK part: `@lophn/ui-native`(폰 kit), `@lophn/app-ui-native`(hook `useOperation`·`useEvent`·`usePlace`와 `OperationButton`). 이 part들과 declaration의 판은 `ui-kit.md`의 "앱 SDK 판과 지원 하한"이 정한다. 앱이 pin한 판은 type 검사와 preview에 쓰이고 폰에서는 폰 앱이 가진 base의 판이 돈다.
- 폰 앱에서 화면이 쓰는 `lophnApp`에는 `commands`, `setTabHead`, `setKeepAlive`, `agent`, `sessions`, `agents`, `projects`, `openExternal`이 없다.

## 결정

- 폰 화면은 폰 UI kit으로 쓴 React Native이고 desktop 화면과 다른 source다. 한 화면이 반응하지 않는다. 폰 앱은 앱마다 native build 없이 그 bundle을 받아 돈다. 이유: scroll, keyboard, gesture가 폰다워야 하고 web 화면을 WebView에 넣은 길은 폰답지 않았다(`remote.md`). 앱 하나가 두 화면을 갖고 operation과 data는 하나다. (사람, 2026-11-15)
- `phone`은 `places`에 혼자 선다. 이유: source가 DOM이 아니라 RN이라 desktop 자리와 한 key에 두 program을 두지 않는다. (agent)
- view binding은 core가 쥐고 신원은 host가 붙인다. 이유: desktop과 폰이 같은 로직을 두 벌 들지 않게 하고, page가 낸 값을 신원으로 믿지 않게 한다. 버린 안: host마다 binding을 들기(shell main의 옛 로직을 폰에 다시 쓰는 것). (agent)
- 폰 화면은 폰 앱 안의 따로 띄운 React Native runtime(guest)에서 돌린다. `@callstack/react-native-sandbox`를 spike가 쓴 판으로 고정하고 변경은 fork가 아니라 저장소의 patch로 두어 설치 때 적용한다. 이유: 격리(호스트 전역, 보안 저장소, file system에 닿지 않는다)와 native 느낌(scroll, keyboard, gesture)을 둘 다 얻고 spike에서 실제로 돌았다. 버린 안: react-native-web을 WebView에 그리는 길(native 느낌을 잃는다. roadmap의 fallback으로만 남는다). (agent, spike 판정)
- bundle은 둘로 나눈다. 폰 앱이 컴파일해 싣는 base(React, React Native, kit, 아이콘, hook)와 core가 앱 release마다 esbuild로 짓는 작은 plain JS 화면 bundle. core는 Hermes bytecode를 만들지 않는다. 이유: `hermesc` binary를 core가 들어야 하고, 작은 plain JS는 release build에서 83–117 ms 안에 `running`이 되었다. (agent, spike 판정)
- guest에는 network가 없다. 화면은 data를 operation 호출과 앱 event(둘 다 core를 거친다)로만 받는다. 이유: AI가 쓴 화면이 사람의 data를 바깥으로 내보내는 길을 막는다. http 이미지 URL도 data를 내보내는 길이라 같이 막았다. (agent, spike 판정. 이미지는 구현 중에)
- 폰은 자기보다 새 kit·base로 지은 화면과 옛 major의 화면을 열지 않고 이유를 두 가지 문구로 가른다. 이유: 모르는 약속으로 돌리다 깨지는 것보다 분명히 거절하고, 고칠 곳(폰 앱인지 컴퓨터의 앱인지)이 다르다. 호환 검사는 file을 받기 전에 한다. (agent)
- 화면이 import할 수 있는 module 목록에서 `react-native-reanimated`를 뺀다. 이유: kit이 쓰지 않고 화면은 React Native의 `Animated`를 쓴다. guest의 허용 목록과 preview의 web 대체가 하나 준다. 폰 앱 자신의 의존은 그대로다(kit의 native module은 guest에 열려 있다). 이 목록을 바꾸는 일은 `PHONE_BASE_FORMAT`을 올리고 폰 앱 판이 올라가는 일이다. (agent)
- 설치 비용은 폰 의존을 앱의 `devDependencies`에 두고 준비가 build 뒤 prune하는 안(A)으로 정했다. 이유: 앱 agent가 `tsc`로 폰 화면을 type 검사하고 preview를 짓는 데 kit과 peer가 앱 안에 있어야 하고, prune하면 bundle이 51 MB로 한도 안이다. 버린 안: core가 react-native-web 같은 web 쪽 package를 자기 의존으로 갖고 앱은 type만 설치하는 안(B. core의 의존과 packaging이 늘고 type의 출처가 따로 필요하다). 기본 앱 template은 폰 의존을 갖지 않는다. 이유: 모든 앱이 install 시간과 bundle 크기를 내지 않게 한다. (agent, 측정은 build task)
- `@lophn/app-ui-native`의 hook은 desktop `@lophn/app-ui`의 DOM 없는 file을 그대로 다시 낸다. 이유: 두 SDK가 갈라지지 않고 폰과 preview가 같은 전역 `lophnApp`을 주어 같은 hook이 둘 다에서 돈다. (agent)
- core는 앱 `AppViewChanged`마다 그 앱의 모든 view에 `rebound`를 낸다(binding이 그대로여도). 이유: grant가 바뀌어 binding은 같아도 shell이 화면의 CSP host를 다시 읽어야 할 때가 있다. (agent)
- `AppViewEvent`의 owner 거르기는 Gateway session의 `owner` 옵션 하나로 하고 owner를 주지 않은 session은 이 event를 받지 않는다(기본이 막기). 이유: view를 연 host가 아닌 연결에 다른 host의 화면 event가 가지 않는다. (agent)
- owner의 view는 64개까지이고 넘으면 가장 오래 쓰지 않은 view를 내보내 `lost(evicted)`를 낸다. 이유: core가 shell보다 오래 살아 shell이 다시 뜨면 옛 view가 남는데, 넘칠 때 거절하면 core를 다시 켜기 전까지 새 view를 열 수 없다. 내보낸 view는 host가 같은 인자로 다시 열어 되살린다. (agent)
- card가 아닌 live view의 다시 열기는 release를 신원으로 견주지 않는다. 이유: 그 값은 처음 열 때의 전제(그 release가 돌기를 기대한다)이고 view는 그 뒤 도는 release를 따른다. 그래서 host는 다시 열 때 `release: null`을 보내 core가 view를 잃었어도 지금 도는 release로 다시 연다. card와 preview는 release까지 같아야 한다. (agent)
- 화면의 operation 호출은 preview에서도 core의 `app_views/call`로 가서 preview bundle의 선언으로 판정한다. 이유: 폰 화면을 desktop preview로 확인하려면 눌러서 operation이 불려야 한다. 이전에는 preview 화면이 operation을 부르지 못했다. (agent)
- 폰 gate는 `apps/call_tool`, grant, `apps/log_view_error`를 열지 않고 화면의 호출을 view id로만 받는다. 이유: 부를 operation은 core가 view의 binding으로 판정하므로 입력에 앱을 싣는 직접 호출이 필요 없고, 화면 오류를 쓰는 route는 입력의 앱을 부르는 쪽이 정해서 다른 앱의 log에 쓸 수 있다. 대가: 폰 화면의 오류가 앱 log에 남지 않는다(열린 것). (agent)
- 폰의 `phone.js` cache는 bundle hash로 둔다. 이유: hash가 byte를 고정하므로 한 번 둔 것은 다시 받지 않고, release가 바뀌면 새 hash가 새 file이 된다. 앱마다 둘만 남겨 직전 판이 잠시 필요해도 쓴다. (agent)
- 기준 폰이 바뀔 때만 사람에게 알린다. 이유: 옛 크기로 그린 폰 화면을 다시 그려야 하기 때문이다. 알리기만 하고 자동으로 다시 그리지 않는다(agent가 하는 일이라 사람이 맡긴다). (agent)
- preview에서 폰 화면은 기준 폰(없으면 `--device`)의 틀에만 연다. 이유: 넓은 틀에 폰 화면을 그려 잘못 믿게 하지 않는다. (agent)
- `react-native-keyboard-controller`와 `expo-clipboard`는 preview에서만 web stub이다. 이유: 같은 화면 source가 desktop에서 확인되어야 agent가 폰 없이 고친다. 입력 focus를 web build에서 믿지 못했고 desktop preview에는 키보드가 없다. 폰에서는 진짜 module이 돈다. (agent)
- Android를 먼저 짓는다. iOS는 내려받은 code로 앱 기능을 바꾸는 것(Apple 지침 2.5.2)과 JavaScript mini app(4.7)에 맞는지 사람이 Apple에 물어야 정해진다. (사람이 할 일)

## 열린 것

- 이 설계를 실제 Electron desktop 앱에서 보지 못했다: core view 표를 거쳐 desktop 창에서 앱 화면을 열고 operation을 부르는 것, release가 바뀔 때 다시 띄우는 것, 폰 화면을 가진 preview 탭은 type 검사와 test와 headless Chrome으로만 보았다. 폰 쪽은 emulator에서 개발 core에 손으로 지은 앱을 붙여 보았고 실제 agent turn으로 만든 앱이나 실제 폰으로 보지 못했다. iOS는 짓지 않았다.
- guest 하나가 mount와 unmount를 되풀이하면 PSS가 한 번에 약 2 MB씩 남는다(원인을 찾지 못했다). 이슈 `phone-guest-memory-grows-per-remount`.
- guest는 kit의 Sheet가 쓰는 `Modal`로 앱 전체를 덮을 수 있다. 이슈 `phone-guest-can-cover-app`. status bar는 guest에서 닿지 않는다(base가 `StatusBar`를 stub으로 바꾼다).
- guest에 남은 native module 가운데 `KeyboardController`(keyboard mode 바꾸기·닫기)와 `I18nManager.forceRTL`(앱 전체의 RTL 설정)은 밖으로 나가는 길은 아니지만 앱 전체에 닿는다. 링크 열기·공유·clipboard는 guest에 없다(debug lab build의 probe로 확인. release는 돌리지 않았다).
- 폰 화면의 오류가 앱 log에 남지 않는다(위 폰 gate 결정). view에 묶인 route가 필요하다. 이슈 `phone-screen-errors-not-in-app-log`.
- debug build(dev client)에서는 dev menu의 전체 화면 view 때문에 손가락 입력이 guest에 닿지 않는다. 손가락 확인은 release build에서 한다.
- soft keyboard가 뜨면 guest는 줄어들지 않아 화면 아래의 입력란을 가릴 수 있다. event listener 안의 throw는 sandbox가 log만 남기고 삼켜 화면이 계속 돌고, 처리되지 않은 promise rejection은 아무 일도 없다. busy loop는 guest의 JS thread만 막는다. 300 MB 할당은 견뎠지만 Hermes heap이나 기기 memory가 모자라면 process가 끝날 수 있다(재지 않았다).
- preview 번들이 kit의 글꼴을 싣지 않아 글자 모양이 폰과 다르다(이슈 `phone-preview-lacks-kit-font`). kit의 `Button` `sm`·`md`는 touch 대상 44 dp보다 작고(`phone-kit-button-under-touch-target`) `TopBar`는 기본으로 sidebar 단추를 보인다(`phone-kit-topbar-shows-menu-by-default`). 지침이 agent에게 넘길 값을 말한다.
- 사람이 [Preview]로 연 preview 탭은 화면을 고르지 못하고 앱의 첫 `tab` 화면만 연다(이슈 `preview-tab-has-no-screen-picker`).
- 폰 화면의 ⋯ menu에 wireframe의 What changed, Annotate this screen과 Home의 New app이 없다(이슈 `phone-apps-menu-lacks-wireframe-rows`).
- 폰 data 층의 읽기가 간헐적으로 비는 현상을 한 번 보았다(이슈 `phone-open-url-blank-workspace`).
