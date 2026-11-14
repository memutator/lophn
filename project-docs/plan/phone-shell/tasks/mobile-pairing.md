# mobile-pairing

폰에서 QR로 pairing하고, key를 저장하고, core에 붙고 다시 붙는다.

- 단위: mobile (wave 2)
- 선행: mobile-spike.
- 소유(이 task만 고친다):
  - `mobile/src/connection/`, `mobile/src/pairing/`, `mobile/src/screens/`
  - `mobile/app.json`, `mobile/package.json`, `mobile/package-lock.json`
  - 추가 소유: `mobile/App.tsx`, `mobile/src/spike.ts`(지운다), `mobile/src/remote.ts`
- 읽을 것:
  - 계획 README "정한 것", `reports/mobile-spike.md`
  - `tools/remote-client.ts`, `packages/protocol/remote/{channel,frames}.ts`
  - 비교: `../harness-lab/_report/remote-control/orca.md` §14.2~14.4, `t3code.md` §14.4
- 계약:
  - 쓰는 것: `@lophn/protocol/remote/client`
  - 내놓는 것: 연결 하나를 `CoreSource` 모양(`subscribe`, `current`, `call`, `watch`, `onEvent`)으로 내놓는 object

## 할 일

1. 화면: 처음 열면 QR 찍기(`expo-camera`)와 QR 내용 붙여 넣기. 찍으면 컴퓨터의 key 앞 몇 글자와 주소를 보이고 사람이 누르면 pairing한다(찍자마자 붙지 않는다). pairing한 컴퓨터 목록, 연결 상태, 연결 지우기.
2. key: 기기 key 쌍을 한 번 만들어 `expo-secure-store`에 둔다. 컴퓨터마다 주소 후보, port, core의 공개 key를 저장한다.
3. `pair` frame에 폰의 이름, OS, 화면 크기, DPR을 싣는다.
4. 연결: 주소 후보를 같이 걸어 먼저 handshake가 된 것을 쓴다. 끊기면 backoff(1초에서 30초)로 다시 붙는다. 앱이 뒤로 가면 다시 붙기를 멈추고 앞으로 오면 바로 붙는다. 붙을 때마다 마지막 `watch`를 다시 보낸다. `closed(credential_revoked)`를 받으면 그 컴퓨터를 "끊김, 다시 pairing"으로 표시한다.
5. 연결을 `CoreSource` 모양으로 내놓는다. 상태는 `starting`, `ready`, `stale`이다.
6. 연결 logic은 전송을 인자로 받아 Node에서 test한다.

7. (lead가 더함) spike 화면(`App.tsx`의 WebView 둘, `src/spike.ts`)을 지우고 `App.tsx`를 pairing 화면과 컴퓨터 목록으로 바꾼다. WebView 자리는 mobile-remote가 채운다.
8. (lead가 더함) `RandomSource`는 `expo-crypto`의 `getRandomValues`로 만든다. `packages/base`의 `cryptoRandom`은 Hermes에 전역 crypto가 없어 안 된다(spike 보고).
9. (lead가 더함) `@lophn/protocol/remote/client`는 이 branch에 아직 없다(main에는 land됐다). spike가 만든 대역 `mobile/src/remote.ts`를 거쳐 import한다. 대역을 client.ts로 바꾸는 것은 mobile-remote가 한다.
10. (lead가 더함) mobile-webview가 dependency를 더해 달라고 하면 lead가 알린다. 그 밖에 `package.json`을 고치는 것은 이 task뿐이다.

## 끝남

- `mobile/`의 type 검사와 test가 통과한다.
- 위험 test: "끊긴 뒤 다시 붙으면 마지막 `watch`를 다시 보낸다"
- emulator에서 이 machine의 core에 pairing하고, 앱을 다시 켜도 붙는다(보고에 적는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
