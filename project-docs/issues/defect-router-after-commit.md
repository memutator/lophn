---
kind: defect
modules: [packages/core/storage, packages/core/router, packages/core/main]
---

# commit 뒤 할 일(after-commit) 길

지금: writer Worker의 tx가 할 일을 모아 `CommandSuccess.after_commit`에 싣고 main이 입력함·Bus에 적용한다. 되돌린 tx나 재전달이면 버린다. `storage/ledger/after-commit.ts`, `writer-worker.ts`, `run-loop/work.ts`의 `createInboxApplier`. 이유: 입력함·Bus가 main thread에 있고 command는 Worker에서 돈다.

왜 문제: 가장 단순한 구현보다 무겁지만 대안이 마땅치 않다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
