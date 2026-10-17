---
kind: defect
modules: [packages/core/approvals, packages/core/lophn-agent]
---

# 허락 뒤 `resolve`를 한 번 더 불러 intent를 다시 만든다

지금: 허락 뒤 `resolve`를 한 번 더 불러 intent를 다시 만들고 `consumeTurnAllow`에 넘긴다(허락과 실행 사이 변경을 잡는다). spec 요구.

왜 문제: resolve가 두 번 돈다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
