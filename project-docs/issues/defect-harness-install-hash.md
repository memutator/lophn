---
kind: defect
modules: [packages/coding-agent]
---

# 설치 hash 기록(`.lophn/installed.json`)과 "사람이 고쳤으면 안 덮기"

지금: skill은 파일마다, hook JSON은 lophn 항목만 접은 hash를 `.lophn/installed.json`에 기록한다(`coding-agent/harnesses/install.ts`). 이유: 사람이 고친 설정을 지키는 것은 데이터 보호 쪽이다.

왜 문제: hash 기록과 비교가 붙어 무겁다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
