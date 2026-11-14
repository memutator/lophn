# remote-devices

core가 remote listener를 열고, 기기를 pairing으로 등록하고, 등록된 기기가 좁힌 route 목록 안에서 route를 부르고 event를 받게 한다.

- 단위: remote (wave 2)
- 선행: remote-channel.
- 소유(이 task만 고친다):
  - `packages/core/remote/`(새 폴더: listener, pairing, 기기 표, 연결)
  - `packages/protocol/remote/{routes,allowlist}.ts`
  - `packages/core/main/daemon/wiring/`에 새 file 하나, `packages/core/main/daemon/assembly.ts`의 schema step 줄, `schema-steps.lock.json`
  - `packages/core/main/daemon/{idle.ts,wiring/idle.ts}`
  - `packages/core/server/identity/registry.ts`, `packages/core/supervision/responsiveness/admission.ts`
  - `packages/core/config/shell-settings.ts`(설정 `remote.*`)
  - `tools/remote-client.ts`(새 file)
  - `project-docs/flows/`의 route와 설정 항목
- 읽을 것:
  - 계획 README "정한 것"
  - architecture: `project-docs/architecture/platform.md`(core 수명, idle-exit), `event.md`(Gateway), `approval.md`(사람의 결정), `layers.md`
  - AGENTS.md "호환성"(ledger schema step)
  - `packages/core/server/{server,dispatch,request,socket}.ts`, `packages/core/events/gateway.ts`
- 계약:
  - 쓰는 것: `packages/protocol/remote/`의 handshake와 frame
  - 내놓는 것: route `pairing/start`, `devices/list|rename|revoke|set_primary`, 설정 `remote.enabled`, `remote.port`

## 할 일

1. key: `<data root>/remote/host-key.json`(0600)을 없으면 만든다.
2. 기기 표: schema step을 `WIRINGS` 맨 뒤 wiring의 `schemaStepsAfterTeams`에 더하고 `schema-steps.lock.json`에 덧붙인다. route `devices/*`(actor user). 새 command에는 `changes`를 적는다(`screen-sync`가 land한 뒤면 필수다).
3. pairing: `pairing/start`가 code와 QR에 실을 것(주소 후보는 loopback이 아닌 interface의 주소)을 돌려준다. code는 메모리에만 둔다.
4. listener: `remote.enabled`가 켜지면 `remote.port`에 WebSocket listener를 열고 꺼지면 닫는다. 연결마다 responder handshake를 하고, 받은 공개 key가 등록된 기기면 붙이고 아니면 `pair`만 받는다. `pair`가 맞으면 기기를 등록하고(새 기기가 기준이 된다) `shell.devices`에 화면 정보를 넣는다.
5. 자격: 기기 연결에 actor user, principal `device:<id>`인 context를 만들고 scope를 `allowlist.ts`의 route로 좁힌다. admission 한도가 principal마다 따로 서는지 확인한다.
6. `call`은 지금 dispatch를 같은 context로 부른다. `watch`는 Gateway와 같은 Bus 구독을 연결에 붙인다. 느린 연결은 Gateway와 같은 한도로 끊는다.
7. `devices/revoke`는 그 기기의 연결을 바로 닫는다. `devices/list`의 마지막 연결 시각은 연결될 때 고친다.
8. idle-exit: `remote.enabled`가 켜져 있으면 일이 있는 것으로 센다.
9. `tools/remote-client.ts`: QR의 내용을 받아 pairing하고, 다시 붙어 route 하나를 부르고 event를 받는 개발용 client.
10. test는 listener를 띄우지 않는다. 메모리 전송으로 연결 logic을 부른다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "등록되지 않은 key의 연결은 `pair` 말고 아무 frame도 통하지 않는다", "쓴 code와 300초 지난 code는 다시 통하지 않는다", "목록 밖 route는 `forbidden`이다", "끊은 기기는 연결이 닫히고 다시 붙지 못한다"
- `remote.enabled`가 꺼져 있으면 loopback 밖 listener가 없다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. `allowlist.ts`에 넣은 route 목록을 "정한 것"에 적는다.
