---
kind: defect
modules: [packages/core/apps]
---

# 앱별 activation 대기열(메모리)과 30초 재시도

지금: `ApprovalDecided`·`TicketVerified` 뒤 줄에 세우고 차례가 오면 시작한다. 차례가 왔을 때 비교를 다시 보고, 허락한 비교와 달라졌으면 다시 묻는다. `core/apps/releases/activation/{queue,handler,orchestrator}.ts`. 이유: 같은 앱에 activation이 겹치지 않게 하고, 허락과 실제 시작 사이의 변경을 잡는다.

왜 문제: 가장 단순한 구현보다 무겁다.

고치려면: 앱마다 한 번에 하나만 받고 나머지는 `conflict`로 거절한다. 재시도는 없앤다.
