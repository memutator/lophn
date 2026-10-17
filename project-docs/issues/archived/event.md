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
