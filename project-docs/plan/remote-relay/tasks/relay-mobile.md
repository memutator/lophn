# relay-mobile

폰이 QR의 relay 주소를 컴퓨터마다 저장하고, 붙을 때 direct 주소들과 relay를 같이 걸어 먼저 된 것을 쓴다.

- 단위: mobile (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `mobile/src/connection/`, `mobile/src/pairing/`, `mobile/src/screens/`, `mobile/README.md`
- 읽을 것:
  - 계획 README "정한 것"과 "계약", `mobile/README.md`
  - `packages/protocol/remote/relay.ts`(lead가 commit한 계약, 폰 쪽 path), `packages/protocol/remote/frames.ts`의 `remotePairingSchema`
  - `mobile/src/connection/connection.ts`의 `openFirst`, `mobile/src/pairing/store.ts`
- 계약:
  - 쓰는 것: 폰 path `<relay>/v1/phone?key=<core key text>`, `remotePairingSchema.relay`(`@lophn/protocol/remote/client`로 import)
  - 내놓는 것: 없음

## 할 일

1. pairing: QR의 `relay`를 컴퓨터 기록에 저장한다. 확인 화면에 relay host를 주소들과 같이 보인다.
2. `openFirst`: direct 주소 후보와 relay(있으면) 하나를 같이 건다. handshake는 그대로(relay는 바이트만 넘긴다). 먼저 handshake가 된 것을 쓴다.
3. 컴퓨터 목록 상태 줄은 지금 그대로 둔다(어느 길로 붙었는지는 보이지 않는다).
4. `mobile/README.md`의 연결 절에 relay를 한두 줄로 더하고, 이미 pairing한 폰은 한 번 다시 pairing해야 relay를 안다고 적는다.

## 끝남

- `cd mobile && npm run typecheck && npm test`가 통과하고 root `npm run check`도 통과한다.
- 위험 test: 없음. 기존 연결 test(끊긴 뒤 마지막 `watch`를 다시 보낸다)가 relay 후보가 더해져도 통과한다.
- emulator에서 지금처럼 direct로 pairing과 연결이 된다(relay를 끝까지 보는 것은 셋이 merge된 뒤 lead가 한다). emulator를 띄우는 자동 test는 만들지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
