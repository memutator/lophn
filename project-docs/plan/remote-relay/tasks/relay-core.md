# relay-core

core가 설정한 relay에 붙어 key를 증명하고, relay가 알린 폰 연결마다 data socket을 열어 지금 연결과 같이 `host.accept`에 넘긴다. QR에 relay 주소를 싣고 Settings › Remote에 relay 상태를 보인다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/remote/relay-client.ts`(새 file)
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/shell/renderer/desktop/settings/remote/`
  - 추가 소유: `packages/core/config/shell-settings.ts`의 `remote.relay` 설정 하나, `packages/design/i18n/catalog/workspace-settings.ts`의 Remote key, `project-docs/flows/`의 `remote_relay/status`와 바뀐 remote flow
- 읽을 것:
  - 계획 README "정한 것"과 "계약", `project-docs/architecture/{remote,platform}.md`(폰이 붙는 listener, idle-exit)
  - `packages/protocol/remote/relay.ts`, `packages/protocol/remote/routes.ts`의 `remoteRelayStatus`(lead가 commit한 계약)
  - `packages/core/remote/listener.ts`(`RemoteSocket`을 만드는 법), `packages/core/remote/host.ts`의 `accept`, `packages/core/remote/host-key.ts`
  - `packages/core/main/daemon/wiring/remote.ts`의 `reconcile`(listener 열고 닫기), `lanAddresses`, `pairing/start`
- 계약:
  - 쓰는 것: relay path와 control frame, `remotePairingSchema.relay`, `remote_relay/status`
  - 내놓는 것: 없음

## 할 일

1. 설정 `remote.relay`(문자열 URL, 기본 빈 값, 사람만 바꾼다)를 `remote.port` 옆에 더한다.
2. `relay-client.ts`: control socket을 걸고 `challenge`에 `proof`로 답한다. `connected`마다 data socket을 열어 `listener.ts`와 같은 꼴의 `RemoteSocket`으로 `host.accept`에 넘긴다. 끊기면 1초에서 30초 backoff로 다시 건다. 상태(`off`/`connecting`/`connected`)를 내놓는다. socket을 여는 함수와 시각·timer는 인자로 받는다.
3. `wiring/remote.ts`의 `reconcile`: `remote.enabled`가 켜져 있고 `remote.relay`가 비어 있지 않으면 relay client를 띄우고, 바뀌거나 꺼지면 닫는다. listener와 따로 돈다(listener port를 못 열어도 relay는 돈다).
4. `pairing/start`의 답에 `relay`(설정 값, 비었으면 칸 없음)를 싣는다. `remote_relay/status`를 memory route로 단다.
5. Settings › Remote에 relay 상태 한 줄: 켜져 붙음 "Reachable from anywhere through the relay", 붙지 못함 "Can't reach the relay", 설정 없음은 줄을 보이지 않는다. 문구는 i18n catalog에.
6. 실제 relay로 끝까지 보는 것은 세 task가 merge된 뒤 lead가 한다. 이 task는 relay client를 메모리 socket으로 test하고 `boot.sh`로 본다.

## 끝남

- `npm run check`가 통과하고 `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`이다.
- 위험 test: "relay로 들어온 연결도 기기 route 목록 밖 route는 `forbidden`이다"는 `host.accept`가 같으므로 새로 쓰지 않는다. 새 위험 test 없음.
- `remote_relay/status`는 기기 자격으로 부르면 `forbidden`이다(기기 목록에 넣지 않는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
