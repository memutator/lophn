---
kind: defect
modules: [packages/core/lophn-agent]
---

# shell을 새 process group으로 띄우고 출력 상한이 둘이다

지금: shell을 새 process group(`setsid`)으로 띄워 시간 초과 때 group째 죽인다. 상한 120/600초, stream마다 1 MiB.

왜 문제: 출력 1 MiB 둘이면 model에 2 MiB까지 간다.

고치려면: 출력 상한을 더 낮춘다.
