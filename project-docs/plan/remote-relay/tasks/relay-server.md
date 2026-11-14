# relay-server

core와 폰을 잇는 relay를 `packages/relay`에 만든다. 내용을 보지 않고 binary message를 넘기기만 한다.

- 단위: relay (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/relay/`(새 package)
- 읽을 것:
  - 계획 README "정한 것"과 "계약"
  - `packages/protocol/remote/relay.ts`(lead가 commit한 계약), `packages/protocol/remote/noise.ts`의 `NOISE_MAX_MESSAGE_BYTES`
  - 본보기: `packages/core/remote/listener.ts`(`ws` 쓰는 법: binary만, `maxPayload`, `perMessageDeflate: false`)
  - 비교: `../harness-lab/_report/remote-control/paseo.md` §5.2
- 계약:
  - 쓰는 것: `packages/protocol/remote/relay.ts`의 path, control frame schema, 한도
  - 내놓는 것: `node packages/relay/main.ts --port <n>`로 도는 relay. 등록할 것은 보고에 적는다

## 할 일

1. `packages/relay/package.json`(이름 `@lophn/relay`, 판 칸 없음, `ws`는 root와 같은 판), `main.ts`(port 인자, 시작 줄 하나 찍기), relay 본체.
2. control socket(`/v1/host?key=`): 붙으면 `challenge`(임시 X25519 key, 무작위 nonce)를 보내고 `proof`를 확인한다. 맞으면 `ready`를 보내고 그 key의 자리를 잡는다(같은 key의 옛 자리와 그 폰 연결을 닫는다). 10초 안에 증명이 없거나 틀리면 닫는다. 20초 ping, 60초 무응답이면 닫는다.
3. 폰(`/v1/phone?key=`): 그 key의 증명된 자리가 없으면 바로 닫는다. 있으면 무작위 128-bit 연결 id를 만들어 control로 `connected`를 보낸다. data socket이 붙기 전 폰 message는 16개까지 들고 있고 넘치면 닫는다. 10초 안에 data socket이 없으면 닫는다. core마다 폰 연결 16을 넘으면 닫는다.
4. data socket(`/v1/data?conn=`): 모르는 id면 닫는다. 맞으면 들고 있던 message를 순서대로 넘기고 그 뒤로 양쪽 binary message를 그대로 넘긴다. text message나 한도를 넘는 message는 그 짝을 닫는다. 한쪽이 닫히면 짝을 닫고 control에 `gone`을 보낸다.
5. 시각, 무작위, timer는 인자로 받는다(AGENTS.md "코드"). socket 층과 잇는 logic을 나눠 logic을 메모리 socket으로 test한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "증명하지 못한 control socket에는 폰 연결이 이어지지 않는다", "폰 연결 둘의 message가 서로의 data socket으로 가지 않는다". 메모리 socket으로 쓴다(실제 port를 여는 test는 만들지 않는다).
- 손으로: `node packages/relay/main.ts --port 0`을 띄우고 Node로 control·phone·data socket을 걸어 message가 오가는지 한 번 본다(보고에 적는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 등록할 것: root `package.json` workspaces와 script `dev:relay`, `tools/check-deps.ts`의 `packages/relay` 규칙(protocol과 base만 import), `project-docs/flows/`에 넣을 것.
