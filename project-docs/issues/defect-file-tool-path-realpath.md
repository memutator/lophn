---
kind: defect
modules: [packages/core/lophn-agent]
---

# 경로 판정이 symlink·끊어진 symlink·새 파일의 상위 realpath까지 본다

지금: 경로 판정이 symlink·끊어진 symlink·새 파일의 상위 realpath까지 본다.

왜 문제: 판정이 복잡하다.

고치려면: 추천: 권한 경계라 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
