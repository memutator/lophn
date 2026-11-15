# mobile

lophn 폰 앱. Expo SDK 58(React Native 0.88, React 19.3) dev build다(Expo Go가 아니다). root npm workspace 밖의 독립 project라 자기 `package.json`과 lock file을 가지고, 저장소의 `npm run check`는 이 폴더를 보지 않는다(이 폴더의 `biome.json`이 저장소 Biome에서 이 폴더를 뺀다).

protocol 코드는 복사하지 않는다. Metro가 `packages/protocol/remote`의 TypeScript source를 그대로 읽는다(`metro.config.js`). 그쪽의 bare import(`zod`, `@noble/*`)는 이 폴더의 `node_modules`에서 찾으므로 판은 `packages/protocol/package.json`과 같게 맞춘다.

## 명령

모두 이 폴더에서 돈다.

| 명령 | 무엇 |
|---|---|
| `npm install` | 의존성. 판은 정확히 고정했다(`~`·`^` 없음) |
| `npm run typecheck` | `tsc --noEmit`. 앱 code와 앱이 import하는 `packages/` source까지 본다 |
| `npm test` | `node --test "src/**/*.test.ts"`. React Native를 import하지 않는 순수 logic(cache hash 확인, bridge message 거르기 등)만 test한다. node가 `packages/` source를 읽을 때 bare import는 root `node_modules`에서 찾으므로 root `npm install`이 되어 있어야 한다 |

merge 때 `npm run typecheck`와 `npm test`를 돌린다.

## 폰 UI kit과 gallery

- 화면은 폰 UI kit `@lophn/ui-native`(`packages/design/native/`)의 component로 짓는다. desktop의 `@lophn/ui`와 같은 token(`packages/design/tokens.ts`)을 쓰고 Markdown은 desktop과 같은 parse 결과를 그린다. Metro는 `metro.config.js`의 alias로, tsc는 `tsconfig.json`의 `paths`로 이 package를 찾는다(`paths`는 tsc만 읽는다. `app.json`의 `experiments.tsconfigPaths`를 껐다).
- kit의 root는 `UiProvider`다(safe area, keyboard, theme). kit이 쓰는 native module은 `react-native-svg`, `react-native-keyboard-controller`(와 그 peer인 `react-native-reanimated`, `react-native-worklets`), `react-native-safe-area-context`, `expo-clipboard`다. 더하면 prebuild와 gradle을 다시 돈다.
- gallery(`src/gallery/`)는 kit을 지어낸 data로 그린 화면이다(Sessions, Inbox, 대화, 모든 component, light·dark). dev build에서만 열린다: Metro를 `EXPO_PUBLIC_LOPHN_GALLERY=1 npx expo start --dev-client`로 띄우면 바로 gallery로 열리고, 아니면 컴퓨터 관리 화면의 `UI kit gallery`로 연다.

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

- native code(`modules/`, `app.json`, 의존성)를 바꾸면 prebuild와 gradle을 다시 돈다. JS만 바꾸면 Metro가 다시 읽는다.
- `CI=1`로 띄운 Metro는 file을 지켜보지 않는다. JS를 바꾸면 Metro를 다시 띄운다.
- emulator에서 이 machine은 `10.0.2.2`다.
- 첫 gradle build는 NDK·CMake를 `~/Android/Sdk`에 받아 몇 분 걸린다.

## pairing

처음 열면 pairing 화면이다. QR을 `expo-camera`로 찍거나 core `pairing/start`의 JSON을 붙여 넣고, 보이는 key 앞 글자와 주소(relay가 있으면 그 host)를 확인한 뒤 Pair를 누른다. 기기 key 쌍과 pairing한 컴퓨터 목록은 `expo-secure-store`(이 기기에서만, 잠금이 풀렸을 때만)에 둔다.

- emulator에서 pairing: 붙여 넣기 칸을 누르고 `adb -s <emulator> shell "input text '<pairing/start JSON에서 expires_at을 뺀 것>'"`. emulator에는 camera 장면이 없다.
- `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS`(dev build에서만): Metro를 띄울 때 주면 이 주소를 QR의 주소들과 같이 걸어 먼저 붙는 것을 쓴다. 저장하지는 않는다. emulator는 이 machine에 `10.0.2.2`로 닿는데 QR에는 LAN 주소가 들기 때문이다. 예: `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2 npx expo start --dev-client --port 8199`.

## 연결

`src/connection/connection.ts`가 컴퓨터마다 연결 하나를 연다(`createConnection`). QR의 주소를 같이 걸어 먼저 handshake가 서는 것을 쓰고, 끊기면 backoff로 다시 붙고, 앱이 앞으로 오면 바로 붙거나 열린 연결을 `watch`로 확인한다. 붙을 때마다 마지막 `watch`를 다시 보낸다. 모양은 desktop의 `CoreSource`(상태 `starting`·`ready`·`stale`)다.

QR에 relay 주소(`relay`)가 있으면 컴퓨터 기록에 저장하고, 주소들과 같이 `<relay>/v1/phone?key=<core key>`도 건다. relay는 바이트만 넘기므로 handshake는 같고, 먼저 서는 길을 쓴다. relay가 생기기 전에 pairing한 폰은 relay를 모르므로 한 번 다시 pairing한다.

## remote 화면

컴퓨터 목록 대신 고른 컴퓨터(처음엔 첫 컴퓨터)의 remote 화면이 열린다. 위의 얇은 native 줄로 컴퓨터를 바꾸거나 목록(`Computers`)으로 간다.

- **bundle cache**(`src/bundle/`): 연결이 `ready`가 될 때마다 `remote_ui/manifest`를 읽는다. 그 hash의 폴더가 없으면 file을 하나씩 `remote_ui/file`(base64)로 받아 `staging/`에 쓰고 hash를 확인한 뒤, 다 맞으면 `staging/`을 hash 이름으로 바꾼다. 하나라도 틀리면 그 bundle은 버린다. 자리는 앱 file 폴더의 `remote-ui/<컴퓨터 key>/`이고, `current`가 화면에 띄우는 bundle을 적는다. 새 bundle이 확인되면 바꿔 띄우고 옛 bundle은 하나만 남긴다. 컴퓨터를 지우면 그 폴더도 지운다.
- **닿지 않을 때**: 마지막 bundle을 띄운 채 page가 연결 상태(`stale`)를 보인다. bundle이 하나도 없으면 native 화면이 "Cannot reach this computer."를 보인다.
- **WebView**(`src/webview/`, native view는 `modules/lophn-webview`): origin `https://remote.lophn.invalid/`, 지금 bundle 폴더의 file만 내주고 다른 요청은 막는다. CSP는 `connect-src 'none'`이다. page의 `<input type=file>`은 Android의 file 고르기를 연다(대화의 사진 붙이기).
- **bridge**(`src/webview/bridge.ts`, `src/remote/link.ts`): native view가 page에 `globalThis.lophnRemote`(`CoreSource` 모양)를 넣는다. page가 보내는 `call`·`watch`를 연결로 넘기고, 답과 event, 연결 상태를 page로 보낸다. native는 page가 처음 보낸 message(document 시작 때의 `state`) 뒤에야 page에 보낼 수 있어서, 상태와 event는 그 `state` 요청부터 흘린다. upload bytes와 file 답은 base64로 오간다.

손으로 보는 test page는 `src/webview/test-page/`에 있고 APK에 들지 않는다. 보려면 `adb shell run-as dev.lophn.mobile`로 `/data/data/dev.lophn.mobile/files/<dir>`에 복사하고 그 path를 `root`로 넘긴다.

### emulator에서 remote 화면 띄우기

1. 저장소 root에서 `node packages/shell/renderer/build.ts`로 `dist/remote`를 만들고 개발 core(`npm run dev:core`)를 띄운다.
2. core에서 `remote.enabled`를 켜고 `pairing/start`의 JSON을 받는다(`tools/remote-dev.ts`가 하는 것과 같다).
3. `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2`로 Metro를 띄우고 위 "pairing"대로 붙인다. 붙으면 bundle을 받아 remote 화면이 열린다.

같은 화면을 폰 없이 browser로 보려면 `npm run dev:remote`(저장소 root)를 쓴다.

## 정해 둔 것

- Android `applicationId`: `dev.lophn.mobile`(임시).
- `android.usesCleartextTraffic: true`(`expo-build-properties`): core 주소가 LAN의 아무 IP라 domain으로 좁힐 수 없다. 연결은 Noise로 암호화한다.
- `android.allowBackup: false`.
