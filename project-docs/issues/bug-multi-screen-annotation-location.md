---
kind: bug
modules: [packages/core/apps]
---

# 화면이 여럿인 앱은 annotation 위치가 안 풀린다

지금: release map을 화면별로 합치지 못해 source 위치가 안 풀린다. 화면 하나인 앱은 된다.

왜 문제: 화면이 여럿인 앱은 annotation이 source 위치를 못 가리킨다.

고치려면: release map을 화면별로 합친다.
