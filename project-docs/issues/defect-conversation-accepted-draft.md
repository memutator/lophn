---
kind: defect
modules: [packages/shell/renderer]
---

# 보낸 말을 `accepted`로 남겼다가 확정 메시지가 오면 지운다

지금: 보낸 말을 `accepted`(접수됨)로 남겼다가 확정 메시지가 오면 지운다(`DraftStore`, `conversation/drafts.ts`).

왜 문제: 임시 상태를 따로 관리한다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
