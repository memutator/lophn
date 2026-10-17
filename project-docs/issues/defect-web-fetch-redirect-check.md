---
kind: defect
modules: [packages/core/lophn-agent]
---

# `web.fetch` redirect를 hop마다 검사하며 직접 따라간다

지금: `web.fetch` redirect를 hop마다 대상 검사하며 직접 따라간다(최대 5번). 금지 대역 표가 길다.

왜 문제: 검사와 금지 대역 표가 길다.

고치려면: 추천: 권한 경계라 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
