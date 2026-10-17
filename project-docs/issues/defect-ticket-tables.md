---
kind: defect
modules: [packages/core/apps]
---

# ticket 표가 6개다

지금: ticket 표 6개(`tickets`, claims, `ticket_completions`, `ticket_check_results`, `ticket_verdicts` 등). 보고마다 check 결과 한 줄, 확인 결과 한 줄(불변).

왜 문제: 표가 많다.

고치려면: 완료 보고와 결과를 한 표의 열로 합친다.
