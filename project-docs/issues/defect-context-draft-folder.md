---
kind: defect
modules: [packages/core/projects]
---

# context 초안을 ledger가 아니라 data root 아래 폴더에 두고 제출 때 확정한다

지금: 초안을 ledger가 아니라 data root 아래 폴더(`drafts/<bundle>/bundle.json`)에 두고, 제출 때 검사해 판으로 확정한다. PM이 file tool로 직접 고치게 하려는 것이라 가벼운 쪽이다.

왜 문제: 결함은 아니고 결정을 기록해 둔 것이다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
