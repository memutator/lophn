---
kind: defect
modules: [packages/core/apps]
---

# migration 단계마다 PRIMARY KEY 검사와 `-- loss:` 줄 파싱

지금: migration 단계마다 새 표의 PRIMARY KEY를 검사하고, `-- loss:` 줄을 파싱한다(`lossOfStepSql`).

왜 문제: 단계마다 검사와 파싱이 붙어 무겁다.

고치려면: 필요한 검사만 남기고 줄인다.
