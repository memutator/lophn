---
kind: defect
modules: [packages/core/storage, packages/core/main]
---

# ledger `domainOnly` 옵션을 아무도 안 켠다

지금: 목록 밖 type의 emit을 거절하는 방어 장치인데 wiring 어디서도 켜지 않는다. 주석은 켜진 것처럼 쓴다. `core/storage/ledger/tx.ts`.

왜 문제: 죽은 장치이고 주석이 틀렸다.

고치려면: 지운다. 남기면 daemon wiring에서 켜고 주석을 맞춘다.
