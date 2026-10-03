---
type: requirements
concerns: [coding-agent/tickets]
---
# coding-agent/tickets

앱 하나의 구현·수리 ticket에 담는 불변 요구와 acceptance check, 즉시 열림, coding agent의 claim과 만료·반납, 완료 보고와 machine 검사, 사람 취소를 맡는다; 문제 자체의 상태·닫힘과 실제 test result는 해당 concern을 가리킨다.

## 요구

### 생성과 불변 요구

**[R1]** ticket은 앱 하나의 구현 또는 수리 두 종류만 허용하고 조사·대화·역할 handoff·subagent·여러 앱을 묶는 종류는 거절한다.
- 이유: coding agent에게 맡기는 code 작업을 역할 run과 혼동하지 않게 한다.
- 확인: 두 종류는 생성되지만 앱 둘과 다른 종류 입력은 거절된다.

**[R2]** ticket 입력은 한 줄 제목 1~120자, 무엇과 왜 각각 1~2,000자, acceptance check 1~12개, 고정 근거 1~20개, 볼 곳과 지킬 것 각각 최대 20개로 제한하며 필수 빈 값·중복 근거·없는 대상은 생성 전에 거절한다.
- 이유: 원하는 일과 검증 기준을 작고 완전한 계약으로 전달한다.
- 확인: 각 상한과 하나 초과·공백·없는 근거를 비교하고 부적합 입력은 경고가 아니라 무생성으로 거절된다.

**[R3]** ticket은 사람이 채택한 기획·설계의 고정 문서 판과 그 판을 채택한 질문의 답을 함께 가리키고 최신 주소나 다른 판의 채택 답으로 근거를 대신하면 거절한다.
- 이유: lophn-agent/questions의 채택 사실을 구현 시점까지 보존한다.
- 확인: 근거 문서를 새로 고쳐도 ticket은 원래 판을 읽고 새 판에 옛 채택 답을 붙인 입력은 거절된다.

**[R4]** 수리 ticket은 같은 앱의 미해결 문제 1~12개만 묶고 문제당 종료 전 수리 ticket 하나를 원자적으로 보장하며 구현 ticket에는 수리 문제를 묶지 않는다.
- 이유: 중복 수리를 막되 문제 처리 사실은 problems/grouping이 소유한다.
- 확인: 다른 앱·13개 문제·중복 문제를 거절하고 같은 문제 동시 생성 요청 중 하나만 성공한다.

**[R5]** 사람과 담당 App Engineer가 같은 입력 검사를 거쳐 ticket을 만들 수 있고 App Engineer 생성은 별도 승인·공개 단계 없이 즉시 열린 ticket으로 보인다.
- 이유: lophn-agent/harness/tool-judgment는 되돌릴 수 있는 생성과 외부 착수를 나눈다.
- 확인: 담당 앱 ticket이 즉시 목록에 나오고 별도 공개·수정 도구가 없으며 자동 coding agent run이 시작되지 않는다.

**[R6]** ticket 목표·본문·근거·채택 답·acceptance check·수리 대상은 생성 뒤 바꾸지 않고 변경은 사람이 기존 ticket을 취소해 이전 ticket을 근거로 새 ticket을 만드는 방식으로 남긴다.
- 이유: 산출물이 어느 지시에 따라 만들어졌는지 되짚게 한다.
- 확인: claim 전후 목표 변경을 거절하고 새 ticket에서 이전 지시와 취소 이유 및 새 지시를 구별한다.

### 검사 가능한 acceptance check

**[R7]** acceptance check는 app test·실행 가능한 test command·원래 증상 reproduction test·보고 release의 activation 일치·연결 문제 전부의 닫힘만 지원하며 산문 만족도나 취향을 자동 검사 조건으로 받지 않는다.
- 이유: 검사할 수 없는 취향은 채택 질문에서 먼저 정하고 machine은 실제 근거만 판정한다.
- 확인: 각 종류를 생성·검사할 수 있고 자유 산문 조건을 거절하며 조건별 실행 또는 비교 대상과 통과 기준을 읽을 수 있다.

**[R8]** 구현 ticket은 같은 묶음의 app test와 실행 가능한 test command를 각각 하나 이상 요구하고 실제 사용까지 맡긴 경우에만 release activation 조건을 명시한다.
- 이유: 테스트·preview 준비 완료와 운영 사용까지의 완료를 숨은 기본값 없이 구별한다.
- 확인: 필수 테스트 없는 구현은 거절되고 지킬 blueprint 선언도 실행 가능한 조건으로 검사하며 activation 조건이 없는 ticket은 승인 대기로 완료가 막히지 않으며 조건이 있으면 실제 active release를 비교한다.

**[R9]** 수리 ticket은 app test·각 대상 문제의 고정 reproduction test·연결 문제 전부의 닫힘을 필수 조건으로 요구하고 빈 조건을 자동 보충하거나 대상 문제를 검사에서 빼지 않는다.
- 이유: problems/tests의 실제 테스트와 문제 영역의 닫힘을 함께 사용한다.
- 확인: 재현 기준 없는 ticket을 거절하고 일부 문제만 통과하거나 전부 제외된 경우 자동 완료·대기 전이를 만들지 않는다.

**[R10]** test command 조건은 실행 파일·분리된 인자·앱 source 안의 상대 작업 위치·양의 timeout·기대 종료 값을 명시하고 shell 문자열 해석·루트 밖 경로·외부 symlink를 거절한다.
- 이유: 조건을 실제로 동일하게 실행할 수 있어야 한다.
- 확인: 공백 인자를 그대로 전달하고 실제 종료 값을 정확히 비교하며 절대 경로·외부 symlink·누락 timeout을 거절한다.

### claim과 만료

**[R11]** claim은 사람이 연 세션에서 사람 지시를 받은 범위 안 coding agent 연결만 요청하며 ticket 하나의 현재 연결은 하나이고 한 연결의 동시 ticket 수에는 상한을 두지 않는다.
- 이유: problems/repairs과 lophn-agent/harness/tool-judgment를 유지하면서 외부 프로세스의 작업 선택을 대신하지 않는다.
- 확인: 같은 ticket 동시 claim 중 하나만 성공하고 같은 연결이 다른 ticket도 claim할 수 있으며 목록 읽기만으로 claim이 생기지 않는다.

**[R12]** claim의 기본 기한은 생성 또는 마지막 명시 갱신 시각부터 60분(3,600,000ms)이며 현재 연결만 기한 전에 명시 갱신·반납할 수 있고 자료 읽기나 release 준비는 기한을 연장하지 않는다.
- 이유: 버려진 세션이 ticket을 영구히 붙잡지 않게 하고 갱신을 드러낸다.
- 확인: 정확히 기한 경계에서 옛 갱신이 거절되고 읽기·묶음·release 준비로 기한이 바뀌지 않으며 응답에서 기한과 반납 방법을 찾는다.

**[R13]** machine은 60초마다와 재시작 때 만료 및 연결 회수 claim을 정리하되 모든 ticket 쓰기와 ticket 근거 release 준비에서도 즉시 현재 claim·기한·연결과 이번 claim의 일치를 검사한다.
- 이유: 주기 정리 지연이나 같은 연결의 재claim이 옛 요청을 유효하게 하면 안 된다.
- 확인: 만료 직후 다음 정리 전에도 갱신·release 준비·완료 보고가 거절되고 같은 연결의 재claim 뒤 옛 claim 요청은 충돌한다.

**[R14]** 만료·반납·연결 회수로 claim이 끝나면 ticket을 다시 열린 상태로 두되 이전 완료 보고·문서·release·고친 기록·test result를 보존하고 읽기 실패나 5분 무호출만으로 claim을 해제하지 않는다.
- 이유: claim은 업무 권리이지 외부 세션의 생존 감시나 source lock이 아니다.
- 확인: 무호출·일시 조회 실패에서는 기한이 유지되고 만료 뒤 새 claim이 가능하며 과거 결과는 여전히 읽힌다.

**[R15]** ticket 근거 release 준비는 현재 유효 claim을 함께 확인해 apps/releases의 출처로 남기며 완료 보고도 같은 앱과 같은 ticket·claim 출처의 release만 받는다.
- 이유: apps/releases에 따라 다른 작업의 release를 자기 완료 결과로 붙이지 못하게 한다.
- 확인: 다른 앱·다른 claim release 연결을 거절하고 ticket과 release에서 원래 claim 출처를 역조회한다.

**[R16]** ticket 없는 직접 수리에는 문제 claim·별도 기한·자동 claim을 두지 않고 problems/repairs와 problems/tests를 사용한다.
- 이유: problems/repairs의 사람 직접 수리를 유지한다.
- 확인: 문제 claim과 lophn agent의 code 수리 claim 통로가 없고 ticket 없는 수리는 고친 기록과 실제 테스트 요청만 남긴다.

### 완료 보고와 machine 검사

**[R17]** 완료 보고에는 만든 release·변경 내용·수행한 확인·미실행 확인·한계·문서 산출물·수리 문제별 고친 기록·실제 test result 참조를 연결하고 접수 때 claim을 끝내지만 보고만으로 확인됨이 되지 않는다.
- 이유: 완료 주장과 검증을 분리하고 결과를 원래 ticket에서 찾게 한다.
- 확인: 보고 접수 뒤 claim이 없고 모든 산출물과 한계를 읽을 수 있으며 machine 검사 전 확인됨으로 바뀌지 않는다.

**[R18]** machine은 최신 완료 보고의 release에 대해 모든 acceptance check를 조건별로 검사해 통과·실패·미확인과 이유·실제 근거를 보여 주고 test 근거는 problems/tests의 같은 test result만 가리킨다.
- 이유: shell log나 완료 문장을 테스트 결과 정본으로 복제하지 않는다.
- 확인: 일반 shell 성공 문장은 통과 근거가 되지 않고 각 실제 테스트에 같은 묶음 hash의 test result가 연결되며 늦은 옛 보고 검사로 최신 상태를 덮지 않는다.

**[R19]** ticket은 열림·claim 중·보고됨·확인됨·확인 실패·취소 여섯 진행 구분을 보이며 최신 보고의 모든 조건 통과는 확인됨, 실제 실패 하나 이상은 확인 실패, 미실행·승인·운영 확인만 남으면 이유와 남은 조건을 가진 보고됨으로 판정한다.
- 이유: 사람 승인 대기를 구현 실패로 오해하면 안 된다.
- 확인: 승인 대기와 실제 테스트 실패가 다른 상태로 나오고 확인 실패는 새 claim 가능하며 확인됨·취소는 다시 열리지 않는다.

**[R20]** machine은 재시작 뒤 보고된 ticket의 누락 검사를 이어 하고 test result·문제 닫힘과 재발·release activation과 교체 뒤 남은 조건을 다시 비교한다.
- 이유: 검사 도중 중단되거나 운영 조건이 뒤늦게 맞아도 사람이 다시 지시할 필요가 없게 한다.
- 확인: 검사 중 재시작해도 결과가 이어지고 활성 release가 달라진 늦은 검사로 잘못 확인하지 않으며 model call 없이 정본 비교로 처리한다.

**[R21]** 수리 ticket 검사는 problems/closing이 먼저 판정한 닫힘과 이번 보고의 고친 release 근거를 읽고 ticket 완료 보고·확인됨·취소를 이유로 문제를 닫지 않는다.
- 이유: 문제의 정상 여부와 작업 완료는 서로 다른 사실이다.
- 확인: 보고만 제출하거나 ticket을 취소해도 문제는 닫히지 않고 문제 영역의 닫힘 근거가 맞아야 해당 조건이 통과한다.

### 취소와 경계

**[R22]** 사람은 종료 전 ticket을 1~200자의 한 줄 사유로 취소할 수 있고 App Engineer 생성의 revert 취소는 외부 claim·보고·결과가 한 번도 없을 때만 허용한다.
- 이유: 사람의 의도 변경과 lophn-agent/harness/tool-judgment의 안전한 revert 범위를 남긴다.
- 확인: 빈 사유·201자·외부 claim 뒤 revert 취소를 거절하고 사람이 유효 사유로 취소하면 완료와 구별된다.

**[R23]** 취소 직후 옛 claim의 갱신·ticket 근거 release 준비·완료 보고를 거절하되 외부 파일 편집이나 프로세스 종료를 보장하지 않고 이미 남은 결과와 문제를 삭제하지 않는다.
- 이유: 권한을 잃은 새 플랫폼 변경만 막고 과거 사실은 보존한다.
- 확인: 취소 뒤 옛 요청이 거절되고 이전 결과는 조회되며 외부 프로세스를 멈췄다는 가짜 확인이 없다.

**[R24]** 문제의 수리 요청은 사람에게 복사할 직접 수리 문장이나 ticket 고정 자료를 제공하는 것이며 priority·요청 표시를 승인이나 외부 coding agent 자동 시작으로 취급하지 않는다.
- 이유: 사람의 수리 부탁과 되돌릴 수 없는 approval를 구별한다.
- 확인: 요청 버튼과 사람 세션의 수리 지시로 claim 근거를 찾되 platform/approvals의 승인이 자동 생성되거나 coding agent가 자동 시작되지 않는다.

**[R25]** 기능 요청으로 판명된 문제도 원문·기대 기준·고정 출처를 보존한 채 새 구현 ticket 근거로 연결하고 볼 곳·지킬 것·claim을 권한 grant로 해석하지 않는다.
- 이유: 원래 필요와 기대를 잃지 않고 작업 종류만 바꾼다.
- 확인: 기능 요청 ticket에서 원문과 이전 문제 근거를 찾고 근거 주소나 claim으로 다른 앱 data·임의 code 실행 권한을 얻지 못한다.

## 열린 질문

- coding-agent/tickets#Q1 긴 구현 세션에 기본 60분 claim을 유지할까.
- coding-agent/tickets#Q2 H4 reproduction test 없는 수리 ticket도 사람 acceptance check로 허용할까.
- coding-agent/tickets#Q3 구현 ticket 완료 끝점을 공통 기본값으로 정할까.
- coding-agent/tickets#Q4 H7 담당 App Engineer의 승인 없는 즉시 ticket 생성을 유지할까.
- coding-agent/tickets#Q5 옛 24시간 문제 claim과 읽기 자동 갱신을 유지할까.

## 버린 것

- 선행 ticket 목록·의존 graph·선행 관계 제거 기능은 현재 일 목록에 필요하지 않으므로 버리고 앞 결과를 근거로 다음 ticket을 새로 만든다.
- lophn agent와 coding agent가 문제를 직접 claim하는 통로 및 문제 요청 상태에 따른 lophn agent claim 테스트는 problems/repairs과 code 작성 경계에 따라 버린다.
