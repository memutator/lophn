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
- emulator에서 이 machine은 `10.0.2.2`다.
- 첫 gradle build는 NDK·CMake를 `~/Android/Sdk`에 받아 몇 분 걸린다.

## pairing

처음 열면 pairing 화면이다. QR을 `expo-camera`로 찍거나 core `pairing/start`의 JSON을 붙여 넣고, 보이는 key 앞 글자와 주소를 확인한 뒤 Pair를 누른다. 기기 key 쌍과 pairing한 컴퓨터 목록은 `expo-secure-store`(이 기기에서만, 잠금이 풀렸을 때만)에 둔다.

- emulator에서 pairing: 붙여 넣기 칸을 누르고 `adb -s <emulator> shell "input text '<pairing/start JSON에서 expires_at을 뺀 것>'"`. emulator에는 camera 장면이 없다.
- `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS`(dev build에서만): Metro를 띄울 때 주면 이 주소를 QR의 주소들과 같이 걸어 먼저 붙는 것을 쓴다. 저장하지는 않는다. emulator는 이 machine에 `10.0.2.2`로 닿는데 QR에는 LAN 주소가 들기 때문이다. 예: `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS=10.0.2.2 npx expo start --dev-client --port 8199`.

## WebView

component는 `src/webview/LophnWebView.tsx`이고 native view는 `modules/lophn-webview`에 있다. origin은 `https://remote.lophn.invalid/`이고 `root` 폴더의 file만 내주며, CSP는 `connect-src 'none'`이다. 손으로 보는 test page는 `src/webview/test-page/`에 있고 APK에 들지 않는다. 보려면 `adb shell run-as dev.lophn.mobile`로 `/data/data/dev.lophn.mobile/files/<dir>`에 복사하고 그 path를 `root`로 넘긴다.

## 정해 둔 것

- Android `applicationId`: `dev.lophn.mobile`(임시).
- `android.usesCleartextTraffic: true`(`expo-build-properties`): core 주소가 LAN의 아무 IP라 domain으로 좁힐 수 없다. 연결은 Noise로 암호화한다.
- `android.allowBackup: false`.
