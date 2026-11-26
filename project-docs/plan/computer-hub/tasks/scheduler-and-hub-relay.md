# scheduler-and-hub-relay

- 단위: folder scheduler, remote listener/links/roster/host, vault-sync (wave 1)
- 선행: 없음
- 목표: `carry`와 `vault-sync`의 receive scheduler를 하나의 공용 scheduler(`createReceiveScheduler`)로 통합하고 backoff 중 trigger 유실 버그를 고치며, `remote.hub` 활성화 시 `remote.port`에 `/v1/*` hub relay를 내장하고 relay 목록 및 폰 `signing_key`를 hello/roster/record에 전파한다.
- 소유:
  - `packages/core/folder/receive-scheduler.ts`
  - `packages/core/main/daemon/wiring/folder.ts`
  - `packages/core/secrets/vault-sync.ts`
  - `packages/core/secrets/vault-sync_test.ts`
  - `packages/core/remote/listener.ts`
  - `packages/core/remote/links.ts`
  - `packages/core/remote/roster.ts`
  - `packages/core/remote/host.ts`
  - `packages/core/remote/host_test.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/relay/`
- 참조:
  - `packages/protocol/remote/relay-room.ts`
  - `packages/protocol/remote/frames.ts`
  - `packages/protocol/remote/roster.ts`
  - `packages/protocol/remote/routes.ts`
  - `packages/protocol/folder/records.ts`
  - `packages/core/config/shell-settings.ts`
  - `packages/core/folder/export/record.ts`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **공용 Receive Scheduler 통합 (`packages/core/folder/receive-scheduler.ts`)**:
   - `packages/core/main/daemon/wiring/folder.ts`의 carry 수신 스케줄링(timer/backoff/serial runner)과 `packages/core/secrets/vault-sync.ts`의 스케줄러를 하나의 `createReceiveScheduler`로 합친다.
   - **버그 수정**: exponential backoff 대기 중 새 trigger(`kick`)가 들어오면 무시되어 버리는 문제를 고쳐, backoff 중에도 `pending = true`를 기록하거나 backoff를 취소하고 즉시/짧은 debounce 뒤 1회 더 실행해 유실이 없도록 만든다.
   - `packages/core/secrets/vault-sync.ts`와 `packages/core/main/daemon/wiring/folder.ts`가 둘 다 이 `createReceiveScheduler`를 쓰게 바꾸고, `packages/core/secrets/vault-sync_test.ts`에 backoff 중 trigger 유실 없음 회귀 테스트를 추가한다.
   - (주의: `wiring/folder.ts`의 Step 0 stub(`TRANSFER_ROUTES`, `SETTINGS_EXPORT_ROUTES`, `appSyncCustody*`)은 그대로 유지한다.)

2. **Embedded Hub Relay (`packages/core/remote/listener.ts`, `packages/core/main/daemon/wiring/remote.ts`)**:
   - `packages/core/remote/listener.ts`: 기존 `/remote`(직접 Noise WebSocket)를 여는 `remote.port`(7432) HTTP/WS listener 위에, `remote.hub === true`일 때 `packages/protocol/remote/relay-room.ts`의 `createRelay(...)`를 올려 `/v1/host`, `/v1/phone`, `/v1/data` 경로 요청을 함께 accept한다(`remote.hub`가 false면 해당 경로는 거절/닫음). `remoteRelayStatus`의 `hub_listening`도 반영한다.
   - Hub relay URL 계산: 자신의 `addresses.lan` / `remote.addresses` + `remote.port` 기반으로 `ws://<addr>:<port>`(또는 설정에 `wss://` 주소가 있으면 그것 포함) hub relay 후보 목록을 구성한다.

3. **Relay 목록 전파 (`serverHello`, `rosterReach`, `record.json`, `links.ts`)**:
   - 정렬된 relay 목록 규칙: 명단에 있는 온라인/알려진 Hub 컴퓨터들의 relay URL을 먼저(현재 연결/최근 순), `remote.relay`(예: Fly `wss://lophn-relay.fly.dev`)를 마지막 fallback으로 둔다.
   - `serverHello.machine` (`hub`, `relays`), `rosterReach` (`hub`, `relays`), `record.json` (`hub`, `addresses.relays`), `machines/list` (`hub`)에 채워 보내고, `packages/core/remote/links.ts`와 `packages/core/main/daemon/wiring/remote.ts`가 명단 컴퓨터들의 `hub`·`relays`를 읽어 연결·hub relay 등록(`relay` control socket도 ordered list로 붙거나 hub relay가 여러 대면 연결 유지)에 사용한다.

4. **Phone `signing_key` 수신·등록 (`clientHello`, `rosterJoin`)**:
   - `packages/core/remote/host.ts` & `packages/core/remote/roster.ts` & `packages/core/main/daemon/wiring/remote.ts`:
     - 폰이 `roster/join` 또는 `clientHello.signing_key`로 자신의 Ed25519 공개 `signing_key`를 알리면(Noise 인증을 통과한 자기 기기), 컴퓨터는 해당 폰의 roster entry를 `signing_key` 포함(`rev + 1`)으로 서명해 명단에 반영한다. (재pairing 없이 기존 폰도 업그레이드 후 자동 등록됨.)
     - **보안 확인**: `packages/protocol/remote/roster.ts`의 `trust()`는 `body.kind === "computer"`만 신뢰하므로, 폰 `signing_key`가 명단 서명 권한을 얻지 않음을 `roster_test.ts` / `host_test.ts`로 검증한다.

## 완료 기준

- `node --test packages/core/secrets/vault-sync_test.ts packages/core/remote/*.ts packages/relay/relay_test.ts packages/protocol/remote/*.ts` 통과
- `npm run check` 통과
