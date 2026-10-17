---
kind: bug
modules: [packages/core/router]
---

# Router `describe`에 `waiting`이 없다

지금: 기다림은 main thread 메모리에 있고 describe는 reader Worker에서 돌아 running/idle만 낸다.

왜 문제: 기다리는 call이 idle로 보인다.

고치려면: 기다림을 reader Worker가 볼 수 있게 한다.
