---
kind: defect
modules: [packages/core/apps]
---

# ticket마다 revision, claim_seq, completion_seq

지금: ticket마다 revision(1부터, 바뀔 때마다 증가), claim_seq, completion_seq를 둔다.

왜 문제: 카운터가 셋이다.

고치려면: 정말 필요한 카운터만 남긴다.
