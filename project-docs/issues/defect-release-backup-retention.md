---
kind: defect
modules: [packages/core/apps]
---

# 복구본 보존과 complete 때 한꺼번에 하는 일

지금: 복구본은 `permanent` + `eraseBlobRefs`로 보존하고, data worker는 앱 폴더에 최근 하나만 둔다. `complete`는 같은 tx에서 `syncAppGrants(..., "granted")`, `discardBackups`, revision `max(head seq, 현재+1)`를 한다.

왜 문제: complete 한 tx에 일이 많이 몰려 있다.

고치려면: 복구본 보존 규칙과 complete의 일을 나눠 줄인다.
