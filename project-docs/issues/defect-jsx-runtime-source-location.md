---
kind: defect
modules: [packages/core/apps]
---

# jsx-runtime esbuild plugin이 SDK component마다 stack으로 위치를 읽는다

지금: jsx-runtime을 가로채는 esbuild plugin이 SDK component마다 `new Error().stack`으로 위치를 읽어 `data-lophn-at`을 싣는다. annotation이 화면 요소를 source 위치로 잇는 길이다. 개발·release build 둘 다에 들어간다(`core/apps/releases/ui-build/app-build.ts`).

왜 문제: 렌더마다 stack을 만드는 비용이 있다.

고치려면: annotation은 화면 위치(selector)만 남기고 source 위치 잇기를 뺀다.
