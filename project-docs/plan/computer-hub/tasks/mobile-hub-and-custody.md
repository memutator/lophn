# mobile-hub-and-custody

- 단위: remote-client, mobile app (wave 2)
- 선행: scheduler-and-hub-relay, app-sync-policy-and-keep-both
- 목표: `remote-client`가 hub 우선·Fly fallback ordered relay 목록을 탐색·재사용해 재pairing 없이 hub를 쓰게 하고, 모바일 폰이 Ed25519 `signing_key`를 생성·광고하며 대상 컴퓨터가 offline일 때 온라인 hub 컴퓨터를 통해 서명된 `app_sync/custody_push`를 보낸다.
- 소유:
  - `packages/remote-client/`
  - `packages/mobile/`
  - `packages/design/i18n/catalog/mobile-carry.ts`
  - `packages/design/i18n/catalog/mobile-ops.ts`
  - `packages/design/i18n/catalog/mobile-local.ts`
- 참조:
  - `packages/protocol/remote/frames.ts`
  - `packages/protocol/remote/roster.ts`
  - `packages/protocol/remote/client.ts`
  - `packages/protocol/apps/app-sync.ts`
  - `packages/protocol/apps/sync/apply.ts`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **Ordered Multi-Relay Dialer & 재pairing 없는 Relay 자동 갱신 (`packages/remote-client/`)**:
   - **제약**: `packages/remote-client/`와 `packages/mobile/`는 `node:*` import 금지(`portable-import`)!
   - `packages/remote-client/computers.ts`, `connection.ts`, `dial.ts` 등:
     - 저장된 컴퓨터 정보(`SavedComputer`)에 `relays?: string[]` 및 `hub?: boolean`을 저장·갱신한다.
     - 연결 시 `serverHello.machine` (`hub`, `relays`) 및 `roster`의 reach 데이터에서 hub relay URL과 fallback relay(`remote.relay`) 순의 ordered 목록을 받아 저장하므로 **이미 짝지어진 폰도 재pairing 없이 hub relay 주소를 자동 습득**한다.
     - 접속 시 LAN 직접 연결을 먼저 시도하되 실패/불가 시 ordered relays 리스트를 순서대로(Hub relay 우선, Fly relay 마지막) 시도해 붙는다.
     - `remote-client` 단위 테스트(`*_test.ts`)에 hub relay 우선 시도 및 `serverHello.machine.relays` 자동 갱신 테스트를 추가한다.

2. **폰 Ed25519 Custody Key 생성 & `clientHello` 광고 (`packages/mobile/src/pairing/`, `packages/remote-client/`)**:
   - 폰이 pairing(`pair.ts`)하거나 기존 저장 상태로 시작할 때 Ed25519 custody keypair(`generateSigningKey` + secure storage / pairing saved store)를 한 번 생성해 보관한다(Android C++ `lophn-app-db` native 코드는 절대 건드리지 말 것!).
   - 연결 시 `clientHello`에 `signing_key` 공개키(text)를 함께 싣고(`packages/remote-client/connection.ts`), `rosterJoin`에도 `signing_key`를 싣는다.

3. **Offline 대상 컴퓨터용 Custodial Sync Push (`packages/mobile/src/apps/local/`, `packages/mobile/src/data/`)**:
   - 폰의 앱 데이터가 변경되어 sync push해야 할 때:
     - 대상 컴퓨터(앱의 home/owner 컴퓨터)가 직접 연결되어 있으면 기존대로 `app_sync/push`를 부른다.
     - 대상 컴퓨터가 offline이지만 명단의 다른 **Hub 컴퓨터(`hub === true`)가 온라인으로 연결되어 있으면**, 변경 payload(`appSyncPush` 변경분 직렬화 JSON/base64)를 `custodyEnvelopeBodySchema` 형태로 묶고 폰의 Ed25519 `signing_key`로 `signDetached(CUSTODY_SIGN_CONTEXT, ...)` 서명해 온라인 hub 컴퓨터의 `app_sync/custody_push` route로 보낸다!
   - UI(`packages/mobile/` + `mobile-*.ts` i18n 카탈로그): hub 경유 대기 중 상태("Held via @Hub" 등)가 필요하면 최소 문구로 보여 준다.

## 완료 기준

- `node --test packages/remote-client/*_test.ts` 통과
- `cd packages/mobile && npm run typecheck && npm test` 통과
- `node tools/check-deps.ts && npm run check` 통과
