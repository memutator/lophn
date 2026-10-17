# event

domain event를 Ledger에 남기고 Reactor가 at-least-once로 반응하는 장치. `project-docs/architecture/event.md`.

## ledger `domainOnly` 옵션을 아무도 켜지 않는다

```yaml
kind: defect
modules: [packages/core/storage, packages/core/main]
```

지금: `storage/ledger/tx.ts`가 `deps.domainOnly === true`일 때만 domain event 목록 밖 type의 emit을 `internal`로 거절한다. 옵션은 `ledger/mod.ts`, `writer-assembly.ts` `WriterBoot`, `writer-worker.ts`를 거쳐 오지만 `main/daemon/runtime.ts`의 `openProductWriter` 호출은 `modules`, `clock`, `seed`만 넘겨서 제품에서는 늘 꺼져 있다. 코드 어디에서도 켜는 곳이 없고 test도 없다. `ledger/domain-events.ts`(`Ledger의 events 표에는 domain event 10개만 쓴다`)와 옵션 주석은 켜진 것처럼 쓴다.

영향: domain event 아닌 type이 events 표에 들어가도 아무도 막지 않는데 주석은 막는다고 한다. 죽은 장치이고 주석이 틀려서 읽는 사람이 속는다. 옵션 한 개가 세 파일을 건넌다.

고치려면:
- 옵션과 거절 분기, 주석을 지운다(작음). 추천.
- 남기려면 `runtime.ts`에서 `domainOnly: true`로 켜고 주석을 맞춘다(작음. 이미 쓰이는 비 domain emit이 있으면 깨지므로 먼저 확인).

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## Reactor의 backoff와 5초 poll 안전망, handler 이름 중복 검사

```yaml
kind: defect
modules: [packages/core/events]
```

지금: `events/reactor/reactor.ts`가 handler 실패(unavailable/throw)에 1~30초 backoff(`BACKOFF_MIN_MS`, `BACKOFF_MAX_MS`)로 cursor를 올리지 않고 다시 하고, 5초(`POLL_MS`)마다 Bus 없이 표를 읽으며, `on`이 같은 type의 같은 handler 이름을 `throw`로 거절한다. 이유는 spec의 "두 번 반응하지 않는다"와 "Bus는 놓칠 수 있고 정본은 Ledger"다(idempotency key에 handler 이름이 들어간다).

영향: 가장 단순한 구현보다 무겁지만 셋 다 at-least-once 약속의 일부다. 지우면 놓친 반응이 영영 없거나 이름 변경이 반응을 다시 하게 한다.

고치려면: 추천: 남긴다. archived로 닫는다(kept). 줄인다면 poll만 남기고 backoff를 고정 간격으로 바꾼다(작음).

정한 것: 다이어트 계획에서 줄일지 정한다.
