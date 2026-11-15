# remote

폰의 remote 화면이다. pairing한 폰이 컴퓨터의 core에 붙어 lophn agent의 session 목록을 보고, 대화를 읽고 보내고 멈추고, 승인과 질문에 답한다. 화면은 core가 web bundle로 내려주고 폰 껍데기(`mobile/`, Android)가 그 bundle을 hash 확인 뒤 cache해 띄운다. 연결(listener, Noise, pairing)은 `platform.md`의 "폰이 붙는 listener", 기기 자격과 route 목록은 `approval.md`의 "폰(기기) 자격", 기기에 가는 event는 `event.md`가 맡는다.

## 문제

- 폰에서 일을 이어 가려면 desktop과 같은 대화 화면이 있어야 한다. 대화 화면(ACP reducer, 승인·질문 card, 대기열, rewind)을 폰용으로 다시 짜면 같은 해석이 두 벌이 되고 고칠 때마다 둘을 맞춰야 한다.
- 화면을 폰 앱에 묶어 두면 화면을 고칠 때마다 폰 앱을 다시 build하고 배포해야 한다.
- desktop 대화 화면은 desktop만의 것(터미널에서 돌리기, file 열기, 끌어 놓기, mermaid, 앱 card의 webview, preload 통로)을 끌고 온다. 그대로 묶으면 폰 bundle이 무겁고 폰에 없는 통로를 부른다.

## 목표와 비목표

- 목표: desktop renderer의 대화(`AgentView`), Inbox(`waiting/`), event 층, 공통 읽기(`useCoreRead`)를 폰 host로 그대로 쓴다. 화면 bundle은 core가 내려주고 hash로 바뀐 것만 받게 한다. 폰 없이 desktop browser에서 실제 core에 붙어 화면을 확인한다.
- 비목표: iOS 껍데기(Mac이나 cloud 빌드가 준비된 뒤), push, harness GUI 중계, 사용자 앱 화면. 폰에서 secret 넣기(보호 입력 창은 desktop의 것이다). 폰에서 skip 켜기와 session 지우기.

## 모델

```
폰 껍데기 ──(Noise 연결, call/watch frame)──▶ core remote listener
   │ globalThis.lophnRemote: CoreSource
   ▼
remote bundle (renderer entry `remote`, dist/remote)
   RemoteApp: 아래 탭 둘(Sessions, Inbox)과 대화 화면
   ├─ session 목록: sessions store snapshot + sessions/list 제목, workspace로 묶음
   ├─ Inbox: waiting store와 waiting/ card. desktop router 대신 폰의 화면 이동
   └─ 대화: AgentView(phone) + 폰 host
```

- **bridge.** page는 network를 쓰지 않고 `globalThis.lophnRemote`(desktop의 `CoreSource`: `subscribe`, `current`, `call`, `watch`, `onEvent`)만 쓴다. 연결, 다시 붙기, 다시 붙은 뒤 마지막 `watch` 다시 보내기는 bridge 뒤의 일이다. 연결 상태는 `starting` → `ready` → 끊기면 `stale`이고 화면 위에 한 줄로 보인다. bridge가 없으면 "폰 앱에서 연다"는 글만 보인다.
- **bytes.** frame은 JSON뿐이다. bridge는 upload 호출을 `{input, base64}`로 보내고 file 답 `{content_type, base64}`를 desktop 모양 `{bytes, contentType}`으로 바꿔 화면에 준다.
- **개발용 bridge.** 개발 build에만 든다. browser에서 QR 내용을 붙여 넣거나 주소의 `#pair=<QR 내용>`으로 pairing하고 `@lophn/protocol/remote/client`로 core에 직접 붙는다. 기기 key는 `localStorage`에 둔다. prod build는 이 code를 접어 뺀다. `npm run dev:remote`가 개발 core의 remote를 켜고(port 47432, 사람의 lophn과 겹치지 않게) pairing code를 받아 `dist/remote`를 내주고 그 주소를 찍는다.
- **폰 host.** `AgentView`에 `phone`을 주고 host는 폰에 있는 길만 준다. `openForked`·`openSession`은 폰의 대화로 가고, `openFile`·`runCommand`·`artifacts`·`openPermissions`·`openAgentSettings`·`desktop`은 주지 않는다. 없는 길은 그리로 가는 단추와 `/` 명령이 빠진다. 폰에서는 끌어 놓기와 OS path, 찾기 줄, thread index와 bookmark, 단축키 안내, mode(skip) 바꾸기가 없고 [+]는 사진을 고른다. secret 입력 요청 card는 "컴퓨터에서 넣는다"는 글만 보인다. 머리는 `AgentView`의 bar 한 줄이고 그 앞에 뒤로 단추를 놓는다.
- **desktop 조각.** mermaid diagram, 앱 card, 링크를 창 밖에서 열기, provider key 입력은 desktop host가 `desktop`(`DesktopParts`)으로 넘긴다. 대화 화면은 이 조각을 import하지 않는다. 없으면 diagram은 code로, 앱 card는 안내 한 줄로 남는다.
- **화면 bundle 내려주기.** renderer build의 entry `remote`가 `dist/remote/`(`index.html`, `remote.js|css`, `chunks/`, 글꼴)를 낸다. 설치본은 `platform/remote-ui/`에 두고 core가 자기 source 기준으로 찾는다(없으면 개발 자리 renderer `dist/remote`). core는 기동 때 한 번 file마다 sha256과 크기, 전체 hash(path와 file hash를 path 순으로 이은 것의 sha256)를 계산해 둔다. 폰 껍데기는 `remote_ui/manifest`로 hash를 보고 바뀐 file만 `remote_ui/file`로 받는다.
- **폰 껍데기.** `mobile/`은 root npm workspace 밖의 Expo project(SDK 58, dev build)다. Metro가 `@lophn/protocol/remote/client`를 source로 읽고, 그 안의 bare import(zod, `@noble/*`)는 `mobile/node_modules`에서 푼다. native 화면은 pairing(QR 찍기, 붙여 넣기, 확인 뒤 pairing), 컴퓨터 목록, 컴퓨터 바꾸는 얇은 bar와 bundle이 없을 때의 안내뿐이고 나머지는 WebView의 remote 화면이다.
  - **key.** 기기 key 쌍은 한 번 만들어 `expo-secure-store`(이 기기에서만, 잠금이 풀렸을 때만)에 둔다. 컴퓨터 목록(주소 후보, port, core key, 기기 id, 끊김 표시)도 같은 곳이다. 무작위는 `expo-crypto`의 `getRandomValues`다(Hermes에는 전역 crypto가 없다). page는 key를 보지 못한다.
  - **연결.** QR의 direct 주소 후보와 relay(QR에 있으면)를 같이 걸어 먼저 handshake가 된 것을 쓴다. relay 길은 바이트만 넘기므로 handshake와 그 뒤는 direct와 같다. relay를 더하기 전에 pairing한 폰은 한 번 다시 pairing해야 relay 주소를 안다. 붙을 때마다 마지막 `watch`(없으면 `[]`)를 보내고 core의 `ready`로 `ready`가 된다. 끊기면 1초에서 30초 backoff로 다시 붙는다. 앱이 뒤로 가면 다시 붙기를 멈추고, 앞으로 오면 열린 연결에 `watch`를 다시 보내 3초 안에 `ready`가 없으면 버리고 바로 다시 붙는다. `closed(credential_revoked)`를 받으면 그 컴퓨터를 "다시 pairing"으로 표시하고 멈춘다.
  - **bundle cache.** `ready`가 아닌 상태에서 `ready`가 될 때마다 `remote_ui/manifest`를 읽는다. 그 hash의 폴더가 없으면 file마다 `remote_ui/file`로 받아 임시 폴더에 쓰고 sha256을 manifest와 대조한다. 하나라도 틀리면 그 bundle을 버린다. 다 맞으면 hash 이름의 폴더로 옮기고 `current`를 바꾼다. 지금 것과 바로 앞 것만 남긴다. core에 닿지 않으면 마지막 bundle을 띄우고 page가 연결 상태를 보인다.
  - **WebView.** 자체 Expo module이다. origin은 `https://remote.lophn.invalid/`이고 `shouldInterceptRequest`가 그 origin의 GET만 `root` 폴더의 file로 답한다(폴더 밖 path, symlink, 표에 없는 확장자는 404, origin 밖과 다른 method는 403). 응답 CSP는 `connect-src 'none'`, `worker-src 'none'`, `frame-src 'none'`이다. 다른 origin으로 가는 이동, 새 창, download, 권한 요청을 거절하고, 사람이 누른 http(s) link만 OS browser로 연다. render process가 죽으면 다시 띄운다. `<input type=file>`은 Android의 file 고르기로 잇는다.
  - **bridge.** document 시작 때 넣는 script가 `globalThis.lophnRemote`(`CoreSource`)를 만들고 `addWebMessageListener`(origin 규칙은 그 origin 하나)로 JSON message만 오간다. page → 껍데기는 `call`, `watch`, `state` 셋뿐이고 다른 것은 버린다. 껍데기 → page는 `reply`, `event`, `state`다. page는 시작 때 `state`를 보내고 껍데기는 그때 지금 상태로 답한다. native 기능을 page에 내놓지 않는다.
- **밀도.** remote 화면은 늘 density `touch`(control 44px 이상, 본문 16px)로 그린다(`appearance.md`). desktop의 `chrome.css`(창 끌기, 글 고르기 막기)는 싣지 않는다.

## 지키는 것

1. `remote_ui/file`은 bundle 폴더 밖을 내주지 않는다: `..`, 절대 path, 밖을 가리키는 symlink, 폴더 자체는 오류이고 답에 밖의 내용이 들지 않는다. app 화면 file과 같은 규칙(realpath로 폴더 안인지 본다)을 쓴다.
2. 폰이 부르는 route는 모두 기기 route 목록 안이다. 화면이 목록 밖 route를 부르는 단추를 보이지 않는다(skip 바꾸기, session 지우기, 설정·secret 화면으로 가는 길).
3. desktop 대화 화면의 동작과 모양은 폰 host 때문에 바뀌지 않는다. desktop host는 모든 member를 주고 `phone`을 주지 않는다.
4. 대화 화면(`conversation/`)은 desktop 전용 module(editor, workspace의 visual·drag·host, 터미널, mermaid, preload 통로)을 import하지 않는다. 그런 조각은 host가 넘긴다. 폰 bundle에 xterm, code editor, mermaid가 들지 않는다.
5. page는 network를 직접 쓰지 않고 bridge만 쓴다. 폰 껍데기가 연결 방식을 바꿔도(relay 등) 화면은 그대로다.
6. 폰 껍데기는 hash가 manifest와 맞지 않는 file을 cache에 들이지 않고 화면에 쓰지 않는다. bundle은 모든 file이 맞았을 때만 `current`가 된다.
7. 폰 WebView의 page는 자기 origin의 cache file 말고 아무것에도 닿지 않는다(응답 CSP `connect-src 'none'`과 요청 가로채기 둘 다). bridge는 `call`, `watch`, `state` 말고는 받지 않는다.
8. 기기 key는 폰의 보안 저장소에만 있고 page에 가지 않는다.
9. relay는 증명하지 못한 control socket에 폰 연결을 잇지 않고, 폰 연결 둘의 message는 서로의 data socket으로 가지 않는다. relay는 내용을 보지 못한다(Noise는 폰과 core 사이에서 끝난다).

## 경계와 계약

- boundary `remote-protocol`: frame, 기기 route 목록, base64 bytes, `remote_ui/manifest`(`{hash, files: [{path, hash, size}]}`, bundle이 없으면 `unavailable`), `remote_ui/file`(`{path}`, file route). 폰 쪽은 좁은 입구 `@lophn/protocol/remote/client`(연결, frame type, key, `REMOTE_PATH`, QR 해석 schema)만 import하고 route 정의와 목록은 끌고 오지 않는다.
- `globalThis.lophnRemote: CoreSource`: 폰 껍데기가 넣는 bridge의 type이다.
- renderer entry `remote`: `dist/remote/{index.html, remote.js, remote.css, chunks/}`. 설치 묶음은 `platform/remote-ui/`.
- 화면 안 길: `{screen: "sessions"} | {screen: "inbox"} | {screen: "chat", session, back}`. 메모리 상태라 폰의 뒤로 가기·history와는 아직 잇지 않았다.

## 결정

- page는 `CoreSource` 모양의 bridge만 쓰고 연결은 껍데기가 한다. 이유: renderer의 event 층과 `useCoreRead`가 그대로 돌고, 개발용 bridge로 폰 없이 실제 core에서 화면을 본다. 버린 안: page가 WebSocket과 Noise를 직접 다루기(껍데기의 다시 붙기·background 처리와 겹치고 relay를 더할 때 화면을 고친다). (agent, 2026-11-15)
- 대화는 `AgentView`를 폰 host로 쓰고 session 목록은 폰용으로 새로 그린다. 이유: 대화 해석은 한 벌이어야 하고, desktop sidebar는 탭과 끌기의 모양이라 폰에 맞지 않는다. (agent, 2026-11-15)
- byte는 frame 종류를 늘리지 않고 `call` 안에 base64로 싣는다. 한 file 8 MiB, frame 16 MiB 안이다. 이유: 대화 이미지와 화면 file은 작고, frame 종류를 늘리면 연결 계약이 커진다. (agent, 2026-11-15)
- desktop 전용 조각(mermaid, 앱 card, 링크 열기, provider key)은 host member `desktop`으로 넘긴다. 이유: 동적 import로 미뤄도 bundler가 chunk를 폰 bundle에 싣는다. 버린 안: remote entry만 build 때 stub으로 바꾸기(build 설정에 화면 지식이 들어간다). (agent, 2026-11-15)
- 폰에서 mode(skip)를 바꾸지 않는다. 이유: skip은 agent가 사람에게 묻지 않고 돌게 하는 권한 설정이라 desktop에서 정한다(`approval.md`). (agent, 2026-11-15)
- 폰 껍데기는 root workspace 밖의 `mobile/`에 자기 `package.json`과 lock을 가진 Expo project로 둔다. 이유: React Native 의존 tree가 Electron 설치와 `npm run check`에 섞이지 않는다. protocol은 Metro가 source로 읽어 한 벌이다. 대가: `mobile/`의 type 검사와 test는 따로 돌린다. (agent, 2026-11-15)
- Android WebView origin은 가로챈 https 가짜 host(`https://remote.lophn.invalid/`)다. 버린 안: custom scheme `lophn-app://`(ES module, CSS, font는 읽히지만 secure context가 아니라 `crypto.randomUUID`·`crypto.subtle`이 없고, `addWebMessageListener`의 origin 규칙을 걸 수 없다). iOS는 `WKURLSchemeHandler`가 http(s)를 받지 못해 custom scheme으로 간다. page는 상대 path만 써서 둘에서 같다. (agent, 2026-11-15)
- WebView는 기본 `react-native-webview`가 아니라 자체 Expo module이다. 이유: 요청을 모두 가로채 cache의 file만 내주고, bridge를 message 셋으로 좁혀야 한다. (agent, 2026-11-15)
- 앞으로 온 앱은 열린 연결에 `watch`를 다시 보내 3초 안의 `ready`로 살아 있는지 본다. 이유: background에서 소리 없이 죽은 socket은 close event가 오지 않는다. 멀쩡한 연결은 `stale`로 깜빡이지 않는다. (agent, 2026-11-15)
- core는 bundle manifest를 기동 때 한 번 계산한다. 이유: 설치본의 bundle은 판이 바뀔 때만 바뀐다. 개발 중 renderer를 다시 build하면 core를 다시 띄워야 하고, `dev:core`는 core 전에 renderer를 build한다. (agent, 2026-11-15)
