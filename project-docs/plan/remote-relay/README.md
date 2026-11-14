# remote-relay

- 목표: 폰과 core가 다른 network에 있어도 lophn relay로 만난다. 같은 LAN이면 direct가 먼저 붙는다. relay는 내용을 보지 못하고 넘겨주기만 한다.
- 재료: `project-docs/products/roadmap/mobile.md`("사람이 정할 것" 4. 망), `project-docs/architecture/{remote,platform}.md`, `../harness-lab/_report/remote-control/paseo.md` §5.2(relay 라우팅 v2), `orca.md`
- 범위 밖: relay가 변경분을 맡아 두기(sync 앱 단계에서 정한다), push, relay 여러 대와 scale, iOS.

## 정한 것

- **Paseo v2 꼴의 상태 없는 relay.** core가 control socket 하나를 relay에 밖으로 건다. 폰이 붙으면 relay가 연결 id를 core에 알리고, core가 그 연결만의 data socket을 열어 둘을 잇는다. relay는 binary message를 그대로 넘긴다. 폰과 core 사이 Noise IK는 그대로라 relay는 암호문만 본다. (agent: 비교한 relay 중 가장 단순하고, core는 data socket을 지금 listener의 연결처럼 `host.accept`에 넘기면 된다)
- **core는 relay에 key를 증명한다.** relay가 임시 X25519 key와 nonce를 보내면 core가 자기 static key와의 DH로 만든 HMAC을 돌려준다. 증명하지 못한 control socket에는 폰을 잇지 않는다. (agent: 인터넷의 아무나 그 core 자리를 가로채 폰을 끊지 못하게 한다. 내용은 Noise가 지키지만 가로채기는 막을 수 없는 끊김이 된다)
- **연결 id가 data socket의 자격이다.** relay가 증명된 control socket에만 무작위 128-bit 연결 id를 주고, data socket은 그 id로만 붙는다. (agent)
- **relay 주소는 설정 `remote.relay`(URL)다.** 비어 있으면 relay를 쓰지 않는다. 기본값은 lophn relay를 띄운 뒤 넣는다. QR(`pairing/start`)에 relay 주소를 싣고 폰은 그것을 컴퓨터마다 저장한다. 이미 pairing한 폰은 한 번 다시 pairing한다. (agent: 지금 pairing한 폰은 사람의 dev build 하나뿐이다)
- **폰은 direct 주소들과 relay를 같이 건다.** 먼저 handshake가 된 것을 쓴다(지금 `openFirst`). (agent)
- **relay는 저장소의 `packages/relay`(Node, `ws`)다.** protocol만 import한다. 띄울 곳은 사람이 정한다(아래). (agent)
- **Settings › Remote가 relay 상태를 한 줄로 보인다.** "어디서든 붙을 수 있음" / "relay에 닿지 않음" / relay 꺼짐. (agent: 사람이 밖에서 붙을 수 있는지 컴퓨터에서 알아야 한다)

## 계약 (lead가 wave 1 전에 commit한다)

`packages/protocol/remote/relay.ts`(그리고 `client.ts`에서 폰이 쓸 것을 export):
- path: core control `GET <relay>/v1/host?key=<core key text>`, core data `GET <relay>/v1/data?conn=<연결 id>`, 폰 `GET <relay>/v1/phone?key=<core key text>`. `<relay>`는 `wss://…`(개발은 `ws://…`).
- control socket의 text frame(JSON, zod): relay→core `{type:"challenge", relay_key, nonce}`, core→relay `{type:"proof", mac}`, relay→core `{type:"ready"}`, relay→core `{type:"connected", conn}`, relay→core `{type:"gone", conn}`. `mac = HMAC-SHA256(key = X25519(core static secret, relay_key), nonce)`, base64url.
- 한도: message 하나는 `NOISE_MAX_MESSAGE_BYTES`. core마다 폰 연결 16. data socket이 붙기 전 폰이 보낸 message는 16개까지 들고 있다가 넘긴다. 증명 없는 control socket과 data socket이 붙지 않은 폰 연결은 10초 뒤 닫는다. control socket은 20초마다 ping, 60초 답이 없으면 닫는다.
- 어느 쪽 socket이든 닫히면 relay는 짝을 닫는다. 같은 key로 새 control socket이 증명되면 옛 control socket과 그 폰 연결을 닫는다.
- `remotePairingSchema`에 `relay: z.string().url().optional()`을 더한다.
- `packages/protocol/remote/routes.ts`에 사람만 부르는 memory route `remote_relay/status`(입력 `{}`, 답 `{url: string | null, state: "off" | "connecting" | "connected"}`)를 더한다. 기기 route 목록에는 넣지 않는다.

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `relay-server` | 없음 | `packages/relay`: control·data·phone socket을 잇는 relay와 개발 실행 |
| 1 | `relay-core` | 없음 | core가 relay에 붙어 key를 증명하고 폰 연결을 `host.accept`에 넘긴다. 설정, QR, Settings 한 줄 |
| 1 | `relay-mobile` | 없음 | 폰이 QR의 relay 주소를 저장하고 direct와 같이 건다 |

## 위험 test (brief에 있다)

- 증명하지 못한 control socket에는 폰 연결이 이어지지 않는다.
- 폰 연결 둘의 message가 서로의 data socket으로 가지 않는다.

## lead가 할 일

- 시작 전: 위 "계약"을 commit한다. 등록할 것(root `package.json`의 workspaces와 `dev:relay` script, `tools/check-deps.ts`의 relay 규칙)은 worker 보고대로 merge 뒤에 고친다.
- merge마다 `npm run check`, `mobile/`을 고쳤으면 `cd mobile && npm run typecheck && npm test`.
- 셋이 merge되면 손으로 끝까지 본다: 개발 relay(`npm run dev:relay`) + 개발 core(`remote.relay`를 그 주소로) + emulator. emulator의 direct 주소를 막고(QR 주소만, `EXPO_PUBLIC_LOPHN_EXTRA_ADDRESS` 없이) relay로만 붙어 session 목록이 뜨는지 본다.
- 끝나면: `architecture/remote.md`와 `platform.md`(relay의 모델, 지키는 것, 결정), `boundary-catalog.yaml`(element `relay`, `remote-protocol`의 provided_by)과 `module-catalog.yaml`(`packages/relay`), change-log, roadmap `mobile.md` 단계 3을 끝남으로.
- 사람에게: relay를 어디에 띄울지(계정과 비용). 띄운 뒤 `remote.relay` 기본값을 넣고, 실제 폰을 LTE로 두고 붙는지 확인을 부탁한다.
