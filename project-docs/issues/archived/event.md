# event (닫음)

## ledger `domainOnly` 옵션을 아무도 켜지 않는다

```yaml
kind: defect
modules: [packages/core/storage, packages/core/main]
closed: fixed
guard: 없음
```

지금: `storage/ledger/tx.ts`가 `deps.domainOnly === true`일 때만 domain event 목록 밖 type의 emit을 `internal`로 거절한다. 옵션은 `ledger/mod.ts`, `writer-assembly.ts` `WriterBoot`, `writer-worker.ts`를 거쳐 오지만 `main/daemon/runtime.ts`의 `openProductWriter` 호출은 `modules`, `clock`, `seed`만 넘겨서 제품에서는 늘 꺼져 있다. 코드 어디에서도 켜는 곳이 없고 test도 없다. `ledger/domain-events.ts`(`Ledger의 events 표에는 domain event 10개만 쓴다`)와 옵션 주석은 켜진 것처럼 쓴다.

영향: domain event 아닌 type이 events 표에 들어가도 아무도 막지 않는데 주석은 막는다고 한다. 죽은 장치이고 주석이 틀려서 읽는 사람이 속는다. 옵션 한 개가 세 파일을 건넌다.

고치려면:
- 옵션과 거절 분기, 주석을 지운다(작음). 추천.
- 남기려면 `runtime.ts`에서 `domainOnly: true`로 켜고 주석을 맞춘다(작음. 이미 쓰이는 비 domain emit이 있으면 깨지므로 먼저 확인).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `LedgerDeps`·`TxDeps`·`WriterBoot`의 `domainOnly`와 `emitAs`의 거절 분기, `domain-events.ts`(`isDomainEvent`)를 지웠다.

## Reactor의 backoff와 5초 poll 안전망, handler 이름 중복 검사

```yaml
kind: defect
modules: [packages/core/events]
closed: kept
guard: 없음
```

지금: `events/reactor/reactor.ts`가 handler 실패(unavailable/throw)에 1~30초 backoff(`BACKOFF_MIN_MS`, `BACKOFF_MAX_MS`)로 cursor를 올리지 않고 다시 하고, 5초(`POLL_MS`)마다 Bus 없이 표를 읽으며, `on`이 같은 type의 같은 handler 이름을 `throw`로 거절한다. 이유는 spec의 "두 번 반응하지 않는다"와 "Bus는 놓칠 수 있고 정본은 Ledger"다(idempotency key에 handler 이름이 들어간다).

영향: 가장 단순한 구현보다 무겁지만 셋 다 at-least-once 약속의 일부다. 지우면 놓친 반응이 영영 없거나 이름 변경이 반응을 다시 하게 한다.

고치려면: 추천: 남긴다. 줄인다면 poll만 남기고 backoff를 고정 간격으로 바꾼다(작음).

닫음: backoff, 5초 poll, 이름 중복 검사 셋 모두 at-least-once 약속의 일부다. 지우면 놓친 반응이 영영 없거나 이름 변경이 반응을 다시 하게 한다.

## core에 `session_snapshots/list` read가 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/approvals, packages/core/main, packages/shell/renderer]
closed: fixed
guard: tests/e2e/approval_test.ts, tests/e2e/restart_test.ts
```

지금: `packages/protocol/events/snapshot.ts`가 `sessionSnapshotsList`(session의 지금 상태, 대기 중인 permission request, 질문)를 정의하고 `packages/protocol/registry.ts`에 올라 있지만, core에 그 read handler를 다는 곳이 없다. `packages/core/server/dispatch.ts`의 `read()`가 handler를 못 찾아 `unavailable: read unavailable`을 낸다. `packages/core/approvals/approvals.ts`가 service에 `turnRequests`를 내놓지만 부르는 곳이 없다. `tests/e2e/approval_test.ts`와 `tests/e2e/restart_test.ts`가 `waitPermission`(`tests/support/core/human.ts`)에서 재현한다.

영향: renderer의 `readSessions`(`packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`)는 session이 하나라도 있으면 이 read를 부르고, 실패하면 목록 전체를 실패로 돌려준다. 화면이 붙거나 다시 붙을 때 대기 중인 허락 요청과 질문을 snapshot으로 다시 맞추는 길(`architecture/event.md`)이 없다.

고치려면:
- read handler를 단다(중간): session 상태는 lophn-agent의 turn 기록에서, `permission_requests`는 approvals의 `turnRequests`에서, 질문은 그 저장소에서 모은다. 조립은 `main/daemon/wiring/`에서 한다(approvals와 lophn-agent를 잇는 곳).
- 추천: read handler를 단다. snapshot은 architecture가 정한 계약이다.

닫음: `main/daemon/wiring/session-snapshots.ts`가 read를 단다. lophn session은 `lophn-agent/session/model.ts`의 함수로, coding session은 `apps/tickets/coding/store.ts`의 함수로 읽고, `permission_requests`는 approvals의 `turnRequests`, 질문은 approvals wiring이 `questionWaits`로 낸 기다림의 `list`에서 온다. `sessions`를 생략하면 열린 session 전부, 없는 id는 뺀다.
