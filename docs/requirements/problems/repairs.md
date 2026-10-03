---
type: requirements
concerns: [problems/repairs]
---
# problems/repairs

coding agent가 무엇을 어느 release로 고쳤다고 알렸는지와 실제 테스트 참조·수리 출처를 불변 기록으로 남긴다; ticket 없는 사람의 직접 수리도 포함하지만 고친 주장과 테스트 요청은 닫힘이 아니며 ticket은 coding-agent/tickets, 실제 결과는 problems/tests, 판정은 problems/closing이 맡는다.

## 요구

### 고친 기록

**[R1]** 코드 수리 기록은 coding agent만 제출하며 해당 문제의 이전 release와 서로 다른 준비된 고친 release·공백 아닌 변경 설명·인증된 작성자와 시각을 보여 준다.
- 이유: 누가 무엇을 고쳤다고 했는지 다음 수리에서 되짚을 수 있어야 한다.
- 확인: 문제 상세에서 두 release·변경 설명·인증된 작성자를 읽고 앱의 대신 제출·다른 앱 release·준비되지 않은 release 연결은 거절된다.

**[R2]** 고친 기록은 실제 test result가 있으면 고친 묶음과 일치하는 결과만 가리키고 없으면 미실행 테스트·남은 한계를 설명하며 결과가 없어도 기록할 수 있다.
- 이유: 고쳤다는 주장과 machine 결과가 없다는 사실을 모두 남긴다.
- 확인: 빈 결과 목록의 수리도 기록되지만 다른 묶음 결과는 거절되고 일반 shell 테스트 로그는 설명일 뿐 problems/tests 결과로 승격되지 않는다.

**[R3]** 수리 기록은 제출 당시 읽은 문제 상태가 유효할 때만 추가하고 재발·새 수리·나중 test result가 기존 기록을 덮어쓰지 않는다.
- 이유: 동시 변경과 반복 수리의 출처가 사라지면 안 된다.
- 확인: 낡은 문제 기준 제출은 충돌하고 새 수리와 늦은 테스트가 나와도 이전 변경 설명과 결과 참조를 계속 읽을 수 있다.

### 직접 수리와 ticket 출처

**[R4]** ticket 없는 사람의 직접 수리는 ticket·claim·만료·수리 시작 상태 없이 고친 기록과 테스트 요청을 남길 수 있다.
- 이유: ticket은 직접 수리의 필수 입구가 아니며 problems/repairs에 따라 가짜 담당을 만들지 않는다.
- 확인: ticket을 만들거나 claim하지 않아도 수리 기록과 problems/tests 요청이 가능하고 problems/grouping에 고치는 중이나 별도 담당이 생기지 않는다.

**[R5]** ticket 수리 기록은 그 문제를 포함한 repair ticket의 현재 유효 claim을 가진 coding agent의 출처만 받는다.
- 이유: 다른 agent나 만료한 claim의 변경을 현재 ticket의 결과로 섞지 않는다.
- 확인: claim을 놓거나 만료한 뒤 같은 ticket 출처로 제출하면 거절되고 ticket 없는 직접 기록과 출처가 구별된다.

### 테스트 요청과 닫힘

**[R6]** 고친 기록 제출은 자동 테스트나 닫힘을 뜻하지 않으며 직접 수리도 ticket 수리와 같은 problems/tests 요청 및 problems/closing 근거를 적용한다.
- 이유: 완료 주장과 실제 검증·사용 중 확인을 섞지 않는다.
- 확인: 고친 기록만 제출해도 테스트 자식이 시작되거나 문제가 닫히지 않고 별도 요청과 실제 결과·사람 확인을 따른다.

**[R7]** 사람의 설정·입력 조치에는 고친 기록을 만들기 위해 가짜 release를 요구하지 않고 problems/closing의 보호된 사람 확인을 사용한다.
- 이유: 코드 수리의 두 release 모델을 로그인·설정 복구에 강제하지 않는다.
- 확인: 사람이 설정만 고친 문제를 release 생성 없이 확인할 수 있으며 이를 코드 테스트 통과로 표시하지 않는다.

## 열린 질문

- problems/repairs#Q1 앱이 남기던 변경 메모를 코드 수리 기록으로 계속 받을까.

## 버린 것

- 별도 RepairAttempt·ChangeSet과 작업 시작 전 통합 계획은 ticket·release·고친 기록·test result로 충분하므로 버린다.
- 직접 수리에 ticket·claim·만료가 필요 없다는 중복 요구는 이 문서의 직접 수리 약속에 통합하므로 별도 요구로 두지 않는다.
