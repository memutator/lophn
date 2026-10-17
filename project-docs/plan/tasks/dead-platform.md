# dead-platform

두 가지 흔적을 지운다. ledger의 `domainOnly` 옵션과, 직통 통로를 지운 뒤 남은 `protocol/apps/direct-socket.ts`(상수 이름 `DIRECT_SOCKET_PATHS` 포함).

- 단위: dead (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/storage/ledger/tx.ts`, `packages/core/storage/ledger/mod.ts`, `packages/core/storage/ledger/writer-assembly.ts`, `packages/core/storage/ledger/writer-worker.ts`, `packages/core/storage/ledger/domain-events.ts`
  - `packages/protocol/apps/direct-socket.ts`, `packages/protocol/apps/channel-values.ts`, `packages/protocol/apps/mod.ts`, `packages/protocol/apps/calls/process-wire.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
- 읽을 것:
  - issues: `project-docs/issues/event.md`의 "ledger `domainOnly` 옵션을 아무도 켜지 않는다", `project-docs/issues/code-health.md`의 "`protocol/apps/direct-socket.ts`의 흔적". 둘 다 정한 것이 "지운다"다.
  - architecture: 둘을 다루는 문장이 없다(`domainOnly`, `direct-socket`은 `project-docs/architecture`에 나오지 않는다). 문서는 lead가 고친다.
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/storage`, `packages/protocol`, `packages/core/main`
- 계약:
  - 쓰는 것: `packages/protocol/apps/channel-values.ts`의 supervisor 제어 경로 상수.
  - 바꾸는 것: protocol 상수 `DIRECT_SOCKET_PATHS`를 `CONTROL_PATHS`로 바꾸고 `probe`·`open`·`close`·`shutdown` 네 칸만 둔다. 쓰는 곳은 `core/main/app-supervisor/assembly.ts` 하나뿐이고 소유에 넣었다. `core/apps/runtime/entrypoint/limits.ts`에 이미 같은 값의 `CONTROL_PATHS`가 있다(runtime graph가 Zod를 안 쓰려고 둔 사본이고 별개 module이다). 그쪽은 소유 밖이라 건드리지 않는다.
  - `LedgerDeps.domainOnly`·`WriterBoot.domainOnly`(내부 옵션)를 지운다. 제품 호출(`core/main/daemon/runtime.ts`의 `openProductWriter`)은 넘기지 않았으므로 쓰는 쪽을 고칠 일이 없다.
- 정한 것: `DIRECT_SOCKET_PATHS`의 `screen`·`invoke`·`cancel`·`status`·`viewClosed` 다섯 칸은 직통 통로의 것이고 코드 어디서도 안 쓴다(확인함). 이름만 바꾸지 않고 같이 지운다. `direct-socket.ts`에 남은 고아 주석(읽기 결과 원천 상태, confirm proof 등)은 가리키는 코드가 없어 옮기지 않고 같이 지운다. `appDirectSocketPath(s)`(`protocol/apps/socket-slots.ts`)는 지금 쓰는 앱 socket 경로를 만드는 함수이고 이슈 범위 밖이다. 이름과 주석을 바꾸지 않는다.

## 할 일

### 1. ledger domainOnly

1. `packages/core/storage/ledger/tx.ts`: `TxDeps.domainOnly?`와 주석, `emitAs` 안의 `if (deps.domainOnly === true && !isDomainEvent(event.type)) { throw fail(err(internalError())); }`를 지운다. `isDomainEvent` import와, 그것으로만 쓰이던 import(`internalError` 등)가 더 쓰이는지 본다.
2. `packages/core/storage/ledger/mod.ts`: `LedgerDeps.domainOnly?`와 주석, `ledger()`의 `domainOnly: deps.domainOnly`, `export { isDomainEvent } from "./domain-events.ts"`를 지운다.
3. `packages/core/storage/ledger/writer-assembly.ts`: `WriterBoot.domainOnly?`와 주석을 지운다. `packages/core/storage/ledger/writer-worker.ts`: boot 타입의 `domainOnly?`와 `deps`의 `domainOnly: boot.domainOnly`를 지운다.
4. `packages/core/storage/ledger/domain-events.ts`를 지운다(`isDomainEvent`만 있고 쓰는 곳이 없어진다. 틀린 주석 "Ledger의 events 표에는 domain event 10개만 쓴다"도 함께 사라진다). 그 file을 가리키던 곳이 더 없는지 `grep -rn "domain-events" packages`로 확인한다. (`domain-event_test.ts`는 `isDomainEvent`를 쓰지 않는다. 고치지 않는다.)

### 2. direct-socket 흔적

5. `packages/protocol/apps/channel-values.ts`: `DIRECT_SOCKET_PATHS`를 `CONTROL_PATHS`로 바꾸고 `probe`·`open`·`close`·`shutdown` 네 칸만 둔다. 주석 "로컬 socket 경로. core API가 아니다."를 "supervisor가 앱 process에 보내는 제어 경로다. core API가 아니다."로 고친다.
6. `packages/protocol/apps/direct-socket.ts`를 지우고 `packages/protocol/apps/mod.ts`의 `export * from "./direct-socket.ts"` 줄을 뺀다(`channel-values.ts`는 이미 export돼 있다).
7. `packages/core/main/app-supervisor/assembly.ts`: import와 사용 네 곳(`probe`, `close`, `shutdown`, `open` 두 곳)을 `CONTROL_PATHS`로 바꾼다.
8. `packages/protocol/apps/calls/process-wire.ts`의 주석 "probe·open·close·shutdown은 DIRECT_SOCKET_PATHS를 쓴다."를 `CONTROL_PATHS`로 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우는 일이다.
- 남지 않음:
  - `grep -rnE "domainOnly|isDomainEvent|domain-events\.ts" packages tools --include=*.ts --exclude-dir=node_modules --exclude-dir=dist`가 0줄이다.
  - `grep -rnE "DIRECT_SOCKET_PATHS|direct-socket\.ts" packages tools --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist`가 0줄이다.
  - `ls packages/protocol/apps/direct-socket.ts packages/core/storage/ledger/domain-events.ts`가 둘 다 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(지우기만이다)
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 위 "정한 것"에서 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
