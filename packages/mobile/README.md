# mobile

lophn 폰 앱. Expo SDK 58(React Native 0.88, React 19.3) dev build다(Expo Go가 아니다). root npm workspace 밖의(root `package.json`의 `"!packages/mobile"`) 독립 project라 자기 `package.json`과 lock file을 가지고, 저장소의 `npm run check`는 이 폴더를 보지 않는다(이 폴더의 `biome.json`이 저장소 Biome에서 이 폴더를 뺀다).

protocol 코드는 복사하지 않는다. Metro가 `packages/protocol/remote`의 TypeScript source를 그대로 읽는다(`metro.config.js`). 그쪽의 bare import(`zod`, `@noble/*`)는 이 폴더의 `node_modules`에서 찾으므로 판은 `packages/protocol/package.json`과 같게 맞춘다.

## 명령

모두 이 폴더에서 돈다.

| 명령 | 무엇 |
|---|---|
| `npm ci` | 의존성. lock대로 깐다. 판은 정확히 고정했다(`~`·`^` 없음). 새 의존을 더할 때만 `npm install` |
| `npm run typecheck` | `tsc --noEmit`. 앱 code와 앱이 import하는 `packages/` source까지 본다 |
| `npm test` | `node --test "src/**/*.test.ts"`. React Native를 import하지 않는 순수 logic(연결, 컴퓨터 store)만 test한다. node가 `packages/` source를 읽을 때 bare import는 root `node_modules`에서 찾으므로 root `npm install`이 되어 있어야 한다 |

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

- native module(`app.json`, 의존성)을 바꾸면 prebuild와 gradle을 다시 돈다. JS만 바꾸면 Metro가 다시 읽는다.
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

React Navigation 7(native stack과 drawer)이다. 아래 tab bar는 없다. 앱이 더 쓰는 native module은 `react-native-screens`, `react-native-gesture-handler`(drawer), `expo-camera`, `expo-notifications`(알림, 아래)다.

- root stack(`src/app/root.tsx`): 컴퓨터가 하나도 없으면 연결 흐름(`src/screens/start/`: Welcome, Scan, Pairing, Paired, 실패 둘, Enter a pairing code sheet)에서 시작하고, 있으면 frame이다. 마지막 컴퓨터를 지우면 Welcome으로 돌아간다.
- frame(`src/app/frame.tsx`): 왼쪽 drawer가 sidebar(`src/app/sidebar.tsx`)이고 옆이 place의 stack이다. 폭 600 이상에 높이 480 이상이면 sidebar가 늘 열려 있고 stack은 그 옆 card에 들며, 화면은 menu 단추를 두지 않는다. 가로로 든 폰은 폭이 넘어도 낮아서 drawer로 둔다. sidebar에서 고르면 stack이 [Home, 그 곳]으로 바뀌고, 화면 안에서 연 곳은 stack에 쌓인다.
- 갈 곳은 `src/app/nav.ts`의 `Place` 하나로 말한다. 화면은 `useNav()`의 `open(place)`, `back()`, `openSidebar()`, `openComputers()`와 `menuButton`(top-level 화면의 TopBar에 펼친다)을 쓴다. place마다 화면은 `src/app/routes.tsx`에 등록되어 있고, 그 화면은 `src/screens/<영역>/index.tsx`가 export하며 place를 `place` prop으로 받는다.
- 얼굴과 workspace 표식은 `src/parts/`다. vendor 아이콘은 desktop의 svg(`packages/shell/renderer/parts/vendor-icon/`)를 사본 없이 쓴다: Metro가 `.svg`를 글로 읽는다(`src/parts/svg-text-transformer.js`).
- 화면을 core 없이 보려면 Metro를 `EXPO_PUBLIC_LOPHN_SAMPLE=1`로 띄운다(dev build에서만). 지어낸 data의 sample 컴퓨터가 목록에 든다(`src/data/sample.ts`). 저장하지 않고 하는 일은 메모리만 바꾼다. 화면 모양은 sample로, 동작은 아래 개발 core로 본다.
- 화면 아래의 data 층(`src/data/`)은 desktop의 event client, Inbox store, 대화 source를 그대로 쓴다. 화면은 `src/data/mod.ts`의 hook만 import하고 연결을 만지지 않는다. desktop의 순수 logic만 가져오고 DOM file은 가져오지 않는다. 문구는 `@lophn/i18n`의 key다(폰에만 있는 것은 `mobile.`로 시작). Hermes에 없는 `Intl` 일부는 `src/app/intl.ts`의 영어 대체다.

## pairing

처음 열면 Welcome이다. Scan the code로 camera 권한을 묻고 QR(core `pairing/start`의 JSON)을 `expo-camera`로 읽거나, Enter a pairing code instead로 그 JSON을 붙여 넣는다(desktop Settings › Remote의 QR 아래 "Show as text"가 그 글이다). Pairing 화면이 pair를 보내고 첫 연결이 열리기를 기다린 뒤 Paired에서 이 폰에서 부를 컴퓨터 이름("Shown as")을 확인시킨다. 지난 code는 Code expired, 닿지 않으면 Cannot reach 화면이다. 기기 key 쌍과 pairing한 컴퓨터 목록은 `expo-secure-store`(이 기기에서만, 잠금이 풀렸을 때만)에 둔다. 모양(theme, 글자 크기) 설정도 같은 곳에 둔다.

컴퓨터를 지우면(Settings) 그 컴퓨터에 붙어 있을 때 컴퓨터의 등록도 `devices/unpair`로 지운다. 닿지 않으면 폰만 잊고, 다음에 같은 컴퓨터와 pairing하면 컴퓨터가 옛 등록을 새 등록으로 바꾼다. 마지막 컴퓨터를 지우면 Welcome으로 돌아간다.

### 개발 core와 pairing

개발 core는 사람의 `~/.lophn`이 아니라 `.dev-data/`를 쓴다. 실제 relay에는 붙지 않는다.

1. 저장소 root에서 개발 core를 띄운다: `npm run dev:core`(창 없이 core만. 창까지는 `npm run dev`).
2. 다른 터미널에서 `npm run dev:remote`. 개발 core의 remote를 켜고(port 47432) pairing text를 찍는다. code는 5분, 한 번이다. 다시 받으려면 다시 띄운다.
3. 폰이나 emulator에서 Enter a pairing code instead를 열어 그 글을 붙여 넣는다. emulator에서는 `adb -s emulator-<port> shell "input text '<pairing text에서 expires_at을 뺀 것>'"`(`</dev/null`을 붙여 스크립트에서 돌린다). emulator에는 camera 장면이 없다.
4. emulator는 이 machine에 `10.0.2.2`로 닿는데 QR에는 LAN 주소가 들기 때문에 Metro를 `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2`로 띄운다(dev build에서만. 이 주소를 QR의 주소들과 같이 걸어 먼저 붙는 것을 쓰고, 저장하지는 않는다). 예: `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2 npx expo start --dev-client --port 8199`.

## 연결

`src/connection/connection.ts`가 컴퓨터마다 연결 하나를 연다(`createConnection`). QR의 주소를 같이 걸어 먼저 handshake가 서는 것을 쓰고, 끊기면 backoff로 다시 붙고, 앱이 앞으로 오면 바로 붙거나 열린 연결을 `watch`로 확인한다. 붙을 때마다 마지막 `watch`를 다시 보낸다. 모양은 desktop의 `CoreSource`(상태 `starting`·`ready`·`stale`)다.

QR에 relay 주소(`relay`)가 있으면 컴퓨터 기록에 저장하고, 주소들과 같이 `<relay>/v1/phone?key=<core key>`도 건다. relay는 바이트만 넘기므로 handshake는 같고, 먼저 서는 길을 쓴다. relay가 생기기 전에 pairing한 폰은 relay를 모르므로 한 번 다시 pairing한다.

## 알림

`src/push/`가 맡는다. 알림의 글은 core가 정해 보내고(`PushMessage`) 폰은 만들지 않는다. 누구에게 언제 무엇을 보낼지의 규칙은 core의 몫이다(`project-docs/architecture/attention.md`). 폰이 하는 일:

- 알림 채널 `needs-you`(high), `finished`, `apps`를 앱이 시작할 때 만든다. 허락(Android 13)과 token을 부르기 전이다.
- Paired 화면의 `Turn on notifications`가 허락을 묻고, 허락되면 Expo push token을 받는다. `Not now`는 끈 채로 둔다(Paired는 한 번만 묻고 다른 컴퓨터를 pairing해도 다시 묻지 않는다). Settings › Notifications에서 나중에 켠다. 거절이면 그 화면에 시스템 설정을 여는 단추가 선다.
- 설정(스위치 일곱)과 token은 pairing한 모든 컴퓨터에 `devices/set_push`로 보낸다(붙을 때마다, 바뀔 때마다). 앱이 앞에 있는지와 열린 session은 `presence/report`로 보낸다(앞뒤가 바뀔 때, session 화면이 열고 닫힐 때, 앞에 있는 동안 30초마다).
- 알림을 누르면 `data.host`의 컴퓨터를 고르고 session·앱·Inbox를 연다(앱이 떠 있을 때는 listener, 꺼져 있었으면 `getLastNotificationResponse()`). `data`는 `parseNotificationData`가 읽고 모양이 틀리거나 이 폰에 pairing하지 않은 컴퓨터면 아무것도 열지 않는다. 터미널 coding agent의 알림(`term:<탭>`)은 폰이 열 수 없어 Inbox로 가고, 목록에 없는 session은 8초 기다린 뒤 Inbox를 연다.

계정이 필요한 부분: Expo push token은 EAS project id(`app.json`의 `expo.extra.eas.projectId`)가 있어야 받고, FCM 배달은 Firebase project의 `google-services.json`(`expo.android.googleServicesFile`)이 있어야 한다. 둘 다 아직 없다. 그래서:

- dev build(`__DEV__`)는 앱이 처음 쓸 때 만들어 저장한 가짜 token `ExponentPushToken[lophn-dev-<무작위>]`를 `devices/set_push`로 보낸다. 개발 core의 fake push server(`tests/support/fake-push`)가 이 token으로 온 글을 받는다. 폰에 알림을 그리지는 못한다(그리는 것은 Expo의 일이다).
- 그 밖의 build는 token을 받을 수 없어 알림이 "이 build에서는 쓸 수 없다"로 서고 아무것도 등록하지 않는다.
- Settings › Notifications 맨 아래(dev build에서만)의 `Send a test notification`은 5초 뒤 같은 `data`의 local 알림을 띄운다. 앱을 뒤로 보내 보고, 누르면 그 session(없으면 Inbox)으로 가는지 본다. 앱이 앞에 있으면 배너를 그리지 않는다.
- 개발 core 쪽 길: `npm run dev`와 `npm run dev:core`는 fake push server(port 7498, 바꾸려면 `LOPHN_DEV_PUSH_PORT`)를 띄우고 그 주소를 개발 data root의 설정 `remote.push`에 적는다. fake가 받은 글은 core를 띄운 터미널에 `push: <제목> | <본문> | <data>` 한 줄로 찍힌다. 글이 나가려면 `npm run dev:remote`로 remote가 켜져 있고, 폰이 앱 안에서 알림을 켜 `devices/set_push`로 token을 두었고, 폰이 앞에 없어야 한다(앱을 뒤로 보낸다). 그 상태에서 core에 사람을 기다리는 일(승인, 앱의 `notify()`)이 생기면 한 줄이 찍힌다.
- 허락 거절은 `adb -s emulator-<port> shell pm revoke dev.lophn.mobile android.permission.POST_NOTIFICATIONS`로 본다.

## 정해 둔 것

- Android `applicationId`: `dev.lophn.mobile`(임시).
- `android.usesCleartextTraffic: true`(`expo-build-properties`): core 주소가 LAN의 아무 IP라 domain으로 좁힐 수 없다. 연결은 Noise로 암호화한다.
- `android.allowBackup: false`.
- `orientation: default`: 접은 폰이나 tablet처럼 폭 600 이상에 높이 480 이상이면 sidebar가 늘 열린 두 칸이 된다(wireframe 9 Wide screens). 가로로 든 폰은 낮아서 drawer 그대로다.
