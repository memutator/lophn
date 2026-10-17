---
kind: bug
modules: [packages/core/main, packages/core/apps]
---

# annotation screenshot이 App Engineer model에 안 간다

지금: `annotationDelivery.deliver`(`core/main/daemon/wiring/router.ts`)가 `images`를 받고 쓰지 않아 메시지에는 `[image: ...]` 줄만 있다. App Engineer에는 이미지를 열 tool도 없다. coding agent는 `ticket show`의 파일 경로로 받는다.

왜 문제: App Engineer가 screenshot을 못 본다.

고치려면: 의도인지 정한다. 아니면 이미지를 model에 싣는다.
