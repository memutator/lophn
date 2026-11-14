# phone-shell

- 목표: 폰 앱 껍데기를 만든다. QR로 pairing하고, 기기 key를 폰의 보안 저장소에 두고, core에 붙고, core가 내려준 remote 화면 bundle을 hash 확인 뒤 cache해 WebView로 띄운다. 이 계획은 Android에서 확인한다.
- 재료: `project-docs/products/roadmap/mobile.md`(설계안 "폰 앱의 모양", 단계 2), 계획 `phone-remote-web`의 README, `../harness-lab/_report/remote-control/orca.md` §14, `tools/remote-client.ts`
- 범위 밖: iOS 빌드와 확인(Mac이나 cloud 빌드, Apple Developer 계정이 준비된 뒤 계획을 따로 연다. iOS에서 달라지는 것은 spike가 조사만 한다), push, 위젯, 사용자 앱, 스토어에 올리기.

## 돌리기 전에 (사람)

- 이 machine에 Android 개발 도구를 깔아도 되는지 사람이 답해야 한다: OpenJDK 17, Android SDK(Platform 36과 37, Build-Tools, Platform-Tools, Emulator), emulator image 하나. `ANDROID_HOME`과 PATH를 건다. 답이 오기 전에는 어떤 task도 띄우지 않는다.

## 정한 것

- **stack.** Expo SDK 58(React Native 0.88, React 19.3), dev build로 돈다(Expo Go가 아니다). 의존성은 판을 정확히 고정한다(`expo install`이 쓰는 `~`를 고친다). (agent)
- **자리.** 저장소 맨 위의 `mobile/`에 자기 `package.json`과 lock file을 가진 project로 둔다. root의 npm workspace에 넣지 않는다. protocol 코드는 Metro가 `packages/protocol/remote/client.ts`를 source로 읽는다. (agent: React Native의 의존 tree가 Electron 설치와 `npm run check`에 섞이지 않는다. spike가 이 자리로 안 되면 보고하고 멈춘다)
- **암호와 무작위.** `@lophn/protocol/remote/client`를 그대로 쓴다. 무작위는 `expo-crypto`로 `RandomSource`를 만들어 넣는다. (agent)
- **key.** 기기 key 쌍은 `expo-secure-store`에 둔다(이 기기에서만, 잠금이 풀렸을 때만). page는 key를 보지 못한다. (agent)
- **화면은 native가 아니다.** native 화면은 pairing(QR, 붙여 넣기), 연결 상태, 컴퓨터 목록뿐이다. 나머지는 WebView의 remote 화면이다. (agent)
- **WebView.** 기본 `react-native-webview`가 아니라 자체 Expo module이다. Android는 `WebView`와 `shouldInterceptRequest`로 cache의 bundle만 내주고 다른 요청은 모두 막는다. page의 CSP는 `connect-src 'none'`이다. bridge는 message만 오간다(native 기능을 page에 내놓지 않는다). (agent, Orca의 꼴. App Store 심사 2.5.2와 4.7을 생각해 bridge를 좁게 둔다)
- **origin.** Android는 가로챈 https 가짜 host `https://remote.lophn.invalid/`다. custom scheme도 ES module, CSS, font는 읽혔지만 secure context가 아니라 `crypto.randomUUID`·`crypto.subtle`이 없고 bridge(`addWebMessageListener`)의 origin 규칙을 못 건다. iOS는 `WKURLSchemeHandler`가 http(s)를 못 받아 custom scheme으로 간다. page는 상대 path만 써서 둘에서 같다. (agent, spike `reports/mobile-spike.md`)
- **bundle cache.** `remote_ui/manifest`의 hash로 폴더를 나눠 저장하고 file마다 hash를 확인한다. 받는 중에는 앞의 것을 보이고, 다 받고 확인되면 바꾼다. core에 닿지 않으면 마지막 것을 띄우고 "닿지 않음"을 보인다. (agent)
- **연결.** QR의 주소를 같이 걸어 먼저 되는 것을 쓴다. 끊기면 backoff로 다시 붙고, 앱이 앞으로 오면 바로 다시 붙는다. 붙을 때마다 `watch`를 다시 보낸다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `mobile-spike` | 없음 | `mobile/` project를 세우고 위험 넷을 Android emulator에서 확인 |
| 2 | `mobile-pairing` | `mobile-spike` | QR pairing, key 저장, 연결과 다시 붙기, 컴퓨터 목록 화면 |
| 2 | `mobile-webview` | `mobile-spike` | 자체 WebView module: scheme handler, 요청 막기, bridge |
| 3 | `mobile-remote` | `mobile-pairing`, `mobile-webview` | bundle 받기와 cache, bridge를 연결에 잇기, remote 화면 띄우기 |

`mobile-remote`는 계획 `phone-remote-web`이 land된 뒤에 띄운다(`remote_ui/*` route와 `dist/remote`가 있어야 한다).

중간 land: wave 1(`mobile-spike`) 뒤에 한 번 land한다. `phone-remote-web`이 main에 land되어(0.23.58) plan branch가 그 `client.ts`와 `remote_ui/*`를 받아야 wave 3이 그 위에서 갈라진다.

## 위험 test (task brief에 있다)

- hash가 맞지 않는 file은 cache에 들지 않고 화면에 쓰이지 않는다.
- bridge는 정해진 message 종류 말고는 받지 않는다.

## lead가 할 일

- `mobile/`은 `npm run check` 밖이다. merge마다 `mobile/`의 type 검사와 test(spike가 정한 명령)를 돌린다. 저장소 쪽을 고쳤으면 `npm run check`도 돌린다.
- emulator를 띄우는 확인은 task마다 사람에게 묻지 않는다(이 계획의 일이다). emulator를 띄우는 자동 E2E를 새로 만드는 것은 묻는다.
- 끝나면: `architecture/remote.md`(없으면 만든다)에 폰 껍데기의 모델과 지키는 것, `boundary-catalog.yaml`과 `module-catalog.yaml`, change-log, roadmap `mobile.md` 단계 2를 끝남으로, AGENTS.md "문서"나 "코드"에 `mobile/`의 check 명령 한 줄.
- 사람에게: 끝난 뒤 Android 폰이나 emulator에서 QR을 찍어 대화와 승인 답하기까지 해 보는 확인을 부탁한다. iOS 준비(Mac이나 EAS, Apple Developer 계정)를 묻는다.
