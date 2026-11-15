# mobile

lophn 폰 앱. Expo SDK 58(React Native 0.88, React 19.3) dev build다(Expo Go가 아니다). root npm workspace 밖의(root `package.json`의 `"!packages/mobile"`) 독립 project라 자기 `package.json`과 lock file을 가지고, 저장소의 `npm run check`는 이 폴더를 보지 않는다(이 폴더의 `biome.json`이 저장소 Biome에서 이 폴더를 뺀다).

protocol 코드는 복사하지 않는다. Metro가 `packages/protocol/remote`의 TypeScript source를 그대로 읽는다(`metro.config.js`). 그쪽의 bare import(`zod`, `@noble/*`)는 이 폴더의 `node_modules`에서 찾으므로 판은 `packages/protocol/package.json`과 같게 맞춘다.

## 명령

모두 이 폴더에서 돈다.

| 명령 | 무엇 |
|---|---|
| `npm install` | 의존성. 판은 정확히 고정했다(`~`·`^` 없음) |
| `npm run typecheck` | `tsc --noEmit`. 앱 code와 앱이 import하는 `packages/` source까지 본다 |
| `npm test` | `node --test "src/**/*.test.ts"`. React Native를 import하지 않는 순수 logic(연결, 컴퓨터 store)만 test한다. node가 `packages/` source를 읽을 때 bare import는 root `node_modules`에서 찾으므로 root `npm install`이 되어 있어야 한다 |

merge 때 `npm run typecheck`와 `npm test`를 돌린다.

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
- 대화의 첨부는 native module `expo-image-picker`(Photos, Camera), `expo-document-picker`(Files), `expo-media-library`(sheet의 최근 사진 줄)를 쓴다. 사진·카메라 권한 문구는 `app.json`의 plugin 설정이다. emulator의 사진은 `adb -s <emulator> push`로 `/sdcard/Pictures`에 넣고 `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE`로 알린다.
- `CI=1`로 띄운 Metro는 file을 지켜보지 않는다. JS를 바꾸면 Metro를 다시 띄운다.
- emulator에서 이 machine은 `10.0.2.2`다.
- 첫 gradle build는 NDK·CMake를 `~/Android/Sdk`에 받아 몇 분 걸린다.
- prebuild가 만드는 `gradle.properties`의 Metaspace 512m로는 Kotlin 컴파일이 `OutOfMemoryError: Metaspace`로 멈출 수 있다. 그때는 `"-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m"`를 붙인다.

## 화면 이동

React Navigation 7(native stack과 drawer)이다. 아래 tab bar는 없다. 앱이 더 쓰는 native module은 `react-native-screens`, `react-native-gesture-handler`(drawer), `expo-camera`다.

- root stack(`src/app/root.tsx`): 컴퓨터가 하나도 없으면 연결 흐름(`src/screens/start/`: Welcome, Scan, Pairing, Paired, 실패 둘, Enter a pairing code sheet)에서 시작하고, 있으면 frame이다. 마지막 컴퓨터를 지우면 Welcome으로 돌아간다.
- frame(`src/app/frame.tsx`): 왼쪽 drawer가 sidebar(`src/app/sidebar.tsx`)이고 옆이 place의 stack이다. 폭 600 이상이면 sidebar가 늘 열려 있고 stack은 그 옆 card에 들며, 화면은 menu 단추를 두지 않는다. sidebar에서 고르면 stack이 [Home, 그 곳]으로 바뀌고, 화면 안에서 연 곳은 stack에 쌓인다.
- 갈 곳은 `src/app/nav.ts`의 `Place` 하나로 말한다. 화면은 `useNav()`의 `open(place)`, `back()`, `openSidebar()`, `openComputers()`와 `menuButton`(top-level 화면의 TopBar에 펼친다)을 쓴다. place마다 화면은 `src/app/routes.tsx`에 등록되어 있고, 그 화면은 `src/screens/<영역>/index.tsx`가 export하며 place를 `place` prop으로 받는다.
- 얼굴과 workspace 표식은 `src/parts/`다. vendor 아이콘은 desktop의 svg(`packages/shell/renderer/parts/vendor-icon/`)를 사본 없이 쓴다: Metro가 `.svg`를 글로 읽는다(`src/parts/svg-text-transformer.js`).
- 화면을 core 없이 보려면 Metro를 `EXPO_PUBLIC_LOPHN_SAMPLE=1`로 띄운다(dev build에서만). 지어낸 data의 sample 컴퓨터가 목록에 든다.

## pairing

처음 열면 Welcome이다. Scan the code로 camera 권한을 묻고 QR(core `pairing/start`의 JSON)을 `expo-camera`로 읽거나, Enter a pairing code instead로 그 JSON을 붙여 넣는다. Pairing 화면이 pair를 보내고 첫 연결이 열리기를 기다린 뒤 Paired에서 이 폰에서 부를 컴퓨터 이름을 확인시킨다. 지난 code는 Code expired, 닿지 않으면 Cannot reach 화면이다. 기기 key 쌍과 pairing한 컴퓨터 목록은 `expo-secure-store`(이 기기에서만, 잠금이 풀렸을 때만)에 둔다. 모양(theme, 글자 크기) 설정도 같은 곳에 둔다.

- emulator에서 pairing: Enter a pairing code instead를 누르고 칸에 `adb -s <emulator> shell "input text '<pairing/start JSON에서 expires_at을 뺀 것>'"`. emulator에는 camera 장면이 없다.
- `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS`(dev build에서만): Metro를 띄울 때 주면 이 주소를 QR의 주소들과 같이 걸어 먼저 붙는 것을 쓴다. 저장하지는 않는다. emulator는 이 machine에 `10.0.2.2`로 닿는데 QR에는 LAN 주소가 들기 때문이다. 예: `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2 npx expo start --dev-client --port 8199`.

## 연결

`src/connection/connection.ts`가 컴퓨터마다 연결 하나를 연다(`createConnection`). QR의 주소를 같이 걸어 먼저 handshake가 서는 것을 쓰고, 끊기면 backoff로 다시 붙고, 앱이 앞으로 오면 바로 붙거나 열린 연결을 `watch`로 확인한다. 붙을 때마다 마지막 `watch`를 다시 보낸다. 모양은 desktop의 `CoreSource`(상태 `starting`·`ready`·`stale`)다.

QR에 relay 주소(`relay`)가 있으면 컴퓨터 기록에 저장하고, 주소들과 같이 `<relay>/v1/phone?key=<core key>`도 건다. relay는 바이트만 넘기므로 handshake는 같고, 먼저 서는 길을 쓴다. relay가 생기기 전에 pairing한 폰은 relay를 모르므로 한 번 다시 pairing한다.

## 정해 둔 것

- Android `applicationId`: `dev.lophn.mobile`(임시).
- `android.usesCleartextTraffic: true`(`expo-build-properties`): core 주소가 LAN의 아무 IP라 domain으로 좁힐 수 없다. 연결은 Noise로 암호화한다.
- `android.allowBackup: false`.
- `orientation: default`: 가로로 돌리면 폭 600을 넘어 sidebar가 늘 열린 두 칸이 된다(wireframe 9 Wide screens).
