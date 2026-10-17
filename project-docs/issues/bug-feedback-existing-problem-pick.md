---
kind: bug
modules: [packages/shell/renderer, packages/shell/ipc, packages/core/problems]
---

# 제보 창에서 기존 문제를 못 고른다

지금: 제보 창이 같은 앱의 열린 문제 목록을 못 받아 늘 "새 문제"로 보낸다. Issues에서 연 제보만 기존 문제에 붙는다.

왜 문제: 같은 문제가 새 문제로 중복해서 올라간다.

고치려면: `beginFeedback` 답을 `{draftRef, problems}`로 넓힌다(계약 고침).
