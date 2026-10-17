---
kind: defect
modules: [packages/shell/renderer]
---

# 터미널 요청은 `request.coding.app === app`일 때만 pane에서 받는다

지금: 터미널 요청은 `request.coding.app === app`일 때만 pane에서 받는다.

왜 문제: 앱 일치 검사가 pane에 붙어 있다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
