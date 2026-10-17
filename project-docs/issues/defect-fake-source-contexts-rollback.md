---
kind: defect
modules: [packages/shell/renderer]
---

# fake source가 보관·rollback을 메모리에서 실제로 돌린다

지금: contexts overview의 fake source가 보관·rollback을 메모리에서 실제로 돌린다(gallery용).

왜 문제: fake가 실제 동작을 흉내 내서 무겁다.

고치려면: gallery에 필요한 만큼만 fake로 둔다.
