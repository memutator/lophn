---
kind: defect
modules: [packages/core/apps, packages/core/router]
---

# `ticket.cancel`이 transport의 active·waiting call을 찾아 멈춘다

지금: `ticket.cancel`이 transport의 active·waiting call을 찾아 멈춘다.

왜 문제: ticket과 transport가 서로 묶인다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
