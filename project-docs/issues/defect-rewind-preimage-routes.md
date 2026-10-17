---
kind: defect
modules: [packages/core/lophn-agent]
---

# pre-image를 core가 읽어 두는 memory route 둘과 root별 기록

지금: memory route 둘(`StageRewindFile`, `RecordRewindWrite`)과 root별 기록을 둔다. 같은 상대 경로가 두 root에 있으면 `chain_broken`. 이유: 파일 되돌리기의 정확성(데이터 보호). `core/lophn-agent/session/rewind/`.

왜 문제: route와 기록 규칙이 무겁다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
