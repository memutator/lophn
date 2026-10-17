---
kind: defect
modules: [packages/core/apps]
---

# npm·jsr 의존을 준비 때 vendor로 받아 bundle에 통째로 담는다

지금: `vendor/`, `node_modules/` symlink 풀기, 예약 path 거절을 한다. 앱이 network 없이 뜨게 하려는 것이다.

왜 문제: bundle 크기가 커진다.

고치려면: MVP는 npm·jsr 의존을 막고 sdk·@me만 허용.
