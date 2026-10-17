---
kind: defect
modules: [packages/core/router]
---

# 배달 실패를 보낸 쪽 종류별로 다르게 돌려준다

지금: 사람은 오류 code, program·coding agent는 `call: null` 결과, agent는 `kind: reply` + 고정 영어 문구로 돌려준다.

왜 문제: 실패 응답 꼴이 보낸 쪽마다 셋이다.

고치려면: 모두 오류 code 하나로.
