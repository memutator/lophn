# remote-channel

폰과 core가 쓰는 암호화된 연결의 계약과 양쪽 구현을 만든다. 전송(WebSocket)은 인자로 받는다.

- 단위: remote (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/`(새 폴더)
  - `packages/protocol/package.json`
- 읽을 것:
  - 계획 README "정한 것"
  - roadmap: `project-docs/products/roadmap/mobile.md`의 "remote protocol", "비교에서 더 본 것"
  - 비교: `../harness-lab/_report/remote-control/paseo.md` §5.3~5.4(Noise와 frame 나누기), `orca.md` §4
  - architecture: `project-docs/architecture/event.md`의 Gateway 계약, `layers.md`
- 계약:
  - 쓰는 것: `packages/protocol/events/gateway.ts`의 frame
  - 내놓는 것: handshake(initiator, responder), 암호화된 frame 보내기와 받기, frame schema(`hello`, `pair`, `call`, `result`, `watch`, `ready`, `event`, `closed`), protocol 판 상수, key 쌍 만들기

## 할 일

1. `Noise_IK_25519_ChaChaPoly_SHA256`(prologue `lophn-remote/1`)의 initiator와 responder. 순수 JavaScript 암호 library를 쓰고 판을 정확히 고정한다. `node:crypto`를 쓰지 않는다.
2. handshake 뒤의 frame: JSON 하나를 암호화한 record 하나다. 큰 frame은 나눈다. 방향마다 counter가 nonce이고 어긋나면 연결을 끊는다.
3. frame schema(zod)와 protocol 판. `hello`에 판과 capability 목록을 싣고 판이 하한보다 낮으면 끊는다.
4. responder는 handshake에서 받은 상대 공개 key를 돌려준다(누구인지는 부르는 쪽이 정한다).
5. 전송은 `{send(bytes), onMessage, close}` 같은 작은 interface로 받는다. test는 메모리 안에서 양쪽을 잇는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "다른 key의 responder와는 handshake가 서지 않는다", "frame을 바꾸거나 순서를 바꾸면 받는 쪽이 끊는다"
- `packages/protocol/remote/`가 Node 내장 module을 import하지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 고른 library와 판, 이유를 "정한 것"에 적는다.
