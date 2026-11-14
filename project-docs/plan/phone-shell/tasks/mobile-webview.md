# mobile-webview

cache의 bundle만 내주고 다른 요청을 막는 WebView와, page와 껍데기 사이 bridge를 자체 Expo module로 만든다(Android).

- 단위: mobile (wave 2)
- 선행: mobile-spike.
- 소유(이 task만 고친다):
  - `mobile/modules/lophn-webview/`(새 폴더)
  - `mobile/src/webview/`
- 읽을 것:
  - 계획 README "정한 것", `reports/mobile-spike.md`
  - `packages/shell/main/app-frame/{app-protocol,network-policy}.ts`(desktop이 하는 일: content type 표, CSP, 이동 막기)
  - 비교: `../harness-lab/_report/remote-control/orca.md` §14.8
- 계약:
  - 쓰는 것: spike가 정한 origin
  - 내놓는 것: React component `<LophnWebView root={폴더} entry={path} onMessage send />`와 bridge의 message 모양

## 할 일

1. Expo module(Android): `WebView`를 감싼 native view. `shouldInterceptRequest`가 origin 안의 요청을 `root` 폴더의 file로 답한다. 폴더 밖 path와 symlink는 404다. origin 밖의 요청은 모두 막는다. 응답에 CSP(`default-src 'self'`, `connect-src 'none'`, `frame-src 'none'`)를 붙인다.
2. 이동 막기: 다른 origin으로 가는 이동, 새 창, download, 권한 요청(camera, 위치 등)을 모두 거절한다. 바깥 link는 OS browser로 연다(http, https만).
3. bridge: document 시작 때 `globalThis.lophnRemote`를 넣는다. page와 native 사이는 JSON message다. 종류는 `call`, `watch`, 답과 event, 연결 상태뿐이고 다른 종류는 버린다. native 기능을 page에 내놓지 않는다.
4. WebView의 process가 죽으면 다시 띄운다.
5. iOS 쪽 file은 만들지 않는다.

## 끝남

- `mobile/`의 type 검사와 test가 통과한다.
- 위험 test: "bridge는 정해진 message 종류 말고는 받지 않는다"
- emulator에서 app에 든 시험용 page(ES module, CSS, font)가 뜨고, page의 `fetch`와 `WebSocket`이 막힌다(보고에 적는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
