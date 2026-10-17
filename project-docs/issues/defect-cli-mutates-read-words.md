---
kind: defect
modules: [packages/coding-agent]
---

# `mutates` 칸을 명령 이름 마지막 단어(`READ_WORDS`)로 가른다

지금: `mutates` 칸을 명령 이름 마지막 단어(`READ_WORDS`)로 가른다(`coding-agent/cli/commands/types.ts`).

왜 문제: 이름에 기대는 숨은 규칙이다.

고치려면: 명령마다 `mutates`를 명시한다.
