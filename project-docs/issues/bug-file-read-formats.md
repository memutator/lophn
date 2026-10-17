---
kind: bug
modules: [packages/core/lophn-agent]
---

# 파일 읽기가 pdf 말고 docx 같은 형식을 못 읽는다

지금: pdf는 `unpdf`로 읽고 docx 같은 형식은 읽지 않는다(`tools/file/pdf.ts`).

왜 문제: docx 같은 문서를 agent가 못 읽는다.

고치려면: 필요한 형식의 reader를 더한다.
