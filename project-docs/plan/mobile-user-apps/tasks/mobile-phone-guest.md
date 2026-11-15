# mobile-phone-guest

폰 앱 안에 사용자 앱의 폰 화면을 따로 띄운 React Native runtime(guest)에서 돌리는 길을 Android에 짓는다: `@callstack/react-native-sandbox`(spike가 쓴 판 0.7.0 고정)와 spike의 네 변경을 patch로 저장소에 두고 설치 때 적용한다(fork 없음), 폰 앱이 컴파일해 싣는 base bundle(React, React Native, kit, 아이콘, `@lophn/app-ui-native`), guest에 network를 끈 허용 목록, host 쪽 bridge, guest가 죽어도 폰 앱이 죽지 않게 가두는 장치. 이 task의 주된 위험은 마지막이다: spike는 guest의 예외가 debug build에서 host process까지 닿는 것을 봤고 release build는 보지 않았다. 이 task는 release build에서 확인하고, 안 되면 patch로 막는다. opus high로 돌린다.

- 단위: phone-host (wave 6)
- 선행: mobile-phone-contract, mobile-sdk-kit, mobile-sdk-phone-hooks, mobile-build-phone. **`mobile-app` 계획이 main에 land된 뒤에 띄운다**(`packages/mobile`과 kit이 그 계획의 것이다). `mobile-push`의 `mobile-push-phone`(같은 `packages/mobile/{package.json,app.json}`와 native build를 고친다)이 running이면 끝난 뒤에 띄운다
- 소유(이 task만 고친다):
  - `packages/mobile/src/apps/guest`(새 폴더: host component, bridge host, 상태, 허용 목록, test)
  - `packages/mobile/guest`(새 폴더: base bundle 진입과 build script, fixture 화면, 개발용 lab)
  - `packages/mobile/plugins`(새 폴더: Expo config plugin)
  - `packages/mobile/patches`(새 폴더: patch file)
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
  - `packages/mobile/app.json`
  - `packages/mobile/metro.config.js`
  - `packages/mobile/tsconfig.json`
  - `packages/mobile/README.md`
- 읽을 것:
  - 판정과 실험 code(읽기만. 거기서 가져오는 것은 옮겨 쓰고 이 task의 file로 만든다): `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md` 전부(특히 "Verdict", "1~4", "Recommended architecture", "Unverified"), `/home/pyosechang/projects/lophn-worktrees/spike-app-screens/mobile/guest/{base.ts,bridge.ts,probe.ts,screen-*.tsx,build.sh,esb.sh,react-native-sandbox-0.7.0.patch}`와 `mobile/src/spike/spike-screen.tsx`(`SandboxReactNativeView`의 props: `origin`, `componentName`, `jsBundleSource`, `allowedTurboModules`, `onMessage`, `ref.postMessage`). 이 계획 `README.md`의 "정한 것"(spike 판정 1~8)이 이 task의 기준이다
  - 계약: `packages/protocol/apps/phone-screen.ts`(`PHONE_HOST_MODULES`, 메시지 schema, `phoneCanRun`, 전역 이름)
  - 폰 앱: `packages/mobile/README.md`(emulator, Metro, prebuild, gradle), `metro.config.js`(`@lophn/ui-native` alias), `app.json`, `src/data/link.ts`(컴퓨터마다 `CoreSource`가 있다. 이 task는 그것을 직접 쓰지 않고 host component가 받는 함수로 주입한다)
  - kit: `packages/design/native/mod.ts`, hook: `packages/sdk/app-ui-native/mod.ts`
  - 화면 bundle을 만드는 쪽: `mobile-build-phone`의 보고와 `packages/core/apps/releases/ui-build/phone/`(fixture 화면을 core의 build와 같은 규칙으로 만들 수 있는 함수. 그 함수를 직접 쓰거나, 없으면 esbuild를 보고에 적힌 같은 옵션으로 돌린다)
  - 규칙: 이 파일의 아래 "Android 확인 규칙"
- 계약:
  - 쓰는 것: 위 계약 file과 SDK part 둘. `lophnApp`의 모양과 메시지는 고치지 않는다(바꿔야 하면 고치지 말고 보고한다)
  - 내놓는 것(`mobile-phone-apps`가 쓴다): `packages/mobile/src/apps/guest/mod.ts`가 내는 것
    - `GuestScreen`: props `{view: string(host가 만든 id), screenFile: string(내려받아 hash를 확인한 `phone.js`의 경로), place, scheme, locale, call(operation, input): Promise<outcome>, subscribe(listener): () => void(앱 event: `{source, event, payload}`), onState(state)}`. `state`는 `starting | running | {failed: reason}`이고 reason은 `did_not_start`(10 s 안에 `ready`가 없다), `fatal`(guest의 `fatal` 메시지나 native 오류), `crashed`다. 호스트는 `key`를 바꿔 다시 띄운다(replace-in-place에 기대지 않는다)
    - `guestHostInfo()`: `phoneCanRun`의 `host`(base 판, kit 판, app-ui-native 판, 모듈 목록)
    - `ensureBase()`: 폰 앱 안의 base bundle을 files 폴더로 꺼내 둔다(앱 판이 바뀌면 다시)
    - 개발용 lab 화면은 `EXPO_PUBLIC_LOPHN_GUEST_LAB=1`로 build한 앱에서만 열린다(내놓지 않는다)

## 할 일

1. 의존과 patch: `packages/mobile/package.json`에 `@callstack/react-native-sandbox` 0.7.0(정확한 판), `patch-package`(정확한 판, devDependency)와 `"postinstall": "patch-package"`를 더한다. spike의 patch(`react-native-sandbox-0.7.0.patch`: `StyleSheet.absoluteFillObject` 대체, 절대 경로와 `A|B` 두 script 로더, `useDevSupport=false`, host package의 view manager 허용 prefix)를 `packages/mobile/patches/@callstack+react-native-sandbox+0.7.0.patch` 형식으로 옮기고, 여기에 네 가지를 더한다: (a) guest의 허용 목록에서 `Networking`, `WebSocketModule`, `BlobModule`, `FileReaderModule`을 뺀다(spike: 허용 목록은 library의 JS 상수라 한 줄이다. 뺀 뒤 guest에서 `fetch`가 실패하는 것을 확인한다), (b) view manager prefix는 spike의 넷(`RNSVG`, `RNCSafeArea`, `KeyboardController`, `Reanimated`)에서 더 늘리지 않는다, (c) 아래 7번의 오류 가두기, (d) 이미지: `ImageLoader`가 guest에서 http URL을 받는지 확인하고(아래 5번), 받으면 끌 수 있는지 본다. 깨끗한 `npm ci` 뒤에 patch가 적용되는지 확인한다.
2. Expo config plugin(`packages/mobile/plugins/with-guest-runtime.js`와 `app.json`의 `plugins`): 생성되는 `MainApplication.kt`가 `SandboxReactNativeDelegate.registerHostPackages(PackageList(this).packages)`를 부르게 하고(spike는 생성 file을 손으로 고쳤다. prebuild를 다시 돌려도 한 번만 들어가야 한다), base bundle을 build 때 만들어 APK의 assets에 넣는 gradle 단계를 건다(아래 3번의 script를 부른다). `android/`는 git에 넣지 않는다(`packages/mobile/README.md` 그대로).
3. base bundle(`packages/mobile/guest/base.ts`, `build-base.sh`): spike의 `base.ts`를 옮긴다. `globalThis.require`는 `PHONE_HOST_MODULES`의 이름만 내준다(모듈 목록은 그 상수에서 만들고, 목록과 registry가 어긋나면 build가 실패한다). 더해서: (a) `globalThis.lophnApp`(계약의 모양, `callOperation`은 실패를 `"<code>: <message>"` Error로 reject, `events.subscribe`)와 guest bridge client(spike `bridge.ts`), (b) `__lophnMount(Screen)`: `AppRegistry.registerComponent("Screen", …)`로 root를 등록한다. root는 `init`을 받을 때까지 화면을 그리지 않고, `ready`를 200 ms마다 최대 25번 보내며(spike: 첫 메시지가 떨어진다), `init`을 받으면 `lophnApp.place`를 세우고 `UiProvider`(kit) 아래 error boundary 안에서 `Screen`을 그린다. boundary가 잡으면 `{type: "fatal"}`을 보낸다. (c) `__lophnFatal(error)`: 화면 bundle 평가의 오류를 `fatal`로 보낸다. build: Metro(`expo export:embed --entry-file guest/base.ts`)로 만들고 RN의 `hermesc`(`hermes-compiler`)로 bytecode를 만든다(spike `build.sh`). kit이 import하는 `expo-clipboard`는 guest에 없으므로 base build에서 bridge stub으로 바꾼다(spike `stubs/expo-clipboard.ts`: 화면이 복사를 부르면 host에 `call`로 가지 않고 이 task에서는 no-op과 한 줄 log로 둔다. 복사는 host 허용 목록 밖이다). `@lophn/app-ui-native`는 `metro.config.js`에 alias를 더해 `packages/sdk/app-ui-native/mod.ts`로 풀고 그것이 vendor하는 `../app-ui/use-*.ts`도 풀리게 한다.
4. host(`packages/mobile/src/apps/guest/`): 위 `GuestScreen`을 `SandboxReactNativeView`(`origin` = host가 만든 view id, `componentName="Screen"`, `jsBundleSource` = `<base>|<screenFile>`, `allowedTurboModules` = 고정 목록: spike의 `RNCSafeAreaContext`, `KeyboardController`, `KeyboardControllerView`, `ReanimatedModule`, `WorkletsModule`, `StatusBarManagerCompat`, `WindowDimensionsModule`, `FocusedInputObserver`, `KeyboardGestureArea`에서 시작해 실제로 필요한 것만 남긴다)로 짓는다. 메시지는 JSON이고 계약 schema(`phoneGuestMessageSchema`)로 검사한다(모르는 모양과 크기 초과는 버린다. 메시지가 내세우는 앱·release·view는 신원이 아니고 신원은 `origin`/props의 view id뿐이다). `ready`가 오면 `init`을 보낸다(여러 번 와도 `init`만 다시). `call`이면 주입된 `call(operation, input)`을 부르고 outcome을 `reply`로 보낸다(실패는 `{ok: false, error}`로 보내고 던지지 않는다). `subscribe`로 받은 event는 `event` 메시지로 보낸다. 화면 밖으로 나가면 unmount한다(idle TTL 0). 순수 logic(메시지 검사, 핸드셰이크, call 전달, 신원 무시)은 React Native를 import하지 않는 file로 나눠 `node --test`로 test한다(`packages/mobile/README.md`의 `npm test` 규칙).
5. 격리 확인: spike의 probe(`guest/probe.ts`)를 fixture 화면으로 옮겨 guest 안에서 확인한다: 호스트 전역, `expo`, `ExpoSecureStore`, `ExpoFileSystem`가 보이지 않는다. `fetch`와 `XMLHttpRequest`와 `WebSocket`이 실패한다. 이미지: `data:` URI는 그려지고 http URL은 그려지지 않거나(막혔다) 그려지면 보고한다(그려지면 화면이 URL로 data를 보낼 수 있다는 뜻이라 `ImageLoader`를 끌 수 있는지 본다). `eval`·`new Function`은 막지 않는다(spike: 같은 격리 안이다).
6. 개발용 lab(`packages/mobile/guest/lab`, `EXPO_PUBLIC_LOPHN_GUEST_LAB=1`일 때만 앱 첫 화면): fixture 화면 목록(아래 8번)을 APK assets에서 files로 꺼내 `GuestScreen`으로 띄우고 각 시나리오의 결과(ready까지 ms, state, 받은 메시지)를 화면 글로 보인다(개발용이라 영어를 그대로 쓴다. `adb`의 `uiautomator dump`와 screenshot으로 읽는다). release build에서도 lab이 열려야 하므로 fixture는 그 환경변수로 build할 때만 assets에 든다(release 일반 build의 APK에는 없다).
7. 오류 가두기(이 task의 주된 위험): guest의 JS 예외가 phone 앱을 죽이지 않아야 한다. spike: 화면 평가 중의 top-level 예외는 `libc++abi … JavascriptException`으로 앱을 끝냈고(세 번 재현), library의 `onError`는 instance가 ready인 뒤에야 걸린다. release build에서 아래 8번의 시나리오 b~e를 돌려 확인하고, 앱이 죽으면 patch에서 guest의 `ReactHostImpl`/delegate가 던지는 예외를 host의 callback(`GuestScreen`의 `onState({failed})`)으로 돌리는 길을 찾는다(예: `ReactHostDelegate`의 예외 처리, `reactInstanceExceptionHandler`, `ExceptionsManagerModule`의 guest 쪽 대체). 이 길이 안 열리면 guest 길을 접는다고 판단하고 보고한다(그 경우 README "정한 것" 1의 fallback인 react-native-web WebView 길로 가는 결정은 사람과 planner가 한다. 이 task가 그 길을 짓지 않는다).
8. Android 확인(emulator, 아래 "Android 확인 규칙"): fixture 화면과 시나리오를 **debug와 release 둘 다**에서 돌린다. fixture는 `packages/mobile/guest/fixtures/`에 두고 core의 build와 같은 규칙으로 `phone.js`를 만든다. 시나리오: (a) 정상: kit 화면(`UiProvider`, `Screen`, `List`, `Button`, `Input`)이 그려지고 `call`의 왕복(host의 가짜 operation 표)이 되고 host가 보낸 event가 화면을 바꾼다. 터치와 soft keyboard로 `Input`에 글을 넣는다(spike 미확인). (b) 평가 중 top-level 예외. (c) 시작한 뒤 render 예외. (d) handler 안 throw와 처리되지 않은 promise rejection. (e) 8 s 도는 busy loop: host UI(다른 단추)가 계속 눌리는지, guest를 unmount하면 끝나는지. 300 MB 할당. (f) 격리 probe(5번). (g) 같은 화면 두 개를 동시에, 한 화면을 `key`로 다시 띄우기 10번(메모리가 계속 느는지). (h) 새 kit으로 지은 화면의 manifest를 `phoneCanRun`에 넣어 거절되는 것(host info의 판을 바꿔서). 숫자: release build에서 mount→첫 `ready`까지 ms, guest 하나의 PSS(`dumpsys meminfo`), base 크기, 평문 JS 화면 크기(base는 bytecode, 화면은 plain JS라는 결정이 시작 시간에 미치는 값. 화면이 200 KB 넘게 커도 쓸 만한지 한 번 재 본다).
9. 문서: `packages/mobile/README.md`에 guest 절(구조, patch를 다시 만드는 법, lab, 허용 목록과 이유, 알려진 한계)과 "Android 확인" 절을 더한다. flows catalog: 이 task가 더하거나 지우는 IPC·CLI·route·test file이 있으면 project-docs/flows 에서 자기 줄만 고친다(꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## Android 확인 규칙

- emulator는 `lophn-phone` AVD를 `-read-only -memory 2048 -port 5596`으로 띄우고(`-no-window -no-audio -no-boot-anim`, 화면이 필요하면 `-no-window`를 뺀다) 모든 adb 명령에 `-s emulator-5596`을 붙인다. 끝나면 `adb -s emulator-5596 emu kill`로 끈다. Metro는 port 8236이다.
- gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`로 돌린다(`-PreactNativeArchitectures=x86_64`). 끝에 daemon을 남기지 않는다.
- 사람의 실제 폰(adb serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process는 직접 끈다.
- release build는 debug 서명으로 만든다(`assembleRelease`). 실제 core와 relay, 실제 model provider, 사람의 `~/.lophn`을 쓰지 않는다(이 task는 core 없이 lab으로 확인한다).
- 그림은 `.dev-data/mobile-phone-guest/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다. 깨끗한 `npm ci`에서 patch가 적용된다.
- 위험 test(권한·sandbox 경계라 둔다):
  - "guest 메시지의 앱·release·view 주장은 신원으로 쓰이지 않고, 모르는 모양과 크기를 넘는 메시지는 버려지며, `call`은 host가 가진 view id로만 core에 간다"(node test. React Native 없이)
  - release build의 guest 오류 가두기 확인(8번 b~e): "guest가 평가 중이나 render 중 던진 예외, 처리되지 않은 rejection, 8 s busy loop는 폰 앱 process를 죽이지 않고 host의 `failed` 상태와 다시 띄우기로 끝난다". 자동 test가 아니라 emulator 확인이고 결과(되는 것과 안 되는 것, 그림, 숫자)를 보고에 적는다. 이 확인이 통과하지 않으면 끝남이 아니다.
- 남지 않음: 없음(더하기뿐. `packages/mobile/src`의 옛 WebView·bundle cache 길은 `mobile-app` 계획이 지웠다).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: patch의 변경 목록(spike 네 개 + 이 task가 더한 것), 허용 목록 최종본과 뺀 것의 이유, 8번 시나리오 표(debug와 release 각각 되는 것과 안 되는 것), 숫자(시작 ms, PSS, base·화면 크기), 이미지 http 결과, 오류 가두기를 어떤 patch로 이뤘는지, `mobile-phone-apps`가 알아야 할 `GuestScreen` 사용법, dev build와 release build를 짓는 데 바뀐 것(lead가 wave 7 worker에게 알릴 APK 경로).

## lead가 더함 (단계 10 spike `reports/mobile-program/drive-spike.md`가 release build에서 본 것, 2026-11-15)

- release build(R8)는 sandbox library의 class를 지워 guest가 mount될 때 앱 전체가 죽는다. keep 규칙 `-keep class io.callstack.rnsandbox.** { *; }`를 build에 넣는다(spike의 `mobile/guest/proguard-sandbox.pro`. prebuild가 다시 써도 남는 자리에 둔다).
- guest 위에 화면 전체를 덮는 형제 view를 두지 않는다. library의 `SandboxWindowCallback`이 그것을 guest를 가리는 overlay로 보아 손가락 입력을 host로 돌려 guest가 받지 못한다. 개발 build(dev client)에서는 dev menu의 전체 화면 view 때문에 손가락 입력이 guest에 닿지 않으니, 손가락 입력 확인은 release build에서 한다.
- 같은 view id(origin)로 guest를 다시 mount하면 옛 runtime과 옛 bundle이 그대로 쓰인다. 새 bundle을 띄울 때는 runtime을 버리고 새로 만든다(또는 mount마다 다른 origin).
- guest가 읽을 bundle file이 없으면 앱 전체가 죽는다. mount 전에 file이 있는지 host가 확인하고 없으면 오류 상태를 보인다.

## lead가 더함 (단계 7 spike `reports/mobile-program/local-apps-spike.md`가 본 것, 2026-11-15)

- guest가 한 frame에 메시지 여럿을 보내면 host에 하나로 합쳐져 온다. 단계 6 spike의 "첫 메시지가 떨어진다"가 이것이다. 한 줄 patch로 고쳐진다(그 spike의 patch를 본다: `/home/pyosechang/projects/lophn-worktrees/spike-local-apps/mobile/guest/`). `ready`를 되풀이해 보내는 것으로 덮지 말고 patch를 넣는다.
- 같은 origin으로 다시 mount하면 죽었다(단계 10 spike는 옛 runtime이 다시 쓰인다고 봤다). mount마다 runtime을 새로 만들거나 origin을 다르게 준다.
- **손가락 입력.** 단계 7 spike는 guest의 단추가 debug와 release 모두에서 눌리지 않는다고 봤고(원인은 보지 않았다), 단계 10 spike는 release에서는 눌린다고 봤다(debug는 dev menu의 전체 화면 view가 가린다). 이 task가 release build에서 `adb -s emulator-<port> shell input tap`으로 guest의 단추가 눌리는지 확인하고, 안 눌리면 원인을 찾아 고친다. 손가락으로 못 쓰는 화면은 끝난 것이 아니다.
