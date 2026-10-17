---
kind: defect
modules: [packages/core/apps, packages/core/storage]
---

# coding session을 메모리 대신 ledger 표 셋과 `ApplyCodingSignal`로 둔다

지금: 표 셋(`coding_sessions`, `coding_lines`, `coding_inputs`)과 machine command `ApplyCodingSignal`을 둔다(`core/apps/tickets/coding/`). 이유: writer·reader Worker가 같이 보고 tx와 같이 되돌아가야 해서다. 켤 때 비운다.

왜 문제: 표와 command가 늘었다.

고치려면: coding session을 main thread 한 곳에만 두고 core 읽기는 그쪽에 묻는다(Worker 경계를 넘는 port가 필요).
