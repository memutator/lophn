# mobile-spike: `mobile/` Expo project와 Android에서 본 위험 넷

- 계획: `project-docs/plan/phone-shell/` task `mobile-spike` (2026-11-15)
- 환경: Expo SDK 58.0.25, React Native 0.88.1(Hermes, New Architecture), AVD `lophn-phone`(android-36 google_apis x86_64), worktree의 dev core(`npm run dev:core`, fake provider, data root는 worktree의 `.dev-data`).
- 확인 방법: `mobile/App.tsx`의 spike 화면이 Hermes 확인, pairing과 call, WebView 두 개(custom scheme과 https 가짜 host)를 띄우고 결과를 logcat에 찍는다. 시험 page는 `mobile/modules/lophn-webview/android/src/main/assets/spike/`에 있다. 로그와 화면 capture는 `.dev-data/mobile-spike/`(commit하지 않음).

## 판정 요약

| 확인 | 판정 | 한 줄 |
|---|---|---|
| 1. Metro가 `packages/protocol/remote` source를 읽는가 | **된다** | `.ts` 확장자 import와 `@noble/*/x.js` subpath 모두 기본 resolver로 풀린다. 설정은 `watchFolders` 하나와, `packages/`의 bare import를 `mobile/node_modules`로 돌리는 `resolveRequest` 한 개 |
| 2. Hermes에서 handshake와 frame | **된다** | `TextDecoder` fatal, `zod`, `btoa`/`atob`, `expo-crypto` 무작위, x25519 모두 그대로 돈다. emulator에서 `ws://10.0.2.2:7432/remote`로 붙어 pair하고, 다시 붙어 `session_snapshots/list`를 불러 답을 받았다 |
| 3. WebView: page가 ES module·CSS·font를 읽고 다른 요청을 막는가 | **된다(둘 다)**, 고른 origin은 **https 가짜 host** | custom scheme도 module·CSS·font가 읽힌다. 하지만 secure context가 아니라 `crypto.randomUUID`·`crypto.subtle`이 없고, bridge의 origin 규칙도 못 건다 |
| 4. bridge: page와 native 사이 message 양쪽 | **된다** | `WebViewCompat.addWebMessageListener`가 document 시작 때 `lophnNative` object를 넣는다. page → native → RN JS → native → page 왕복을 봤다 |

## 1. Metro와 protocol source

- `mobile/metro.config.js`:
  - `watchFolders = [../packages]`
  - `resolver.resolveRequest`: 요청한 file이 `packages/` 아래이고 bare import면, `mobile/index.ts`에서 부른 것처럼 푼다. 그래서 `zod`, `@noble/*`는 늘 `mobile/node_modules`에서 오고, root `npm install`과 root `node_modules`(watch 밖)에 기대지 않는다.
- `disableHierarchicalLookup: true`로는 안 된다: Expo가 `node_modules/expo/node_modules/expo-asset` 같은 중첩 node_modules를 쓰는데 그것까지 못 찾는다.
- `.ts` 확장자 import(`./noise.ts`)와 package exports의 subpath(`@noble/ciphers/chacha.js`)는 따로 설정할 것이 없다.
- `npx expo export --platform android`도 통과한다(Hermes bytecode 2.7 MB, module 802개).
- 무게: `frames.ts`가 `events/gateway.ts`를 import해서, 폰 bundle에 protocol file 85개쯤(acp, approvals, lophn-agent 값 등)이 같이 든다. `remote/client.ts`의 좁은 입구도 `frames.ts`를 거치므로 이것은 그대로다. 지금은 동작에 문제가 없다.
- type 검사(`npm run typecheck`): TypeScript 6은 `types`의 기본이 `[]`라 `"types": ["node"]`와 `@types/node`가 있어야 한다(`packages/base/os/tree.ts`가 `NodeJS.Signals`를 쓴다). `zod`·`@noble/*`는 tsconfig `paths`로 `mobile/node_modules`에 맞춘다.

## 2. Hermes와 core 연결

emulator logcat(마지막 실행):

```
spike TextDecoder fatal: ok ("한글 ok", invalid bytes throw)
spike zod: ok
spike btoa/atob: ok
spike expo-crypto random: ok
spike x25519: ok
spike handshake ok
spike pair: {"type":"result","id":"pair","ok":true,"value":{"device":"dev_01m7dp1jqw47d55vdyzxv5wd0x"}}
spike call session_snapshots/list: {"type":"result","id":"call","ok":true,"value":{"snapshots":[],"as_of_seq":"0","next_cursor":null}}
```

- 순서는 `tools/remote-client.ts`와 같다: 새 key로 붙어 `pair`, 닫고, 같은 key로 다시 붙어 `call` 하나.
- `RandomSource`는 `{ fill: (bytes) => getRandomValues(bytes) }`(`expo-crypto`)다. Hermes에는 전역 `crypto.getRandomValues`가 없으므로 `cryptoRandom`(`packages/base`)을 폰에서 쓰면 안 된다.
- RN `WebSocket`은 `binaryType = "arraybuffer"`와 `send(Uint8Array)`가 그대로 된다. transport 꼴은 `tools/remote-client.ts`의 것을 그대로 옮겼다(`mobile/src/spike.ts`).
- cleartext: debug build는 원래 cleartext가 열려 있다. release를 위해 `expo-build-properties`로 `android.usesCleartextTraffic: true`를 걸었고, prebuild한 `AndroidManifest.xml`에 들어간 것을 봤다. core 주소가 LAN의 아무 IP라 `network_security_config`의 domain 목록으로 좁힐 수 없다.
- QR의 주소는 host의 LAN IP(`192.168.0.3`)였다. emulator에서는 `10.0.2.2`를 썼다. 실제 폰은 QR 주소를 쓴다.

## 3. WebView origin과 요청 막기

자체 Expo module(`mobile/modules/lophn-webview`): `WebView` + `shouldInterceptRequest`. origin 아래 path만 assets에서 내주고, 그 밖은 모두 빈 403을 돌려준다. `shouldOverrideUrlLoading`은 origin 밖 navigation을 막는다. page의 CSP는 `<meta>`의 `connect-src 'none'`이다.

| page에서 본 것 | `lophn-app://remote/` | `https://remote.lophn.invalid/` |
|---|---|---|
| `<script type="module">` + `import "./dep.js"` | 된다 | 된다 |
| CSS(`<link rel=stylesheet>`) | 된다 | 된다 |
| `@font-face` woff2 | 된다 | 된다 |
| CORS header 필요 | 없다(header 없이 module이 읽힘) | 없다 |
| `location.origin` | `lophn-app://`(host가 빠진다) | `https://remote.lophn.invalid` |
| `isSecureContext` | **false** | true |
| `crypto.randomUUID`, `crypto.subtle` | **없다** | 있다 |
| bridge origin 규칙 | **안 받는다**(`allowedOriginRules lophn-app://remote is invalid`). `"*"`로만 된다 | `https://remote.lophn.invalid` 하나로 좁힌다 |
| CSP 아래 `fetch`(밖, host), `WebSocket` | 막힘(CSP) | 막힘(CSP) |
| CSP 아래 `<img>` 밖 주소 | 막힘(interceptor가 403, log에 `blocked request`) | 막힘(같음) |
| CSP 없는 frame의 `fetch` | 막힘(interceptor) | 막힘(interceptor) |
| CSP 없는 frame의 `ws://` | **interceptor에 안 보인다**(log 없음). CSP만 막는다 | mixed content로 막힘. `wss://`는 CSP만 막는다 |

**고른 origin: Android는 `https://remote.lophn.invalid/`.** custom scheme으로도 읽기는 되지만, 화면 code(`packages/shell/renderer`)가 `crypto.randomUUID`를 여러 곳에서 쓰는데 custom scheme page는 secure context가 아니라 그것이 없다. bridge도 `"*"`로 열어야 한다. `.invalid`는 예약 TLD라 interceptor를 빠져나간 요청이 실제 server에 닿을 수 없다. Capacitor도 같은 이유로 Android는 `https://localhost`, iOS는 custom scheme을 쓴다. page code는 상대 path만 쓰므로 OS마다 origin이 달라도 page는 같다.

다른 요청을 모두 막을 수 있는가: **interceptor + CSP로 된다.** `shouldInterceptRequest`는 http(s)의 document·subresource·`fetch`·XHR를 다 본다. `WebSocket`은 보지 못하므로 CSP `connect-src 'none'`이 꼭 있어야 한다. 그 밖에 뒤 task가 걸 것: DOM storage는 기본으로 꺼져 있었고(`localStorage`가 null), `allowFileAccess`·`allowContentAccess`는 껐다. Service Worker는 `ServiceWorkerController`의 client가 따로 가로채므로, 막으려면 그쪽도 건다(이 spike에서 보지 않았다).

## 4. bridge

- `androidx.webkit:webkit:1.18.0`의 `WebViewCompat.addWebMessageListener(webView, "lophnNative", setOf(origin규칙))`. page를 load하기 전에 걸면 document 시작부터 `lophnNative`가 있다(`postMessage`, `onmessage`).
- page → native: `lophnNative.postMessage(string)`. native는 Expo view event `onMessage({data})`로 RN JS에 넘긴다.
- native → page: listener가 받은 `JavaScriptReplyProxy.postMessage(string)`. RN JS는 view ref의 `postMessage(data)`(view AsyncFunction)로 부른다. page가 먼저 한 번 보내야 reply proxy가 생긴다.
- 본 왕복: page `probes` → RN → page `hello from native …` → page `ack` → RN. 두 origin 모두 됐다(custom scheme은 `"*"` 규칙으로).
- 규칙에 맞지 않는 origin의 frame에는 object가 들지 않는다. https 가짜 host를 고르면 규칙 하나로 page만 bridge를 본다.

## 5. iOS에서 달라질 것(조사만, 빌드하지 않음)

- **scheme handler.** iOS는 `WKURLSchemeHandler`(`setURLSchemeHandler(_:forURLScheme:)`)로 custom scheme만 받는다. WebKit이 직접 다루는 `http`·`https`에는 handler를 걸 수 없다. 그래서 iOS는 `lophn-app://remote/`다. custom scheme page가 secure context인지는 WebKit 판에 따라 달랐다(예전에는 아니었고, 근래 WebKit은 custom scheme을 secure context로 본다는 보고가 있다). iOS를 처음 빌드할 때 `isSecureContext`와 `crypto.randomUUID`를 먼저 본다. 안 되면 `randomUUID`를 bridge 밖 page 안 대체(`crypto.getRandomValues`는 secure context가 필요 없다)로 둬야 한다.
- **요청 막기의 한계.** WKWebView에는 `shouldInterceptRequest`가 없다. custom scheme 요청만 handler에 오고, `https`·`ws` 요청은 handler를 거치지 않는다. 막는 수단은 CSP(`default-src` 좁게, `connect-src 'none'`), `WKContentRuleList`(URL pattern으로 resource load 막기), `decidePolicyFor navigationAction`(navigation)이다. 그래서 iOS에서는 CSP가 주 방어선이고 Android보다 한 겹 적다.
- **bridge.** `WKUserContentController.add(_:name:)` + `WKUserScript(injectionTime: .atDocumentStart, forMainFrameOnly: true)`. `WKContentWorld`로 page world와 떼어 둘 수 있다. native → page는 `evaluateJavaScript`(또는 `callAsyncJavaScript`)다.
- **ATS.** `ws://`는 ATS 대상이다. `NSAppTransportSecurity`에 `NSAllowsLocalNetworking`(local 주소의 평문 허용)을 둔다. IP 주소 연결이 ATS 밖인지는 판마다 말이 달라 iOS 빌드 때 확인한다. Orca는 local network와 Tailscale 범위에 예외를 둔다.
- **local network 허락.** iOS 14부터 LAN 주소에 붙으려면 사람이 허락해야 하고, `NSLocalNetworkUsageDescription`이 Info.plist에 있어야 한다. 처음 붙을 때 OS가 묻고, 거절하면 연결이 조용히 실패하므로 pairing 화면에 안내가 필요하다.
- **key 저장.** `expo-secure-store`의 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.

## 뒤 task가 알아야 할 설정

- `mobile/`은 root workspace 밖이다. 명령은 `mobile/README.md`: `npm run typecheck`, `npm test`(`node --test "src/**/*.test.ts"`, React Native를 import하지 않는 logic만).
- `mobile/biome.json`(`"root": false`, `files.includes: ["!**"]`)이 저장소 Biome에서 `mobile/`을 뺀다. 없으면 `check:full`의 fmt가 `mobile/android/` build 산출물을 읽고 실패한다.
- protocol 입구: `mobile/src/remote.ts`가 `remote/client.ts`와 같은 이름을 내놓는다. `client.ts`가 main에 오면 이 file을 `export * from "../../packages/protocol/remote/client.ts";` 한 줄로 바꾼다.
- 무작위는 `expo-crypto`의 `getRandomValues`로 만든 `RandomSource`다(`packages/base`의 `cryptoRandom`은 Hermes에 없다).
- Android `applicationId`: `dev.lophn.mobile`(임시). dev client deep link scheme은 `exp+lophn`.
- cleartext: `expo-build-properties`의 `android.usesCleartextTraffic: true`. `allowBackup: false`.
- WebView: origin `https://remote.lophn.invalid/`, bridge 이름 `lophnNative`, origin 규칙은 그 host 하나. CSP `connect-src 'none'`은 반드시(WebSocket은 interceptor에 안 보인다). 시험 page와 assets의 `spike/`는 cache bundle로 바꿀 때 지운다.
- `androidx.webkit:webkit:1.18.0`(module의 `build.gradle`).
- native를 바꾸면 `npx expo prebuild --platform android --no-install` 뒤 gradle을 다시 돈다. `android/`는 git에 넣지 않는다.
- 첫 gradle build는 3분 30초쯤, NDK 27.1과 CMake를 `~/Android/Sdk`에 받는다.

## 무겁게 짠 것

- `metro.config.js`의 `resolveRequest`: root `node_modules`를 watch에 넣고 hierarchical lookup에 맡기면 설정이 한 줄 적지만, 폰 bundle의 `zod`·`@noble` 판이 root 설치에 따라 바뀐다. 판을 `mobile/`의 lock file 하나로 묶으려고 10줄을 더했다.
- spike 화면은 WebView 두 개(두 origin)를 나란히 띄운다. 비교가 끝났으니 뒤 task는 하나만 둔다.

## 알려진 미완 동작

- Service Worker 요청 막기(`ServiceWorkerController`)는 보지 않았다.
- custom scheme의 CSP 없는 `ws://`가 실제로 network에 나갔는지는 interceptor log가 없다는 것과 오류가 "ws error"(연결 시도 뒤 실패)였다는 것으로만 봤다.
- release build, 실제 폰, 화면 잠금 뒤 다시 붙기는 보지 않았다.
- `remote/client.ts`가 아직 이 branch에 없어 `mobile/src/remote.ts`가 대신한다(key 글자 함수 두 개를 그대로 옮겨 둠).
- iOS는 문서 조사만 했다. Apple 문서 page가 script로만 그려져 본문을 못 읽은 곳이 있어, secure context와 ATS의 IP 예외는 "iOS 빌드 때 확인"으로 남겼다.
