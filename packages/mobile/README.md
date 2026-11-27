# mobile

lophn 폰 앱. Expo SDK 58(React Native 0.88, React 19.3) dev build다(Expo Go가 아니다). root npm workspace 밖의(root `package.json`의 `"!packages/mobile"`) 독립 project라 자기 `package.json`과 lock file을 가지고, 저장소의 `npm run check`는 이 폴더를 보지 않는다(이 폴더의 `biome.json`이 저장소 Biome에서 이 폴더를 뺀다).

protocol 코드는 복사하지 않는다. Metro가 `packages/protocol/remote`의 TypeScript source를 그대로 읽는다(`metro.config.js`). 그쪽의 bare import(`zod`, `@noble/*`)는 이 폴더의 `node_modules`에서 찾으므로 판은 `packages/protocol/package.json`과 같게 맞춘다.

## 명령

모두 이 폴더에서 돈다.

| 명령 | 무엇 |
|---|---|
| `npm ci` | 의존성. lock대로 깐다. 판은 정확히 고정했다(`~`·`^` 없음). 새 의존을 더할 때만 `npm install` |
| `npm run typecheck` | `tsc --noEmit`. 앱 code와 앱이 import하는 `packages/` source까지 본다 |
| `npm test` | `node --test "src/**/*.test.ts"`. React Native를 import하지 않는 순수 logic(앱 host, 위젯 cache, open target, 답하기, 대화·터미널 data)만 test한다. 연결과 컴퓨터 store의 test는 그 code와 같이 `packages/remote-client`에 있고 root `npm run check`가 돌린다. node가 `packages/` source를 읽을 때 bare import는 root `node_modules`에서 찾으므로 root `npm install`이 되어 있어야 한다 |

폰 앱을 고쳤으면 `npm ci && npm run typecheck && npm test`를 돌린다. root `npm install`도 되어 있어야 한다(위 `npm test` 참고).

## 폰 UI kit과 gallery

- 화면은 폰 UI kit `@lophn/ui-native`(`packages/design/native/`)의 component로 짓는다. desktop의 `@lophn/ui`와 같은 token(`packages/design/tokens.ts`)을 쓰고 Markdown은 desktop과 같은 parse 결과를 그린다. Metro는 `metro.config.js`의 alias로, tsc는 `tsconfig.json`의 `paths`로 이 package를 찾는다(`paths`는 tsc만 읽는다. `app.json`의 `experiments.tsconfigPaths`를 껐다).
- kit의 root는 `UiProvider`다(safe area, keyboard, theme). kit이 쓰는 native module은 `react-native-svg`, `react-native-keyboard-controller`(와 그 peer인 `react-native-reanimated`, `react-native-worklets`), `react-native-safe-area-context`, `expo-clipboard`다. 더하면 prebuild와 gradle을 다시 돈다.
- gallery(`src/gallery/`)는 kit을 지어낸 data로 그린 화면이다(Sessions, Inbox, 대화, 모든 component, light·dark). dev build에서만 열린다: Metro를 `EXPO_PUBLIC_LOPHN_GALLERY=1 npx expo start --dev-client`로 띄우면 바로 gallery로 열리고, 아니면 Settings 맨 아래의 `UI kit gallery` 줄(dev build에서만 보인다)로 연다.

## Android에서 띄우기

필요한 것: JDK 17, Android SDK(platform 36, build-tools, platform-tools, emulator), AVD 하나.

```sh
export JAVA_HOME=$HOME/.local/opt/jdk-17.0.21+9 ANDROID_HOME=$HOME/Android/Sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH

emulator -avd lophn-phone -no-window -no-audio -no-boot-anim &   # 화면이 필요하면 -no-window를 뺀다
npx expo prebuild --platform android --no-install                 # android/를 만든다(git에 넣지 않는다)
(cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
npx expo start --dev-client --port 8199 &
adb shell am start -a android.intent.action.VIEW \
  -d "exp+lophn://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8199"
adb -s emulator-5554 emu kill                                     # 끝낼 때
```

- native module(`app.json`, 의존성)을 바꾸면 prebuild와 gradle을 다시 돈다. JS만 바꾸면 Metro가 다시 읽는다(`CI=1`로 띄운 Metro는 아니다. 아래).
- 대화의 첨부(Photos, Camera)는 native module `expo-image-picker`를 쓴다. Photos는 Android 시스템 사진 선택기라 권한이 없고, 카메라 권한 문구는 `app.json`의 plugin 설정이다. emulator의 사진은 `adb -s <emulator> push`로 `/sdcard/Pictures`에 넣고 `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE`로 알린다.
- `CI=1`로 띄운 Metro는 file을 지켜보지 않는다. JS를 바꾸면 Metro를 다시 띄운다.
- emulator에서 이 machine은 `10.0.2.2`다.
- 첫 gradle build는 NDK·CMake를 `~/Android/Sdk`에 받아 몇 분 걸린다.
- prebuild가 만드는 `gradle.properties`의 Metaspace 512m로는 Kotlin 컴파일이 `OutOfMemoryError: Metaspace`로 멈출 수 있다. 여럿이 같이 지을 때 안전한 flag: `./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=3`.

## emulator 규칙

AVD `lophn-phone` 하나를 여럿이 쓴다.

- `-read-only -port <내 port>`로 자기 instance를 띄운다. 모든 adb 명령에 `-s emulator-<내 port>`를 붙인다. 끝나면 `adb -s emulator-<내 port> emu kill`로 끈다.
- Metro도 자기 port를 쓴다(`--port`). `CI=1`로 띄운 Metro는 file을 지켜보지 않는다.
- 사람의 실제 폰에는 어떤 adb 명령도 보내지 않는다(serial을 늘 지정한다). 실제 폰에 새 build를 까는 것은 사람에게 묻는다.
- 프로세스를 `pkill`이나 `killall`로 끄지 않는다. 띄운 것은 자기가 끈다.
- 개발 core는 위 "개발 core와 pairing"의 것을 쓴다. 사람의 `~/.lophn`과 실제 relay(`wss://lophn-relay.fly.dev`)를 쓰지 않는다.

## 화면 이동

React Navigation 7(native stack과 drawer)이다. 아래 tab bar는 없다. 앱이 더 쓰는 native module은 `react-native-screens`, `react-native-gesture-handler`(drawer), `expo-camera`, `expo-notifications`(알림, 아래), `expo-network`(폰이 컴퓨터 사이로 file을 나를 때 Wi-Fi인지 보기, `src/apps/carry/`)다.

- root stack(`src/app/root.tsx`): 컴퓨터가 하나도 없으면 연결 흐름(`src/screens/start/`: Welcome, Scan, Pairing, Paired, 실패 둘, Paste the invite sheet)에서 시작하고, 있으면 frame이다. 마지막 컴퓨터를 지우면 Welcome으로 돌아간다.
- frame(`src/app/frame.tsx`): 왼쪽 drawer가 sidebar(`src/app/sidebar.tsx`)이고 옆이 place의 stack이다. 폭 600 이상에 높이 480 이상이면 sidebar가 늘 열려 있고 stack은 그 옆 card에 들며, 화면은 menu 단추를 두지 않는다. 가로로 든 폰은 폭이 넘어도 낮아서 drawer로 둔다. sidebar에서 고르면 stack이 [Home, 그 곳]으로 바뀌고, 화면 안에서 연 곳은 stack에 쌓인다. sidebar는 project 아래에 lophn session 다음으로 그 project에서 도는 컴퓨터의 coding agent session(터미널 탭의 Claude Code, Codex 등. 터미널(TUI)로 도는 것은 Terminal 표시)을 보인다. 목록은 `useCodingSessions()` 읽기 하나(project 없이)이고 `coding_sessions` 변경에 따라 다시 읽는다. 컴퓨터의 lophn 앱이 붙어 있지 않으면 줄이 없다. 각 workspace 줄 끝의 +는 그 workspace의 New session을 연다(project에서는 agent 줄 옆 Coding agents 칩이 컴퓨터의 coding agent 목록을 연다).
- 갈 곳은 `src/app/nav.ts`의 `Place` 하나로 말한다. 화면은 `useNav()`의 `open(place)`, `back()`, `openSidebar()`, `openComputers()`와 `menuButton`(top-level 화면의 TopBar에 펼친다)을 쓴다. place마다 화면은 `src/app/routes.tsx`에 등록되어 있고, 그 화면은 `src/screens/<영역>/index.tsx`가 export하며 place를 `place` prop으로 받는다.
- 얼굴과 workspace 표식은 `src/parts/`다. vendor 아이콘은 desktop의 svg(`packages/shell/renderer/parts/vendor-icon/`)를 사본 없이 쓴다: Metro가 `.svg`를 글로 읽는다(`src/parts/svg-text-transformer.js`).
- 화면을 core 없이 보려면 Metro를 `EXPO_PUBLIC_LOPHN_SAMPLE=1`로 띄운다(dev build에서만). 지어낸 data의 sample 컴퓨터가 목록에 든다(`src/data/sample.ts`). 저장하지 않고 하는 일은 메모리만 바꾼다. 화면 모양은 sample로, 동작은 아래 개발 core로 본다.
- 화면 아래의 data 층(`src/data/`)은 desktop의 event client, Inbox store, 대화 source를 그대로 쓴다. 화면은 `src/data/mod.ts`의 hook만 import하고 연결을 만지지 않는다. desktop의 순수 logic만 가져오고 DOM file은 가져오지 않는다. 문구는 `@lophn/i18n`의 key다(폰에만 있는 것은 `mobile.`로 시작). Hermes에 없는 `Intl` 일부는 `src/app/intl.ts`의 영어 대체다.

## pairing

처음 열면 Welcome이다. Scan the code로 camera 권한을 묻고 QR(core `roster/invite`의 초대장 JSON, kind `phone`)을 `expo-camera`로 읽거나, Paste the invite instead로 그 JSON을 붙여 넣는다(desktop Settings › Remote의 QR 아래 "Show as text"가 그 글이다). 컴퓨터용 초대장이면 그렇다고 말하고 넘어가지 않는다. Pairing 화면이 초대장으로 명단에 들어가고(`join`: 초대장의 비밀로 서명한 자기 항목, hello의 `phone` 화면 칸) 첫 연결이 열리기를 기다린 뒤 Paired에서 "Paired with <컴퓨터 이름>"을 보인다. 이름 칸은 비어 있고 placeholder가 명단의 컴퓨터 이름이며, 무엇을 쓰면 이 폰에서 부르는 별명("Shown as")이 된다. 지난·쓰인 초대장은 Code expired, 닿지 않으면 Cannot reach 화면이다. 기기 key 쌍과 컴퓨터 목록(root인 서명 key 포함)은 `expo-secure-store`(이 기기에서만, 잠금이 풀렸을 때만)에, 든 명단(공개 key와 서명뿐)은 앱 문서 폴더의 `roster.json`에 둔다. 모양(theme, 글자 크기) 설정은 SecureStore에 둔다.

컴퓨터 목록은 명단에서 온다: 한 컴퓨터와 pairing하면 그 컴퓨터의 명단에 든 다른 컴퓨터가 목록에 뜨고 link가 열리며, 명단에서 빠진 컴퓨터는 목록에서 빠진다. 폰은 운반자라 받은 명단을 다른 컴퓨터에 넘긴다. Settings의 "Remove this phone from my devices"는 붙은 컴퓨터 하나에 `roster/leave`를 부르고 모든 컴퓨터, 명단, 기기 key를 잊고 Welcome으로 돌아간다. 믿는 컴퓨터가 서명한 빼기로 이 폰이 빠진 것을 알아도 같다. 다음 pairing은 새 key로 새 기기가 된다.

### 이름과 기계 id

- 폰의 이름: Settings › This phone › Name. SecureStore key `phone-name`, 기본은 기기 model(`Platform.constants.Model`, 없으면 `<os> phone`), 40자. 모든 연결의 client hello `name`으로 보낸다(컴퓨터의 기기 줄에 알린 이름으로 보인다). 바꾸면 열린 연결을 모두 닫고 다시 열어 새 hello를 보낸다. 컴퓨터에서 이 폰에 별명을 붙였으면 그 컴퓨터에서는 별명이 보인다.
- 컴퓨터 기록(`Computer`, SecureStore `computers`): `machine`(core hello의 `mch_` id), `signing_key`(명단의 root. 초대장, `join` 답, 믿는 항목에서 배운다), `announced`(명단의 컴퓨터 이름. 명단에 아직 없으면 hello의 이름), `name`(사람이 이 폰에서 붙인 별명 "Shown as"). 보이는 이름은 `name ?? announced ?? 주소`다. 별명은 명단이 바뀌어도 건드리지 않는다. `rename(key, null)`("Use the computer's name")이 별명을 지운다. 명단 전의 저장은 원소마다 읽고 `device`·`revoked`는 버린다. 그 컴퓨터는 첫 `join` 답에서 서명 key를 배운다.
- 저장한 `machine`이 있으면 연결마다 `connectRemote`에 준다. 다른 id가 답하면 channel이 열리지 않고 아무 frame도 보내지 않으며 그 컴퓨터는 offline으로 보인다("다른 컴퓨터가 답했다"는 상태는 따로 없다). 이 판 전에 pairing한 항목은 첫 연결에서 id를 배우고 둘째 연결부터 대조한다.

### 폰 앱과 core는 같이 올린다

remote protocol 판은 6이고 하한도 6다(hello가 판 범위, 기계 id와 이름, 컴퓨터의 지금 주소 후보를 싣는다. 판 3에서 pairing code가 명단의 초대장이 되었고 연결의 첫 frame은 `join`이다. 판 4는 명단 규칙을 고쳤고 판 5는 컴퓨터끼리 부르는 call frame에 요청한 쪽을 싣고 터미널 입력 허락을 명단 밖으로 옮겼으며 판 6은 computer-hub의 reach 칸과 폰 `signing_key`를 반영했다). 판 5 이하인 옛 폰 build는 판 6 core에 붙지 못한다. 그래서 core를 올리면 폰에도 새 build를 깐다(실제 폰에 까는 것은 사람에게 묻는다). 범위가 어긋나면 `conflict`의 `details.update`(`client`·`host`)가 어느 쪽을 올릴지 말하고, 폰은 초대장으로 들어갈 때 그 실패 화면으로, 붙어 있던 컴퓨터는 목록에서 올리라는 상태로 보인다.

### 개발 core와 pairing

개발 core는 사람의 `~/.lophn`이 아니라 `.dev-data/`를 쓴다. 실제 relay에는 붙지 않는다.

1. 저장소 root에서 개발 core를 띄운다: `npm run dev:core`(창 없이 core만. 창까지는 `npm run dev`).
2. 다른 터미널에서 `npm run dev:remote`. 개발 core의 remote를 켜고(port 47432) 폰 초대장 글(`roster/invite`, kind `phone`)을 찍는다. 초대장은 30분, 한 번이다. 다시 받으려면 다시 띄운다.
3. 폰이나 emulator에서 Paste the invite instead를 열어 그 글을 붙여 넣는다. emulator에서는 `adb -s emulator-<port> shell "input text '<초대장 글>'"`(`</dev/null`을 붙여 스크립트에서 돌린다). emulator에는 camera 장면이 없다.
4. emulator는 이 machine에 `10.0.2.2`로 닿는데 QR에는 LAN 주소가 들기 때문에 Metro를 `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2`로 띄운다(dev build에서만. 이 주소를 저장한 주소들과 같이 걸어 먼저 붙는 것을 쓴다. 이 주소로 열린 연결은 컴퓨터가 알린 주소 목록 앞에 이 주소를 남겨 저장한다). 예: `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2 npx expo start --dev-client --port 8199`.

## 연결

연결 조각(연결, 컴퓨터 store `createComputers`, 초대장 읽기와 join, leave)은 폰과 core(다른 컴퓨터로 가는 link)가 같이 쓰는 `packages/remote-client`(`@lophn/remote-client`)에 있고 폰은 상대 path로 읽는다. 폰만의 것(컴퓨터의 `request`에 답하기, SecureStore, 화면 칸, sample 컴퓨터)은 여기 남는다. `createConnection`이 컴퓨터마다 연결 하나를 연다. 저장한 주소(처음은 QR의 것)를 같이 걸어 먼저 handshake가 서는 것을 쓰고, 기계 id를 대조한 연결에서는 컴퓨터가 hello로 알린 지금 주소로 저장한 목록을 바꾼다(열린 주소가 그 목록에 없으면 앞에 남긴다). 컴퓨터의 주소가 pairing 뒤에 바뀌거나 늘어도(새 network, Tailscale, 설정 `remote.addresses`) 다시 pairing하지 않는다. port를 바꾸면 다시 pairing한다. 연결의 첫 frame은 늘 `join`(폰에 대한, 컴퓨터가 서명한 statement)이고 그 답의 명단을 받은 뒤 마지막 `watch`를 다시 보낸다. 끊기면 backoff로 다시 붙고, 앱이 앞으로 오면 바로 붙거나 열린 연결을 `watch`로 확인한다. 모양은 desktop의 `CoreSource`(상태 `starting`·`ready`·`stale`)다.

QR에 relay 주소(`relay`)가 있으면 컴퓨터 기록에 저장하고, 주소들과 같이 `<relay>/v1/phone?key=<core key>`도 건다. relay는 바이트만 넘기므로 handshake는 같고, 먼저 서는 길을 쓴다. relay가 생기기 전에 pairing한 폰은 relay를 모르므로 한 번 다시 pairing한다.

## 알림

`src/push/`가 맡는다. 알림의 글은 core가 정해 보내고(`PushMessage`) 폰은 만들지 않는다. 누구에게 언제 무엇을 보낼지의 규칙은 core의 몫이다(`project-docs/architecture/attention.md`). 폰이 하는 일:

- 알림 채널 `needs-you`(high), `finished`, `apps`를 앱이 시작할 때 만든다. 허락(Android 13)과 token을 부르기 전이다.
- Paired 화면의 `Turn on notifications`가 허락을 묻고, 허락되면 Expo push token을 받는다. `Not now`는 끈 채로 둔다(Paired는 한 번만 묻고 다른 컴퓨터를 pairing해도 다시 묻지 않는다). Settings › Notifications에서 나중에 켠다. 거절이면 그 화면에 시스템 설정을 여는 단추가 선다.
- 설정(스위치 일곱)과 token은 pairing한 모든 컴퓨터에 `devices/set_push`로 보낸다(붙을 때마다, 바뀔 때마다). 앱이 앞에 있는지와 열린 session은 `presence/report`로 보낸다(앞뒤가 바뀔 때, session 화면이 열고 닫힐 때, 앞에 있는 동안 30초마다).
- 알림을 누르면 `data.host`의 컴퓨터를 고르고 session·앱·Inbox를 연다(앱이 떠 있을 때는 listener, 꺼져 있었으면 `getLastNotificationResponse()`). `data`는 `src/open/`의 `parseOpenTarget`이 읽고(위젯과 아이콘의 누름, URL과 같은 해석 하나. 아래 "열기") 모양이 틀리거나 이 폰에 pairing하지 않은 컴퓨터면 아무것도 열지 않는다. 터미널 coding agent의 알림(`term:<탭>`)은 폰이 열 수 없어 알림 쪽(`src/push/target.ts`)이 Inbox로 바꾸고, 목록에 없는 session은 8초 기다린 뒤 Inbox를 연다.

계정이 필요한 부분: Expo push token은 EAS project id(`app.json`의 `expo.extra.eas.projectId`)가 있어야 받고, FCM 배달은 Firebase project의 `google-services.json`(`expo.android.googleServicesFile`)이 있어야 한다. 둘 다 아직 없다. 그래서:

- dev build(`__DEV__`)는 앱이 처음 쓸 때 만들어 저장한 가짜 token `ExponentPushToken[lophn-dev-<무작위>]`를 `devices/set_push`로 보낸다. 개발 core의 fake push server(`tests/support/fake-push`)가 이 token으로 온 글을 받는다. 폰에 알림을 그리지는 못한다(그리는 것은 Expo의 일이다).
- 그 밖의 build는 token을 받을 수 없어 알림이 "이 build에서는 쓸 수 없다"로 서고 아무것도 등록하지 않는다.
- Settings › Notifications 맨 아래(dev build에서만)의 `Send a test notification`은 5초 뒤 같은 `data`의 local 알림을 띄운다. 앱을 뒤로 보내 보고, 누르면 그 session(없으면 Inbox)으로 가는지 본다. 앱이 앞에 있으면 배너를 그리지 않는다.
- 개발 core 쪽 길: `npm run dev`와 `npm run dev:core`는 fake push server(port 7498, 바꾸려면 `LOPHN_DEV_PUSH_PORT`)를 띄우고 그 주소를 개발 data root의 설정 `remote.push`에 적는다. fake가 받은 글은 core를 띄운 터미널에 `push: <제목> | <본문> | <data>` 한 줄로 찍힌다. 글이 나가려면 `npm run dev:remote`로 remote가 켜져 있고, 폰이 앱 안에서 알림을 켜 `devices/set_push`로 token을 두었고, 폰이 앞에 없어야 한다(앱을 뒤로 보낸다). 그 상태에서 core에 사람을 기다리는 일(승인, 앱의 `notify()`)이 생기면 한 줄이 찍힌다.
- 허락 거절은 `adb -s emulator-<port> shell pm revoke dev.lophn.mobile android.permission.POST_NOTIFICATIONS`로 본다.

## 홈 화면: 위젯과 앱 아이콘 (Android)

설계는 `project-docs/architecture/phone-home-screen.md`다. 위젯은 사용자 앱이 선언한 값(node 넷)을 JS 없이 그리고, 앱 아이콘은 앱마다 pinned shortcut 하나다.

- native: `modules/lophn-widgets/`(Kotlin Expo module 하나. 위젯 그리기·놓기·새로 하기와 앱 아이콘 pin·disable·enable). `android/src/main/java/dev/lophn/widgets/`의 `Render`(cache에서 `RemoteViews`), `Providers`(provider 둘 2x2·4x2와 놓기 callback receiver), `ConfigureActivity`(UI 없이 "Choose a widget"의 답을 기다린다), `Refresh`(위젯 broadcast 안에서 React host를 띄워 headless 일감을 돌린다), `LophnWidgetsModule`(JS가 닿는 함수). 일감 이름은 `LophnWidgetRefresh`(`index.ts`가 등록한다). 위젯은 폰 앱 private 폴더의 `widgets/bindings.json`(놓인 위젯 id → 컴퓨터, 앱, key)과 `widgets/cache.json`(그릴 것 전부와 위젯에 보이는 글)만 읽는다. `bindings.json`은 native만 쓴다: 놓기 callback과 JS가 청한 바꾸기(`bindWidget`, `dropUnplacedBindings`)가 `Files.updateBindings`의 한 잠금 안에서 읽고 바꾸고 쓴다.
- JS: `src/widgets/`(`store.ts`가 binding 바꾸기를 native에 청하고 새로 하기를 한다. binding file을 직접 쓰지 않는다. `cache.ts`가 순수 logic으로 cache를 만든다. `cache.test.ts`가 지운 컴퓨터의 위젯 규칙을 본다), `src/screens/widgets/`("Choose a widget"), `src/shortcuts/`(아이콘을 놓은 모든 컴퓨터를 붙을 때, 앱·release가 바뀔 때, 앱이 앞으로 올 때 정리하는 `ShortcutSync`(앱 root의 component. 앱이 없어지면 disable, 이름이 바뀌면 이름을, 그림의 key가 바뀌면 그림을 다시 그려 `updateShortcuts`로 바꾼다), 앱 menu의 "Add to Home screen", 아이콘 그림). 위젯과 아이콘의 글은 `packages/design/i18n/catalog/mobile-widgets.ts`다.
- 위젯의 새로 하기는 best effort다: 앱이 앞과 뒤로 갈 때, 연결된 동안 `StateChanged`, 위젯의 새로 하기 아이콘, Android의 주기 update(약 30~52분 간격). 한 번의 새로 하기는 컴퓨터마다 8초이고 broadcast 안에서 25초 안에 끝나야 한다.

### emulator에서 확인

- 죽은 채 새로 하기는 **release build**로 본다. dev client는 위젯 broadcast가 죽은 process를 깨울 때 Metro와 dev launcher가 필요해 이 길을 볼 수 없다. 위 "Android에서 띄우기"의 build에서 `assembleDebug` 대신 `assembleRelease`(debug 서명)를 쓴다. 위젯의 놓기·그리기·누름만 보려면 dev build로 된다.
- 개발 core와 pairing하고(위 "개발 core와 pairing") 위젯을 내는 앱이 core에 있어야 한다. 저장소에 위젯 sample 앱은 없다. `tests/support/app/` 꼴로 손으로 쓴 작은 앱(선언 `widgets: [{key, label}]`와 `permissions`의 `notify.send`, 시작 code에서 `@lophn/cap-notify`의 `setWidget`)을 설치하고 release를 활성화한다. 개발 core에는 model이 없다.
- 위젯 놓기 셋: (1) Pixel Launcher의 홈 화면을 길게 눌러 Widgets에서 lophn 위젯을 끌어 놓으면 "Choose a widget"이 열린다. (2) launcher가 그 화면을 건너뛰면 위젯이 "Tap to choose"이고 누르면 같은 화면이 열린다(`lophn://widget/bind?id=<n>`). (3) 앱 화면의 ⋯ menu "Add widget"이 launcher의 놓기 확인을 띄운다. 놓인 위젯 id는 `adb -s emulator-<port> shell dumpsys appwidget`에서 본다.
- 죽은 채 새로 하기: 위젯을 놓은 뒤 앱을 최근 앱에서 밀어 끄고(`am force-stop`은 쓰지 않는다. 아래) 위젯의 새로 하기 아이콘을 누른다. `adb -s emulator-<port> logcat -s LophnWidgets`에 `refresh done in <ms> ms`가 찍힌다. 측정(2026-11-15~16, emulator `lophn-phone` API 36 x86_64, release build, core가 떠 있을 때): 앱이 죽은 채 1.0~1.1초(그 가운데 약 0.7초가 Noise handshake), 뒤에서 살아 있을 때 0.3초, 앞에 있을 때 0.7초, 구현 뒤 확인에서 0.6~1.2초. core를 끄면 약 0.5초에 "Offline" 꼬리와 흐린 rows로 그려진다.
- `am force-stop` 뒤에는 Android가 위젯을 회색으로 가리고 한 번 누를 때까지 아무것도 새로 하지 않는다(Android의 규칙이라 결함이 아니다). 앱을 지우고 다시 깔면 위젯과 아이콘이 모두 사라지고 `adb install -r`은 남긴다.
- 아이콘: 앱 화면의 ⋯ menu "Add to Home screen"이 launcher의 확인을 띄운다. 이미 놓인 앱의 menu에는 그 줄이 없다. 앱을 보관하고 폰 앱을 앞으로 가져오면 아이콘이 쓸 수 없게 된다(Pixel Launcher는 눌렀을 때 자기 글 "Shortcut isn't available"을 보이고 lophn의 글은 보이지 않는다). 아이콘 id는 `lophn:<컴퓨터 key>:<앱 id>`이고 `adb -s emulator-<port> shell dumpsys shortcut`에서 본다.
- 보지 못한 것: 실제 폰, Pixel Launcher가 아닌 launcher, 놓기 확인을 사람이 취소하는 경우, 앱을 보관했을 때 놓인 위젯이 "no longer available"이 되는 것.

## 열기(open URL)

알림 누름, 위젯 누름, 홈 화면 아이콘 누름, 밖에서 온 URL이 `src/open/target.ts`의 `parseOpenTarget` 하나를 지난다(`target.test.ts`). `app.json`의 scheme은 `lophn`이다.

| URL | 연다 |
|---|---|
| `lophn://open?host=<컴퓨터 key>&kind=inbox` | 그 컴퓨터의 Inbox |
| `lophn://open?host=<컴퓨터 key>&kind=session&session=<session id>` | 그 session의 대화(목록에 없으면 8초 뒤 Inbox) |
| `lophn://open?host=<컴퓨터 key>&kind=app&app=<앱 id>[&screen=<화면 key>]` | 그 앱의 폰 화면(`screen`이 없으면 첫 폰 화면, 폰 화면이 없으면 앱 workspace) |
| `lophn://widget/bind?id=<위젯 id>[&from=configure]` | 놓인 위젯에 "Choose a widget"(`from=configure`면 launcher가 답을 기다린다) |

`host`는 이 폰이 pairing한 컴퓨터의 key여야 한다. 모양이 틀린 URL, 빠진 칸, 모르는 `kind`, pairing하지 않은 `host`는 아무 화면도 열지 않는다. emulator에서: `adb -s emulator-<port> shell am start -a android.intent.action.VIEW -d "<URL>" dev.lophn.mobile`(URL의 `&`는 따옴표로 감싼다). 앱이 꺼져 있을 때와 떠 있을 때(warm) 둘 다 본다.

## 폰 기능(위치와 그 밖의 기능)

설계는 `project-docs/architecture/remote.md`의 "컴퓨터가 폰에 묻는 길"이다. 폰 기능은 `src/link/capabilities.ts`의 handler 표 하나(`CAPABILITY_HANDLERS`)에서 돌고, 들어오는 길이 둘이다. 컴퓨터의 `request`(`src/link/answer.ts`: 앱 backend가 부를 수 있는 기능과 `drive.*`가 `hello.capabilities`로 core에 간다. 앱이 앞에 있을 때만 답하고 깨지 않는다)와 앱 화면의 guest가 host에 직접 묻는 `phone` 메시지(`src/apps/guest/phone-host.ts`). 두 번째 길도 폰 앱이 앞에 있을 때만 답한다(`AppState`가 active가 아니면 `unavailable`, `phone_in_background`. 요청이 시작할 때만 본다: 그 요청이 연 OS 대화나 공유 sheet는 요청을 끊지 않는다). 이 view의 앱이 그 기능의 grant를 가졌는지 요청마다 보고(없으면 `forbidden`), stand-in 모드(preview 화면)면 폰에 닿지 않고 표의 값을 주되 preview 선언이 `phone.use`로 선언한 기능에만 준다(선언하지 않은 기능은 live처럼 `forbidden`이라 앱 agent가 빠뜨린 선언을 preview에서 잡는다. desktop의 폰 화면 preview도 같다: core가 `app_views/open`의 답으로 준 목록을 쓴다). 각 기능은 port를 거쳐 폰에 닿고(`expo-location`, `expo-network`, `expo-haptics`, `expo-clipboard`, `expo-camera`, React Native `Linking`·`Share`. 진짜 port는 `src/link/native.ts`) 시험은 port를 가짜로 둔다. `code.scan`의 스캐너는 `src/apps/guest/scanner.tsx`가 화면 위에 그린다. build가 기능을 이름으로 뺄 수 있다: `EXPO_PUBLIC_LOPHN_PHONE_CAPABILITIES_OFF=clipboard.read,link.open`(쉼표 목록. 빠진 기능은 handler가 없어 `hello.capabilities`와 `init.phone.capabilities`에 없고 요청은 `unsupported`다. 모르는 이름이면 앱이 시작하지 못한다).

위치: `src/link/location.ts`가 규칙(OS 권한, 위치 서비스, `max_age_ms`)이고 `expo-location` 58.0.22 port가 `native.ts`에 있다. `answer.test.ts`가 권한이 없거나 모르는 kind거나 앱이 앞에 없을 때 위치를 읽지 않는 것을 본다. OS 권한은 foreground(coarse·fine)뿐이고 background 위치 권한은 manifest에 없다. 처음 쓸 때 OS 권한을 한 번 묻고 거절하면 다시 묻지 않는다(`forbidden`, `os_permission_denied`). 카메라 권한(`code.scan`)은 OS가 허용하는 동안(`canAskAgain`) 부를 때마다 다시 묻는다: 사람이 스캔 단추를 눌렀기 때문이다. Google Play services가 "Location Accuracy"를 켜라고 묻고 사람이 "No thanks"를 누르면 expo-location이 `ERR_LOCATION_SETTINGS_UNSATISFIED`로 reject하고 이것은 `unavailable`(`location_off`)로 답한다. 이 code는 Kotlin 예외 class의 이름에서 만들어지므로 release build의 R8이 class를 바꾸거나 합치지 못하게 `app.json`의 `extraProguardRules`가 `expo.modules.location.**Exception`을 지킨다(release build에서 확인해야 한다).

앱 file(사진, 고른 file): 설계는 `project-docs/architecture/app-file.md`다. 사진·file 기능 넷(`camera.capture`, `photos.pick`, `files.pick`, `share.file`)은 같은 handler 표에 있고 port 셋(`camera`, `picker`, `share.file`)과 guest마다의 file 자리(`files`: `src/apps/files/place.ts`)를 쓴다. 자리는 컴퓨터에서 도는 앱이면 cache(`Paths.cache/app-files/<컴퓨터>/<앱>/live|preview`)이고 폰에서 도는 앱이면 `Paths.document/apps/<앱>/files/`다. 컴퓨터에서 도는 앱의 사진은 `app_files/put`으로 1 MiB 조각씩 올린 뒤에만 손잡이를 답한다(빈 조각으로 먼저 묻고 컴퓨터가 쥔 bytes에서 잇는다). 카메라와 선택기에서 돌아온 직후에는 연결이 끊겨 있으므로 지금의 연결을 `COMPUTER_WAIT_MS`(60초, 시각은 `now`·`sleep`으로 넘긴다)까지 기다린다. 폰에서 도는 sync 앱은 컴퓨터마다 앱 폴더의 `held/<컴퓨터>.json`(그 컴퓨터가 받았다고 한 file과 영영 거절한 file)을 두고 sync가 그 기록에 없는 file을 row보다 먼저 올린다(`src/apps/local/sync.ts`의 `sendFiles`, `held.ts`. 어느 컴퓨터가 file을 빠뜨린 폴더는 `prune.ts`가 지우지 않고 "아직 안 맞춘 것" 수에도 든다). guest의 `locate` 메시지가 file을 그릴 주소로 푼다. `GuestScreen`은 자리의 folder를 sandbox view의 prop `imageFolder`로 알린다: patch의 이미지 길이 그 folder 안의 `file:`만 그리고 그 밖의 `file:`과 모든 `content:`와 network 주소는 요청을 쥔 controller를 만들기 전에 검사해 실패만 하는 controller가 된다(Fresco의 process 전체 cache가 대신 답하지 못한다. 알리지 않으면 어떤 `file:`도 그리지 않는다). `react-native-svg`의 `Image`는 guest에 없다(`guestSvg`와 view manager 제외. desktop preview는 `web-shims.ts`). `guestSvg`는 실제 module 위의 view이고 이름 import만 지원한다: 화면이 ES module로 지어지면(`"type": "module"`) 기본 import가 module 객체 자체라서 `import Svg from "react-native-svg"`는 깨지므로 release 준비(`source-checks.ts`)가 거절한다. 기본 import를 컴포넌트로 만드는 wrapper는 기기에서 `<Svg>`를 깨서 되돌렸다. 이미지 controller builder는 모든 이미지 view가 같이 쓰므로 실패 controller를 만든 뒤 supplier를 다시 치운다. Java는 Fresco 3.7.0에 대해 `javac`로 compile만 보았다. `place.test.ts`가 내려받은 bytes가 이름과 맞지 않으면 보이지 않는 것, 조각마다 stored에야 끝나고 끊기면 이어 올리는 것, 연결을 60초 안쪽에서만 기다리는 것, 컴퓨터가 받지 못한 사진이 남지 않는 것을, `local.test.ts`가 컴퓨터마다의 file 기록(row보다 먼저, 컴퓨터 둘, 읽지 못한 기록, 거절한 file, prune)을 본다. native 의존은 `expo-document-picker` 58.0.5(file 선택기, cache로 복사)와 `expo-sharing` 58.0.23(공유 sheet)이고 `app.json`에는 plugin을 더하지 않았다(`expo-sharing`의 plugin은 공유를 받는 쪽이다). 사진은 JPEG 품질 0.8로 다시 압축한다. patch의 Kotlin·Java는 build하지 않고 만들었으므로 release build와 emulator·폰에서 확인해야 한다: 사진을 찍어 보이는지, `<Image source={{uri: "file:///…"}}>`로 자리 밖 file을 그리면 실패하는지.

emulator에서 확인:

- emulator에는 network 위치가 없다. 위치는 `adb -s emulator-<port> emu geo fix <경도> <위도>`로 넣는다(경도가 먼저다. 예 서울시청 `126.9779 37.5663`). 이 환경에서 `accuracy: "high"`만 시간 안에 왔고 `balanced`(기본)와 `low`는 시간 초과(deadline 20초)였다. 실제 폰에서 `balanced`가 되는지는 보지 못했다.
- 위치를 부르는 앱이 core에 있어야 한다(위젯과 같이 손으로 쓴 작은 앱. 선언 `permissions`에 `{kind: "phone.use", scope: {capability: "location.get"}, reason}`와 `sdk_dependencies`에 `@lophn/cap-phone`, backend의 command에서 `getLocation({accuracy: "high"})`). release를 활성화할 때 동의 카드가 묻는다. 폰의 lophn 앱이 앞에 있는 채 부른다.
- 보는 답: 앞에 있을 때 값(`lat`, `lon`, `accuracyM`, `at`), 뒤에 있을 때 `unavailable`(`phone_in_background`), pairing한 폰이 없을 때 `no_phone`, grant가 없을 때 `forbidden`(`phone.use`), OS 권한을 거절했을 때 `forbidden`(`os_permission_denied`). OS 권한은 `adb -s emulator-<port> shell pm revoke dev.lophn.mobile android.permission.ACCESS_FINE_LOCATION`으로 거둘 수 있다.
- 보지 못한 것: 실제 폰, Google Play services의 자기 대화가 위치 요청을 막는 경우, 위치 서비스를 끈 채(`location_off`)의 실제 emulator 확인.

## 사용자 앱의 폰 화면(guest runtime)

사용자 앱의 폰 화면(`phone.js`)은 폰 앱 안에 따로 띄운 React Native runtime(guest)에서 돈다. `@callstack/react-native-sandbox` 0.7.0이 화면마다 `ReactHost`와 Hermes를 하나씩 따로 만든다. guest는 host의 JS 전역, Expo module, secure store, file system에 닿지 않고 network가 없다. 화면은 data를 bridge(operation 호출과 앱 event)로만 받는다. 폰에서 도는 앱(선언 `runs_on`에 `phone`)은 같은 guest가 그 앱의 backend도 싣는다(아래 "폰에서 도는 앱의 backend"). 계약은 `packages/protocol/apps/phone-screen.ts`다.

- `src/apps/guest/`(host): `GuestScreen`(화면 하나. mount에 시작하고 unmount에 버린다. 다시 띄우거나 새 `phone.js`를 띄우려면 `key`를 바꾼다), `guestHostInfo()`(`phoneCanRun`의 host 쪽), `ensureBase()`(APK assets의 base bundle을 files 폴더로 꺼낸다. 앱 시작 때 한 번 부른다), `session.ts`(React Native 없는 순수 logic: 메시지 검사, `ready`에 `init`, call과 event 전달, 상태), `modules.ts`(guest에 더 열어 주는 native module), `files.ts`(base 꺼내기, backend 사본 `wrapBackend`), `local-call.ts`(guest 안의 backend 길, React Native 없는 순수 logic), `app-db.ts`(앱 DB 묶기).
  - `GuestScreen`의 props 가운데 폰에서 도는 앱의 것: `appDb`(`{path, record}`: 앱 DB file을 mount 전에 이 guest의 origin에 묶고 unmount에 푼다. sync 앱은 `record`가 true), `backendFile`(내려받아 hash를 확인한 `backend.js`의 path), `local`(`init`에 실리는 operation의 effect 표와 data schema 판), `onLocalChange`(guest의 local 호출이 변경을 commit했다. 내용은 없고 변경은 outbox에 있다). `backendFile`이 있으면 `base|backend|screen`을 싣는다.
  - `GuestScreen` 위에 손가락 입력을 받는 view를 두지 않는다. sandbox는 guest 위에 그려진 view가 그 자리의 입력을 받으면(React Native의 `pointerEvents`로 읽는다: `none`은 받지 않고, `box-none`은 자식만 본다) guest를 가린 것으로 보고 입력을 host로 돌린다. 닫힌 drawer의 scrim은 투명한 채 남지만 `pointerEvents: none`이라 가리지 않는다.
  - 신원은 host가 준 `view`뿐이다. 메시지는 계약 schema(`phoneGuestMessageSchema`)로 검사하고 모르는 모양, 상한을 넘는 것, 앱·release·view를 내세우는 것은 버린다. `call` prop은 host가 자기 view에 묶어 준다.
  - mount마다 origin(`<view>:<무작위>`)이 새로 선다. 같은 origin의 view는 runtime 하나를 같이 써서 다시 mount하면 옛 runtime과 옛 bundle이 쓰인다.
  - 상태: `starting` → `running`(`ready`가 왔다) → `{failed}`. `did_not_start`는 10 s 안에 `ready`가 없거나 script file이 없다(없는 file을 loader가 읽으면 앱 전체가 죽어서 mount 전에 본다). `fatal`은 guest의 `fatal` 메시지(화면 평가나 render의 예외)나 guest JS의 fatal 오류, `crashed`는 runtime 자체가 쓰러졌다(guest가 오류 handler를 갖기 전의 예외, native 예외).
- 앱 화면의 상태(컴퓨터에서 도는 앱): `src/apps/use-app-screen.ts`가 사실을 모으고 `src/apps/screen-state.ts`의 `decideScreen`(순수 함수)이 정한다. guest가 한 번 `running`이 되면 컴퓨터 연결, 앱 목록 읽기, view 다시 열기(`view.ts`의 `linkView`가 연결이 돌아온 `ready`마다 같은 view id로 연다)는 guest를 내리지 않는다. 컴퓨터가 닿지 않는 동안 `screens/apps/body.tsx`가 guest 위에 "Can't reach <컴퓨터>" 한 줄(layout의 한 줄이고 guest를 덮지 않는다)을 그리고 호출은 `unavailable`로 답한다(연결이 없거나 끊길 때 `remote-client`가 곧바로 답한다). guest가 새로 뜨는 것은 새 bundle, Try again, guest 실패, 앱이 안 돎·항목 사라짐·호환 거절(안내 화면), 그리고 `view.ts`의 `STALE_AFTER_MS`(5분)를 넘게 컴퓨터가 view에 닿지 않았을 때(연결이 끊긴 때나 폰 앱이 background에 간 때부터 센다)다. guest의 key는 `bundle hash:Try again 횟수:epoch`다. 처음 열 때(running이 된 적 없을 때)는 offline, 안 돎, 거절 안내 화면이 선다. 폰의 Preview 화면(`drive/use-preview.ts`)은 이 길이 아니다.
- `guest/`(guest): `base.ts`가 base bundle의 진입이다. `PHONE_HOST_MODULES`만 `require`로 내주고(registry가 그 목록으로 type이 매겨져 어긋나면 typecheck와 build가 실패한다), `lophnApp`과 bridge(`bridge.ts`), root(`root.tsx`: `init` 전에는 그리지 않고 `UiProvider`와 error boundary 아래 화면을 그린다), `__lophnMount`, `__lophnFatal`을 세운다. `no-network.ts`는 `fetch`·`XMLHttpRequest`·`WebSocket`이 network 오류로 실패하게 한다(경계는 native module이 없는 것이고 이것은 화면이 죽지 않게 하는 실패 모양이다). kit이 import하는 `expo-clipboard`는 base build에서 아무것도 하지 않는 stub이다(`stubs/`).
- build: `guest/build-base.sh <out>`이 typecheck, Metro(`expo export:embed`, `LOPHN_GUEST_BASE=1`), 이 앱의 Hermes에 맞는 `hermesc`로 `<out>/guest/base.hbc`와 `base.json`(sha256)을 만든다. gradle이 `preBuild` 앞에 부르고 결과를 APK assets에 넣는다(`plugins/with-guest-runtime.js`. 같은 plugin이 `MainApplication`에서 앱의 package들을 sandbox에 넘긴다). sandbox의 R8 keep 규칙은 `app.json`의 `expo-build-properties` `extraProguardRules`다. 화면 bundle은 plain JS이고 core가 짓는다.
- 허용 목록: sandbox 자체 목록(patch로 `Networking`, `WebSocketModule`, `BlobModule`, `FileReaderModule`, `LinkingManager`, `DevLoadingView`를 뺐다. Android의 `Linking`은 `IntentAndroid`를 쓰는데 그것은 목록에 없어 `openURL`·`canOpenURL`이 실패한다)과 `modules.ts`의 kit용 넷(`RNCSafeAreaContext`, `KeyboardController`, `ReanimatedModule`, `WorkletsModule`). `StatusBarManager`는 patch로 sandbox 목록에서도 뺐다: 화면이 앱 전체의 status bar를 바꾸고, host의 `StatusBarManager`(react-native-keyboard-controller의 것)와 guest가 받는 RN의 것이 다른 Java class인데 TurboModule spec의 method id는 process에 한 번 cache되어 debug build에서 guest가 뜨자마자 앱이 JNI 오류로 끝났다. 그래서 base build는 RN의 `StatusBar`를 아무것도 하지 않는 stub(`guest/stubs/status-bar.ts`)으로 바꾼다(kit의 `Screen`이 그대로 그려진다). 같은 이유로 guest에 host와 다른 class를 같은 이름으로 주는 module(`ImageLoader`의 대체)은 host가 그 module의 method를 부르지 않아야 debug에서 안전하다. Expo의 package는 guest에 넘기지 않는다(guest마다 Expo app context가 서고 지워지지 않았다). guest의 `ImageLoader`는 모든 호출을 거절하는 대체이고, 이미지 view는 network URI를 읽지 않는다(http 이미지 URL도 data를 내보내는 길이라서). guest에 주는 host의 view는 `RNSVG`, `RNCSafeArea`, `KeyboardController`, `Reanimated` 이름의 것뿐이다. 목록과 상관없이 RN이 늘 넣는 module(`PlatformConstants`, `DeviceInfo`, `DeviceEventManager`, `ExceptionsManager`, `SourceCode`, `DevSettings`, `DevMenu`, `LogBox`, `HeadlessJsTaskSupport`)과 C++ module도 guest에 있다. dev support가 꺼진 guest에서 dev 쪽은 아무것도 하지 않는다. `I18nManager.forceRTL`은 앱 전체의 RTL 설정을 저장한다(다음 시작부터 앱 전체가 뒤집힌다). 여기에 secret, file, network, 다른 앱을 여는 길(intent, share, clipboard)을 가진 module을 더하지 않는다.
- patch(`patches/@callstack+react-native-sandbox+0.7.0.patch`, `npm ci`의 `postinstall`이 적용한다): RN 0.88에 없는 `StyleSheet.absoluteFillObject` 대체, 절대 경로와 `base|screen` 또는 `base|backend|screen` script loader(`|`로 이은 path를 차례로 싣는다), guest의 dev support 끄기, host package의 kit view 허용, 한 frame의 메시지가 합쳐지지 않게(`canCoalesce`), network module과 `StatusBarManager` 빼기, touch interceptor가 guest를 가리는지 볼 때 `pointerEvents`를 따르기, guest `ReactHost`의 예외를 앱을 끝내지 않고 `onError`(`GuestCrashed`)로 돌리기, 이미지와 `ImageLoader`의 network 막기. 다시 만들려면 `node_modules/@callstack/react-native-sandbox`를 고친 뒤 `npx patch-package @callstack/react-native-sandbox --exclude '^package\.json$|android/build/|android/\.cxx/'`(gradle이 그 폴더에 build 산출물을 남긴다).
- lab: `EXPO_PUBLIC_LOPHN_GUEST_LAB=1`로 지은 build는 앱 대신 `guest/lab/lab.tsx`를 연다(`metro.config.js`가 `App.tsx`를 바꾼다. dev build면 Metro도 같은 변수로 띄운다). 그 build에서만 `guest/fixtures`의 화면이 core의 화면 build(`bundlePhone`)와 같은 규칙으로 지어져 assets에 든다(`guest/build-fixtures.ts`). 단추마다 fixture를 `GuestScreen`으로 띄우고 상태, `ready`까지의 ms, 받은 call, 실패 이유를 글로 보인다. probe fixture는 `http://10.0.2.2:8237`(`EXPO_PUBLIC_LOPHN_GUEST_LAB_PROBE`)에 요청을 보내 보므로 그 port에 `python3 -m http.server`를 띄워 두면 요청이 왔는지 log로 본다.
- 알려진 한계: guest는 화면 source가 직접 부른 RN `Modal`로 앱 화면 전체를 덮을 수 있다(kit의 `Sheet`·`Menu`·`Drawer`는 화면 안의 층이라 덮지 않는다). soft keyboard가 뜨면 guest는 줄어들지 않아 화면 아래의 입력란을 가린다. guest의 JS 오류 중 host가 보낸 event를 받은 listener 안의 throw는 sandbox가 log만 남기고 삼킨다(화면은 계속 돈다). 처리되지 않은 promise rejection은 아무 일도 없다. busy loop는 guest의 JS thread만 막는다. 300 MB 할당은 견뎠지만 Hermes heap이 다 차거나 기기 memory가 모자라면 process가 끝날 수 있다(재지 않았다). mount와 unmount를 되풀이하면 PSS가 한 번에 약 2 MB씩 남는다(아래). iOS는 짓지 않았다.

### 폰에서 도는 앱의 backend

선언 `runs_on`에 `phone`이 있는 앱의 backend(`backend.js`. core가 release 준비 때 plain JS 한 file로 묶는다)는 그 앱 화면의 guest 안에서 돈다. 설계는 `project-docs/architecture/app-sync.md`다.

- 싣기: loader가 `base|backend|screen`을 차례로 싣는다(patch의 loader가 `|`로 이은 path를 나눈다). base의 `guest/base.ts`가 backend를 평가하기 전에 `installLocalBackend`(`src/apps/guest/local-call.ts`)를 불러 guest의 DB handle을 받아 closure에 쥐고(전역에 남기지 않는다) backend host(호출을 하나씩 돌리는 handler port, 앱 DB driver, random, 늘 `unavailable`인 network 통로)를 깐다. 화면의 `lophnApp.callOperation`은 `init.local`의 effect로 갈린다: read와 write는 guest 안에서 돌고 `external`과 `local`이 없는 앱은 host로 간다.
- 호출 하나는 transaction 하나이고 한 번에 하나씩 돈다: `beginCall()` → handler → `endCall({id, operation, started_at, max_bytes})`(변경이 있으면 outbox 줄을 같은 transaction에서 쓰고 commit) → 변경이 있었으면 host에 `local_change`. handler가 던져도 바뀐 것은 outbox에 간다. 호출 밖에서는 DB handle이 던진다(호출 밖의 쓰기는 outbox 줄 없이 commit되어 sync가 못 본다). 호출은 3초 안에 끝나야 한다(`LOCAL_CALL_LIMIT_MS`): 넘으면 rollback하고 `unavailable`이다. 그 handler가 3초를 더 지나도 끝나지 않으면 guest가 `fatal`로 끝나고(뒤의 호출을 막지 않게) 화면의 Retry가 새 runtime을 띄운다. changeset이 `init.local.change_max_bytes`(push 한도)를 넘으면 native `endCall`이 rollback하고 호출이 `invalid_input`으로 끝난다. `init.local`은 앱 id와 release도 실어 backend의 호출 문맥에 든다(`PHONE_BASE_FORMAT` 3부터).
- backend 사본: core가 만든 `backend.js`는 평가 중 예외가 React Native에 닿아 guest 전체를 `crashed`로 끝내므로 host가 화면 bundle처럼 try/catch로 감싼 사본(`wrapBackend`)을 cache 폴더(`<cache>/guest/<backend file path의 sha256>.js`)에 써서 싣는다. 그러면 예외가 `fatal`로 앱의 메시지와 함께 간다. 같은 backend는 사본 하나를 다시 쓴다. 사본은 unmount 때 지우지 않는다(loader가 읽기 전에 사라질 수 있다). 다음 앱 시작의 `ensureBase`가 지운다.
- lab: `local`(그 fixture 화면과 `local-backend.js`를 앱 DB 하나와 같이 싣는다)과 `local-throw`(평가 중 던지는 backend, `failed fatal`이어야 하고 앱이 산다) 단추가 있고, debug에서 손가락이 guest에 안 닿으므로 `do:add`·`do:refuse`(변경하고 거절)·`do:offline`(backend에서 갈 수 있는 모든 network 길이 `unavailable`인지)·`do:report`(`external`이 host로 감)·`do:list` 단추가 host event로 같은 동작을 시킨다. `guest/build-fixtures.ts`가 `local-backend.js`·manifest·migration을 core의 `buildPhoneBackend`와 같은 길로 짓는다. 첫 local 호출까지의 ms는 `lab.first_local`로 로그에 남는다(release build에서 mount부터 140–180 ms, 처음 한 번 376 ms).

### Android 확인

lab build로 emulator에서 확인한다(debug와 release). debug(dev client)에서는 손가락 입력이 guest에 닿지 않으니 손가락 확인은 release build에서 한다: Expo dev menu의 전체 화면 `ComposeView`와 RN의 `DebuggingOverlay`가 guest 위에 그려진 보통 Android view라 sandbox가 가린 것으로 본다. lab의 `do:*` 단추는 host event로 같은 동작을 시켜서 debug에서도 돈다.

```sh
EXPO_PUBLIC_LOPHN_GUEST_LAB=1 ./gradlew assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon \
  -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=1
adb -s emulator-<port> install -r app/build/outputs/apk/release/app-release.apk
```

- release `assembleRelease`는 debug 서명이고 `--max-workers=1`로 돈다(병렬이면 memory monitor가 죽였다).
- lab이 아닌 build의 APK에는 fixture가 없다(`unzip -l <apk> | grep assets/guest`).
- `uiautomator dump`는 화면이 계속 바뀌면(misbehave fixture의 tick) idle을 못 얻어 guest 글을 빼먹는다. 그때는 screenshot을 본다.

결과(2026-11-16, emulator `lophn-phone` x86_64 API 36, 2 GB):

| 시나리오 | debug(dev client) | release(R8) |
|---|---|---|
| a. kit 화면, call 왕복, host event, `Input`에 손가락과 soft keyboard로 입력 | 그려지고 call·event 됨. 손가락은 guest에 닿지 않는다(dev menu) | 모두 된다. 단추가 손가락으로 눌리고 keyboard로 친 글이 `tasks.add`로 간다 |
| b. 평가 중 예외(build의 try/catch 안 / 밖), file 없음 | `failed fatal` / `failed crashed` / `failed did_not_start`, 앱 산다 | 같다(세 번씩) |
| c. 시작 뒤 render 예외 | `failed fatal`(boundary) | 같다 |
| d. handler throw / 처리되지 않은 rejection | event listener 안 throw는 sandbox가 log만 남기고 화면은 돈다 / 아무 일 없음 | 단추 handler throw는 `failed fatal` / 아무 일 없음 |
| e. 8 s busy loop / 그 중 unmount / 300 MB 할당 | host 단추가 눌린다 / guest가 사라지고 앱 산다 / 할당되고 unmount 뒤 돌아온다 | 같다(loop 동안 guest tick이 멈추고 host 단추는 4번 눌림) |
| f. 격리 probe | 아래와 같다 | host 전역·`expo`·`ExpoSecureStore`·`ExpoFileSystem`·network module 없음, `fetch`·XHR·WebSocket·`Image.prefetch`·http 이미지 실패, `data:` 이미지 그려짐, `Linking.openURL`(http·tel·mailto·intent)·`canOpenURL`·`Share.share` 실패(다른 앱이 열리지 않는다), `Alert.alert`은 아무것도 띄우지 않는다, clipboard·share·vibration·dialog·toast·permission module 없음(이 줄은 debug lab에서 봤다), probe server에 요청 0. host의 `fetch`는 닿는다 |
| g. 두 화면 동시 / `key`로 10번 다시 띄우기 | 된다 | 된다. PSS는 10번마다 약 20 MB씩 는다 |
| h. 새 kit의 manifest | `phone_too_old`, 옛 major는 `screen_too_old` | 같다 |

숫자(release): mount→`running`(첫 `ready`) 83–117 ms, 214 KB plain JS 화면(함수 1,500개) 150–167 ms. guest 하나의 PSS +28–38 MB(앱만 87–97 MB, 둘이면 +55–60 MB). base `base.hbc` 6.35 MB(Metro JS 5.0 MB), fixture 화면 1.8–3.5 KB. debug에서 `running`까지 170–330 ms.

## 앱 DB native module

폰에서 도는 앱의 SQLite는 우리 native module `modules/lophn-app-db`(C++ JSI, Android만)다. 앱의 주 runtime(host)과 앱 화면의 guest runtime이 같은 `.so`의 같은 SQLite로 같은 file을 연다. 한 process 안에서 SQLite 사본 둘이 한 file을 열면 lock이 깨지므로 expo-sqlite는 더하지 않는다. JS API와 값 규칙은 `modules/lophn-app-db/index.ts` 머리에 있다. host 쪽 연결은 sync core의 `SyncDb`(`packages/protocol/apps/sync/db.ts`)다.

- host: `openHost(path)`, `bind(origin, path, {record})`, `unbind(origin)`. 앱의 주 ReactHost context에서만 되고, 다른 context(guest)에서 부르면 `forbidden`으로 던진다.
- guest: `installGuest()`(native `install()`)가 그 origin에 묶인 file 하나의 연결을 준다. runtime마다 한 번이고 둘째는 던진다. `beginCall()`이 `BEGIN IMMEDIATE`와 session을 열고, `endCall({id, operation, started_at})`이 changeset이 있고 `record`이면 `lophn_sync_outbox`에 한 줄을 같은 transaction에서 쓰고 commit한다. `abortCall()`은 rollback이다.
- `GuestScreen`에는 `src/apps/guest/app-db.ts`의 `useAppDbBinding(origin, appDb)`(mount 전에 bind, unmount 때 unbind)와 `APP_DB_SUBSTITUTION`(sandbox의 module 대체)을 건다. sandbox는 대체한 module에만 origin을 알려 주므로 module이 자기 자신을 대체한다. 대체가 없는 guest는 module에 닿지 못한다.

guest 연결이 막는 것과 이유:

| 막는 것 | 어떻게 | 이유 |
|---|---|---|
| 다른 file 열기 | path는 host가 정한다. guest에는 `open`이 없고 file을 만들지도 않는다 | 앱은 자기 file 하나만 본다 |
| ATTACH·DETACH, `VACUUM INTO` | `SQLITE_LIMIT_ATTACHED` 0과 authorizer | 다른 file 읽기와 앱 file 밖으로 복사 |
| extension 싣기 | `SQLITE_OMIT_LOAD_EXTENSION`으로 짓는다 | native code 싣기 |
| `lophn_sync_*` 읽기·쓰기·DDL·pragma | authorizer(대소문자 무시). `endCall`의 outbox 쓰기만 C++ 안에서 예외 | clock, outbox, sync 상태는 host의 것이다 |
| trigger 만들기 | authorizer | trigger는 host의 쓰기(sync 적용) 안에서 authorizer 없이 돈다 |
| call 안의 `BEGIN`·`COMMIT`·`ROLLBACK` | authorizer(SAVEPOINT는 된다) | write가 outbox 줄 없이 commit되면 sync가 그 변경을 잃는다 |
| 5 s 넘는 statement | progress handler가 끊는다(`interrupted`) | guest의 폭주가 file의 lock을 쥐고 있지 않게 |
| 64 MiB 넘는 값 | `SQLITE_LIMIT_LENGTH` | 메모리 |
| `writable_schema` 같은 손상 | `SQLITE_DBCONFIG_DEFENSIVE` | file 깨기 |

`unbind`는 guest의 연결을 닫는다(돌던 statement는 interrupt, 열린 call은 rollback). 그 뒤 guest의 handle은 `database is closed`로 던진다. 모든 연결은 WAL, `busy_timeout` 5 s, `foreign_keys` on(컴퓨터의 `node:sqlite`와 같다)이다.

SQLite는 공식 amalgamation을 손대지 않고 `modules/lophn-app-db/android/src/main/jni/sqlite/`에 둔다(판과 sha256은 그 폴더의 `VERSION`). 판 올리기: sqlite.org에서 `sqlite-amalgamation-<판>.zip`을 받아 sha256을 확인하고 `sqlite3.c`, `sqlite3.h`를 바꾼 뒤 `VERSION`을 고치고, 아래 lab을 debug와 release에서 다시 돌린다. build flag(`SQLITE_ENABLE_SESSION`, `SQLITE_ENABLE_PREUPDATE_HOOK`, `SQLITE_OMIT_LOAD_EXTENSION`, `SQLITE_THREADSAFE=1`, 비공개 link)는 같은 폴더 위 `CMakeLists.txt`다.

android 쪽: autolinking이 host에 package를 넣고, config plugin `plugins/with-app-db.js`가 `MainApplication`에 sandbox 대체 package 등록 한 줄을 넣는다(prebuild를 다시 돌려도 한 번). R8 keep 규칙(`dev.lophn.appdb.**`. C++가 JNI 이름으로 부른다)은 module의 consumer ProGuard file(`android/proguard-rules.pro`)이 싣는다.

### lab 확인

`guest/lab/app-db.tsx`(host)가 file을 열어 guest(`guest/fixtures/app-db-probe.tsx`)에 묶고 경계 확인을 차례로 돈다: guest의 `pragma database_list`, 거절(ATTACH, VACUUM INTO, extension, `lophn_sync_*`, trigger, call 안의 COMMIT, 64 MiB, 둘째 `install()`, guest의 host 함수), host 500 + guest 500 엇갈린 write 뒤 `integrity_check`, call의 outbox 한 줄과 abort, 5 s query 끊기, `unbind` 뒤 handle. 결과는 화면의 PASS/FAIL 줄과 logcat의 `APPDB` 줄이다. 위의 단추는 PSS를 재려고 guest를 띄워 둔다.

lab은 host와 guest가 같은 bundle(`guest/lab/app-db-entry.ts`: host의 `main`, guest의 `AppDbProbe`)을 쓴다. prebuild 뒤 생성된 `android/`에서:

- release: `android/app/build.gradle`의 `entryFile`을 `file("../../guest/lab/app-db-entry.ts")`로 바꾸고 `assembleRelease`. guest는 APK의 `index.android.bundle`을 싣는다.
- debug: `assembleDebug`에 `-PreactNativeDevServerPort=<Metro port>`를 더한다(guest의 dev support가 그 port의 Metro에서 `guest/lab/app-db-entry`를 받는다). Metro를 그 port로 띄우고 dev client를 `exp+lophn://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A<port>%2Fguest%2Flab%2Fapp-db-entry.bundle%3Fplatform%3Dandroid%26dev%3Dtrue` 로 연다.

## 폰에서 도는 앱(host)

폰 host가 설치, sync, release 바뀜, 지우기를 한다(`src/apps/local/`. React Native와 native module 없이 두어 `npm test`가 `node:sqlite`로 돈다. `src/data/local-apps.ts`와 `local-stores.ts`가 그것을 화면에 잇는다). 설계는 `project-docs/architecture/app-sync.md`다.

앱 폴더(컴퓨터와 앱마다. `files/apps/<컴퓨터 key>/<앱 id>/`):

```
installed.json                 설치된 것(release, kind sync|standalone, 화면, backend manifest, 마지막 맞춘 시각). 마지막에 쓴다.
                               이것이 없는 폴더는 멈춘 설치라 다음에 지우고 다시 한다
app.sqlite                     data, 숨은 clock 표, outbox
app.before-<rel>.sqlite        release 바뀜의 backup. 새 release의 첫 push가 될 때까지(안 보낸 변경이 있었을 때만) 둔다
release/<rel>/backend.js, backend.json, migrations/<from>-<to>.sql, screens/<화면 key>/phone.js
work/                          snapshot이나 migrate한 사본. 단계가 끝나면 지운다
```

- 받은 file(backend, migration, 화면 bundle, snapshot)은 크기와 sha256이 manifest나 컴퓨터가 말한 것과 같을 때만 쓰고, snapshot은 disk에서 다시 읽어 확인한 뒤 연다(file 쓰기가 일찍 돌아온 일이 있었다).
- sync는 앱이 앞에 있고 그 컴퓨터에 닿은 동안만 돈다. 계기는 guest의 `local_change`, 연결됨, `AppSyncChanged`, 앱 목록 읽기다. pairing한 컴퓨터마다 store가 하나이고(`src/data/local-stores.ts`), 화면이 바뀌어도 사는 data provider가 `followLocalComputers`로 연결이 선 모든 컴퓨터의 store를 그 연결에 잇고 그 컴퓨터의 `AppSyncChanged`를 넘긴다. 그래서 앱을 열지 않아도, 다른 컴퓨터를 보고 있어도 push와 pull이 돈다. 새로 깔기와 새 release로 옮기기는 목록을 읽는 sidebar(`useLocalApps`)가 지금 고른 컴퓨터에 대해서만 한다.
- 앱이 컴퓨터의 목록에서 빠지거나 컴퓨터를 지워도 sync 앱의 폴더는 outbox가 비었을 때만 지우고 standalone 앱의 data는 지우지 않는다.
- 컴퓨터가 없어도 폰이 가진 사본에서 앱 목록이 읽히고 폰에서 도는 앱이 열린다(컴퓨터가 필요한 `external`만 `unavailable`).

### sync 확인 길(emulator + 개발 core)

emulator에서 개발 core에 붙여 보는 길이다(실제 폰, 사람의 `~/.lophn`, 실제 relay는 쓰지 않는다). 앞의 "Android에서 띄우기"와 "개발 core와 pairing"을 먼저 한다. 폰 앱 build는 native module을 더한 판이어야 한다.

1. 개발 core와 remote를 띄우고 emulator와 pairing한다(`npm run dev:core`, `npm run dev:remote`).
2. 폰에서 도는 앱을 개발 core에 release한다. 개발 core에는 앱을 만들어 줄 agent turn이 없어서 사람이 짠 앱을 release하는 driver(앱 만들기, source commit, `release prepare`, `release activate`, 동의 허락을 차례로 부르는 일회용 script)가 필요하다. 그 일을 test core에서 하는 본보기가 `tests/support/app/activate.ts`이고, 폰에서도 도는 작은 앱의 source는 `tests/support/app/local/fixture.ts`의 `createLocalApp`이 만든다(sync는 `runs_on: ["computer","phone"]`, standalone은 `["phone"]`으로 선언을 바꾼다). release 준비가 폰 backend와 검사를 통과해야 폰이 받는다.
3. 폰에서 앱이 설치되어 열리는지, 위 줄이 "On this phone · synced …"인지 본다. 컴퓨터 쪽 data는 컴퓨터의 앱 화면이나 route `apps/call_tool`로 앱의 write operation을 불러 바꾼다.
4. 확인할 것: 컴퓨터의 write가 폰에 오는가, 개발 core를 멈춘 채 폰에서 쓰고 core를 다시 띄우면 컴퓨터 DB와 그 앱의 호출 기록(`lophn app invocations`)에 기기가 caller로 붙은 호출이 생기는가, 같은 row의 다른 칸을 양쪽에서 고쳐도 둘 다 남는가, 안 보낸 변경이 있을 때 새 release를 activation하면 변경이 살아남는가, 컴퓨터의 rewind가 폰에 오는가, `external` operation이 outbox 뒤에 가는가, core를 끈 채 standalone 앱이 열리고 쓰이는가, 설치가 실패했을 때 Try again이 되는가, Settings에서 컴퓨터를 지웠을 때 폴더가 위 규칙으로 정리되는가.
5. 손가락 확인은 release build에서 한다(debug는 손가락이 guest에 닿지 않는다). 폰의 앱 폴더(`files/apps/…`)는 debuggable build에서 `adb -s emulator-<port> shell run-as dev.lophn.mobile ls files/apps`로 볼 수 있다.

## preview 화면 다루기(drive)

컴퓨터의 agent가 사람의 폰에 뜬 앱 preview 화면을 `lophn tab open --phone <app>`과 `lophn browser snapshot|act|screenshot|wait|read`로 보고 다룬다(`project-docs/architecture/browser-tab.md`의 "phone 탭", `phone-screen.md`의 "drive"). core가 폰 link로 `drive.*`를 묻고 폰이 답한다(`packages/protocol/phone/drive.ts`).

- `modules/lophn-drive/`: local Expo native module(Kotlin, Android만). view id로 guest(`SandboxReactNativeView`, `delegate.origin == view`)를 찾고, Android view tree를 걸어 계약의 node(role, name, value, flag)를 내고, `View.draw`로 guest만 찍고(JPEG q80, 긴 변 1080 px, 1 MiB를 넘으면 q60), guest 표면(직계 자식)에 touch를 넣고, 칸의 InputConnection으로 글을 친 뒤 soft keyboard를 내린다. 누르기 전에 화면 밖 node를 `requestRectangleOnScreen`으로 들이고 못 들이면 `conflict off_screen`. activity가 `RESUMED`가 아니면 `phone_in_background`, 화면이 꺼졌거나 창 focus가 없으면 `screen_off`, 그 view의 guest가 없으면 `no_preview`. JS 감싸개(`index.ts`, 순수 부분은 `src/answer.ts`)가 답을 계약 schema로 검사해 `Result`로 낸다. 그 view가 preview인지는 모른다.
- `src/apps/drive/`: `controller.ts`(React Native 없는 순수 logic)가 preview 화면의 등록부, take control, driving 줄을 든다. 이 폰이 그 컴퓨터를 위해 연 preview view가 아니면 native를 부르지 않고 `no_preview`, take control 중이면 act만 `conflict taken_over`, native의 `screen_off`는 앱이 앞에 있을 때만 여기 오므로 `covered`로 바꾼다. `use-preview.ts`가 preview 화면의 bundle(`apps/screen_file`의 preview target), `app_views/open {mode: "preview"}`, 화면 켜 두기를 맡는다. `src/link/answer.ts`의 `PHONE_HANDLERS`에 `drive.*` 넷이 있어 `hello.capabilities`에 오른다.
- 화면: 앱 화면 ⋯ menu의 "Preview from lophn"(preview가 돌 때만), live 폰 화면이 아직 없는 앱은 Home과 sidebar의 앱 줄이 "Preview" 표시와 함께 바로 preview를 연다(`src/screens/apps/preview.tsx`, `src/screens/home/apps.tsx`, `src/app/sidebar.tsx`). preview 화면 위 줄 아래에 "Preview" 줄, 요청이 오면 60초 동안 "<agent> is driving this screen"과 [Take control]/[Hand back] 줄이 선다. 둘 다 layout 안의 줄이고 guest를 덮지 않는다.

### lab에서 module만 보기

guest lab build(`EXPO_PUBLIC_LOPHN_GUEST_LAB=1`, 위 "Android 확인")에 drive fixture(`guest/fixtures/src/screens/drive`: Button, IconButton, `Field` 안 Input, secure Input, SegmentedControl, Checkbox, Switch, ScrollView 안 60줄, 8 s busy 단추, render 오류 단추, 줄 바꾸기 단추)와 단추가 있다.

| 단추 | 무엇 |
|---|---|
| `drive run` | fixture를 띄우고 API를 차례로 부른다: snapshot → 이름으로 node 찾기 → click → type → fill → Enter → Row 59 scroll과 click → screenshot jpeg·png → waitText → 줄 바꾼 뒤 옛 ref → busy 중 snapshot·screenshot. 결과와 ms를 화면 log와 logcat `LAB` 줄로 |
| `drive dump` | node마다 화면 좌표를 logcat에 찍는다(`uiautomator dump`와 견준다) |
| `drive watch` | 60초 동안 snapshot과 waitText를 되풀이한다(HOME, 화면 끄기, 다른 화면으로 가기 뒤의 답을 본다) |
| `drive shot` | jpeg와 png screenshot을 앱 문서 폴더에 쓰고 크기와 ms를 보인다 |
| `keep on`, `keep off` | `keepScreenOn` |

### 개발 core로 끝까지 보기

release build(손가락 입력은 release에서만 guest에 닿는다)를 emulator에 깔고 개발 core에 pairing한 뒤, 개발 core에 앱을 하나 만들어 폰 화면을 손으로 쓰고 release와 preview를 띄운다. 개발 core에는 model이 없으므로 앱을 만드는 일과 agent의 호출은 test 도구(`tests/support/app/activate.ts`의 `startTestApp`·`deliverRelease`·`prepareRelease`·`lophnTurn`, `tests/support/fake-server`)로 한다. `lophnTurn`이 앱 workspace session의 turn 하나에서 fake model이 `lophn` tool을 부르게 하므로 그 session(agent)의 자격으로 `tab open --phone`과 `browser *`가 돈다. 사람 token은 CLI를 그 data root로 부른다: `LOPHN_HOME=<data root> ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron packages/cli/main.ts tab open --phone <app>`(core의 control socket은 `$XDG_RUNTIME_DIR/lophn/<data root의 hash>`이고 `XDG_RUNTIME_DIR`가 없으면 `<tmp>/lophn-<uid>/<hash>`다. data root마다 폴더가 달라 사람의 core와 겹치지 않는다. 그래서 CLI는 core를 띄운 때와 같은 `XDG_RUNTIME_DIR`(있든 없든)로 불러야 socket을 찾는다. 다르면 core가 없다고 나온다).

1. 앱 source에 폰 화면 하나(입력은 `Field` 안, 긴 목록, operation 단추, `Sheet`를 여는 단추)를 쓰고 release와 `preview start <release>`. 폰 화면 앱의 의존은 `project-docs/architecture/phone-screen.md`의 "설치 비용"대로 `devDependencies`에 둔다.
2. remote를 켜고 초대장 글의 `reach.addresses`를 `["10.0.2.2"]`로 바꿔 붙여 넣는다(release build는 `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS`를 읽지 않는다).
3. 폰에서 앱 → ⋯ → Preview from lophn. 그 전과 뒤에 `tab open --phone`을 부른다(전에는 `unavailable`).
4. `browser snapshot`(Field label이 textbox 이름, `[offscreen]`, secure 칸 `••••`), `act click`(operation이 preview process로 불린다), `type`·`fill`·`press Enter`, `scroll --ref`와 `--dy`, `wait --text`(빈칸이 든 글은 tool 입력 JSON으로), `screenshot`(`.jpg`), `read`.
5. 거절: Take control 뒤 act, 옛 ref, Sheet를 열거나 notification shade를 내린 때(`covered`), HOME과 `KEYCODE_SLEEP` 뒤, preview 화면을 떠난 뒤, preview를 다시 지은 뒤의 옛 ref, `preview stop` 뒤, 다른 앱 workspace의 session.

결과(2026-11-16, emulator `lophn-phone` x86_64 API 36, release build, 개발 core와 fake model, 앱 workspace session의 자격):

| 본 것 | 결과 |
|---|---|
| `tab open --phone` 폰이 preview를 열기 전 / live 앱 화면만 보일 때 / 연 뒤 | `unavailable`(보이지 않음 문장) / 같다(live view는 고르지 않는다) / 탭 id |
| 다른 앱 workspace의 session이 연다, preview가 없을 때 연다 | `not_found` / `conflict` |
| snapshot | 첫 줄 `screen notes 411x739dp`, `textbox "Title"`(Field label), Row 5~60 `[offscreen]`, secure 칸 `value="••••"`. 한 호출(fake turn 포함) 0.4~1.1 s |
| act `type`·`fill`·`click`·`press Enter` | `fill`이 `type`한 글을 바꿨고, `Add note`가 preview process의 `save_item`을 불러 목록에 줄이 섰고, Enter가 `onSubmit`을 불렀다 |
| `scroll --ref`(Row 59) 뒤 click, `scroll --dy -400`, `wait --text`, `read` | `Picked: Row 59`, 화면이 움직였다, 됨, `phone://<app>/notes` |
| screenshot | agent는 JPEG 659x1080 18 KB(guest만), 사람 CLI는 `/tmp/lophn-screenshots/<tab>-<ms>.jpg` 30 KB |
| driving 줄, Take control, Hand back | "lophn is driving this screen"(사람 token은 "Someone on your computer"), take control 뒤 act `conflict`·snapshot·screenshot 됨·손가락 누름이 guest에 닿음, Hand back 뒤 act 됨 |
| 옛 ref, 다시 지은 preview 뒤의 옛 ref | `conflict`. 다시 지은 preview는 폰이 새 bundle로 다시 띄웠고 같은 탭의 새 snapshot이 됐다 |
| guest의 `Sheet`를 열었을 때, notification shade를 내렸을 때 | 모든 호출이 `unavailable` `covered` 문장. 닫으면 다시 된다 |
| HOME, `KEYCODE_SLEEP`, preview 화면을 떠남 | 앞에 없음 문장, 같다, 보이지 않음 문장. 돌아오면 된다 |
| guest 맨 위 요소를 누름(host 줄 바로 아래) | host의 Back·Take control이 눌리지 않았다 |
| 폰 network를 끊음 | 8초 안에는 "did not answer in time" `unavailable`. 다시 붙자 됨 |
| `preview stop` | 폰은 "The preview stopped on <컴퓨터>"와 Close, agent는 `unavailable`, `tab open`은 `conflict` |
| live 폰 화면이 없는 앱(prepare만 한 release)의 preview | Home 칸에 "Preview", sidebar 줄 "First screens · Preview", 누르면 바로 preview 화면, agent가 열고 누름. preview를 멈추자 표시가 사라졌다 |
| 폰 화면 둘인 preview | preview 화면 ⋯ menu에 `Second`, 고르면 다시 열림. `--screen second`는 폰이 first를 보일 때 `unavailable`, second를 보일 때 열림 |

알려진 한계: 앱 화면의 kit `Sheet`·`Menu`·`Drawer`는 화면 안의 층이라 닿지만(기기에서 보지 않았다) 화면이 직접 연 `Modal` 안은 다른 창이라 읽지도 누르지도 못한다(`covered`로 답한다). 가상화 목록의 그려지지 않은 줄과 가로 scroll은 snapshot에 들지 않는다(지침이 `scroll --dy` 뒤 다시 snapshot하라고 말한다). scroll 뒤 누르기는 정한 시간(150 ms, 300 ms)을 기다린다. type·fill은 칸을 누르지 않아 onPress가 불리지 않고 keyboard가 뜨지 않는다(지침이 먼저 `click`하라고 말한다). 같은 앱의 preview를 두 기기가 열면 phone 탭은 고른 기기에 그 기기의 preview view가 있는 동안 머문다. Back은 다루지 않는다(host 화면을 닫는다). iOS는 없다. 이슈 `phone-drive-settle-timing`.

## 정해 둔 것

- Android `applicationId`: `dev.lophn.mobile`(임시).
- `android.usesCleartextTraffic: true`(`expo-build-properties`): core 주소가 LAN의 아무 IP라 domain으로 좁힐 수 없다. 연결은 Noise로 암호화한다.
- `android.allowBackup: false`.
- `orientation: default`: 접은 폰이나 tablet처럼 폭 600 이상에 높이 480 이상이면 sidebar가 늘 열린 두 칸이 된다(wireframe 9 Wide screens). 가로로 든 폰은 낮아서 drawer 그대로다.
