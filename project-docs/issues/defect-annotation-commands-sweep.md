---
kind: defect
modules: [packages/core/apps]
---

# annotation command 넷과 ref 표, 24시간 sweep, 1시간 유예

지금: command 넷(`AnnotationPersist/Discard/AddRefs/Sweep`)과 ref 표, 24시간 sweep, 1시간 유예를 둔다. memory route라 ledger를 못 써서 사람 자격으로 command를 다시 낸다(`core/apps/annotations/commands.ts`).

왜 문제: annotation 하나에 command, 표, sweep이 따로 있어 무겁다.

고치려면: annotation을 메시지 본문에만 남기고 별도 표·sweep을 없앤다(ticket 근거가 annotation을 직접 가리키지 않게).
