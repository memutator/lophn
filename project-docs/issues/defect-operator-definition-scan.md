---
kind: defect
modules: [packages/core/lophn-agent]
---

# Operator 정의 파일을 place 폴더를 훑어 찾는다

지금: Operator 정의 파일을 place 폴더를 훑어 찾는다(`findOperator`, ref에 place가 없어서).

왜 문제: ref에 place가 없어 폴더를 훑어야 한다.

고치려면: ref에 place를 싣는다(계약 변경).
