---
kind: defect
modules: [packages/core/lophn-agent]
---

# `wrapUntrusted`가 둘이다

지금: `prompt-assembly/input-tags.ts`와 `run-loop/untrusted.ts`에 같은 것이 있다. web tool은 앞의 것을 쓴다(`core/lophn-agent/`).

왜 문제: 중복이다.

고치려면: 하나로 합친다.
