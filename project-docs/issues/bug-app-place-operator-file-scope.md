---
kind: bug
modules: [packages/core/lophn-agent]
---

# 앱 place의 Operator file 범위가 없다

지금: `run-loop/place-data.ts`에 앱 place의 Operator 폴더 처리가 없어 file 범위가 없다.

왜 문제: 앱 place의 Operator가 자기 폴더 file을 못 쓴다.

고치려면: `place-data.ts`에 앱 place의 Operator 폴더를 더한다.
