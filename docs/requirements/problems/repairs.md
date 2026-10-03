---
type: requirements
concerns: [problems/repairs]
---
# problems/repairs

coding agent가 무엇을 어느 release로 고쳤다고 알렸는지와 실제 테스트 참조·수리 출처를 불변 기록으로 남긴다; 사람의 직접 코드 수리도 ticket을 거치지만 고친 주장과 테스트 요청은 닫힘이 아니며 ticket은 coding-agent/tickets, 실제 결과는 problems/tests, 판정은 problems/closing이 맡는다.

## 요구

### 고친 기록

**[R1]** 코드 수리 기록은 coding agent만 제출하며 해당 문제의 이전 release와 서로 다른 준비된 고친 release·공백 아닌 변경 설명·인증된 작성자와 시각을 보여 준다.
- 이유: 누가 무엇을 고쳤다고 했는지 다음 수리에서 되짚을 수 있어야 한다.
- 확인: 문제 상세에서 두 release·변경 설명·인증된 작성자를 읽고 앱의 대신 제출·다른 앱 release·준비되지 않은 release 연결은 거절된다.
- 의도: coding-agent#I3

**[R2]** 고친 기록은 실제 test result가 있으면 고친 묶음과 일치하는 결과만 가리키고 없으면 미실행 테스트·남은 한계를 설명하며 결과가 없어도 기록할 수 있다.
- 이유: 고쳤다는 주장과 machine 결과가 없다는 사실을 모두 남긴다.
- 확인: 빈 결과 목록의 수리도 기록되지만 다른 묶음 결과는 거절되고 일반 shell 테스트 로그는 설명일 뿐 problems/tests 결과로 승격되지 않는다.
- 의도: coding-agent#I3

**[R3]** 수리 기록은 제출 당시 읽은 문제 상태가 유효할 때만 추가하고 재발·새 수리·나중 test result가 기존 기록을 덮어쓰지 않는다.
- 이유: 동시 변경과 반복 수리의 출처가 사라지면 안 된다.
- 확인: 낡은 문제 기준 제출은 충돌하고 새 수리와 늦은 테스트가 나와도 이전 변경 설명과 결과 참조를 계속 읽을 수 있다.
- 의도: coding-agent#I3

### coding 수리와 ticket 출처

**[R4]** 사람의 직접 코드 수리 요청도 lophn·App Engineer가 repair ticket으로 정리하고 coding agent는 현재 MCP claim으로 작업·고친 기록·완료 보고를 남기며 과거 ticket 없는 기록은 당시 출처대로 보존한다.
- 이유: 코드 수리 입구는 하나로 하되 옛 이력을 꾸미지 않는다.
- 확인: 새 수리 기록에서 ticket·claim 누락은 거절되고 옛 null 출처는 읽기 가능하며 접수·실행 준비는 coding-agent/tickets를 따른다.
- 의도: coding-agent#I3, problems#I1

**[R5]** 새 수리 기록은 그 문제를 포함한 repair ticket의 현재 유효 claim을 가진 coding agent만 제출한다.
- 이유: 새 수리 결과에 다른 agent·만료 claim·session 관측을 담당 근거로 쓰지 않는다.
- 확인: claim 누락·만료·반납·connection 회수·다른 claim의 제출을 거절하고 기록 뒤 담당 변경이 옛 claim seq를 지우지 않는지 본다.
- 의도: coding-agent#I3, problems#I1

### 테스트 요청과 닫힘

**[R6]** 고친 기록 제출은 자동 테스트나 문제 닫힘을 뜻하지 않으며 자기 터미널 수리도 problems/tests의 실제 결과와 problems/closing의 확인 근거를 별도로 따른다.
- 이유: 작업 시작·고쳤다는 보고·실제 검증·문제 닫힘은 다르다.
- 확인: 보고만으로 테스트 자식이나 닫힘이 생기지 않고 ticket claim·release 준비·session ended만으로 수리 확인이 되지 않는지 본다.
- 의도: coding-agent#I3, problems#I3

**[R7]** 사람의 설정·입력 조치에는 고친 기록을 만들기 위해 가짜 release를 요구하지 않고 problems/closing의 보호된 사람 확인을 사용한다.
- 이유: 코드 수리의 두 release 모델을 로그인·설정 복구에 강제하지 않는다.
- 확인: 사람이 설정만 고친 문제를 release 생성 없이 확인할 수 있으며 이를 코드 테스트 통과로 표시하지 않는다.
- 의도: problems#I3

## 열린 질문

## 버린 것

- 별도 RepairAttempt·ChangeSet과 작업 시작 전 통합 계획은 ticket·release·고친 기록·test result로 충분하므로 버린다.
- ticket 없는 직접 코드 수리 fallback은 모든 coding 작업을 ticket→MCP claim→작업→보고로 통일하여 폐기한다. 옛 기록을 삭제하거나 가짜 출처로 채우지는 않는다.
