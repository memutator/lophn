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
- 의도: coding-agent#I4

**[R2]** ticket 입력은 한 줄 제목 1~120자, 무엇과 왜 각각 1~2,000자, acceptance check 1~12개, 고정 근거 1~20개, 볼 곳과 지킬 것 각각 최대 20개로 제한하며 필수 빈 값·중복 근거·없는 대상은 생성 전에 거절한다.
- 이유: 원하는 일과 검증 기준을 작고 완전한 계약으로 전달한다.
- 확인: 각 상한과 하나 초과·공백·없는 근거를 비교하고 부적합 입력은 경고가 아니라 무생성으로 거절된다.
- 의도: coding-agent#I3

**[R2]** ticket은 `readiness: needs_confirmation | ready`와 `needs`(필요한 확인 1~200자 한 줄 1~12개)를 함께 가진다. `needs_confirmation`은 근거·채택 답·조건이 비거나 일부여도 되지만 `ready`는 그 셋을 모두 채우고 `needs`가 비어야 한다. ready 전환은 `ticket.make_ready` command로 묶음을 한 번만 채우며 그 뒤 불변이다.
- 이유: App Engineer가 준비 중인 ticket과 검사 가능한 계약이 완성된 ticket을 구별한다.
- 확인: `ready`인데 근거·채택 답·조건이 비거나 `needs`가 남은 입력은 거절되고 make_ready 뒤 재전환 command가 없다.
- 의도: coding-agent#I3

**[R3]** ticket은 사람이 채택한 기획·설계의 고정 문서 판과 그 판을 채택한 질문의 답을 함께 가리키고 최신 주소나 다른 판의 채택 답으로 근거를 대신하면 거절한다.
- 이유: lophn-agent/questions의 채택 사실을 구현 시점까지 보존한다.
- 확인: 근거 문서를 새로 고쳐도 ticket은 원래 판을 읽고 새 판에 옛 채택 답을 붙인 입력은 거절된다.
- 의도: coding-agent#I3

**[R4]** 수리 ticket은 같은 앱의 미해결 문제 1~12개만 묶고 문제당 종료 전 수리 ticket 하나를 원자적으로 보장하며 구현 ticket에는 수리 문제를 묶지 않는다.
- 이유: 중복 수리를 막되 문제 처리 사실은 problems/grouping이 소유한다.
- 확인: 다른 앱·13개 문제·중복 문제를 거절하고 같은 문제 동시 생성 요청 중 하나만 성공한다.
- 의도: coding-agent#I4

**[R5]** 모든 coding 작업은 사람의 직접 요청·피드백도 lophn·담당 App Engineer가 같은 입력 검사를 거쳐 ticket으로 정리하고 생성은 묻지 않으며 별도 공개 단계 없이 즉시 열린 ticket으로 보인다.
- 이유: App Engineer의 ticket 생성은 묻지 않고, 되돌릴 수 있는 생성과 외부 착수를 나눈다.
- 확인: 담당 앱 ticket이 확인 창 없이 즉시 목록에 나오고 별도 공개·수정 도구가 없으며 자동 coding agent run이 시작되지 않는다.
- 의도: coding-agent#I4

**[R6]** ticket 목표·본문·근거·채택 답·acceptance check·수리 대상은 생성 뒤 바꾸지 않고 ready가 된 ticket은 readiness를 `needs_confirmation`으로 되돌리지 않는다. 변경은 사람이 기존 ticket을 취소해 이전 ticket을 근거로 새 ticket을 만드는 방식으로 남긴다.
- 이유: 산출물이 어느 지시에 따라 만들어졌는지 되짚게 한다.
- 확인: claim 전후 목표 변경을 거절하고 ready 뒤 readiness 되돌림도 없으며 새 ticket에서 이전 지시와 취소 이유 및 새 지시를 구별한다.
- 의도: coding-agent#I4

### 검사 가능한 acceptance check

**[R7]** acceptance check는 app test·실행 가능한 test command·원래 증상 reproduction test·보고 release의 activation 일치·연결 문제 전부의 닫힘·테스트를 만들 수 없을 때의 사람 확인만 지원하며 산문 만족도나 취향을 자동 검사 조건으로 받지 않는다.
- 이유: 검사할 수 없는 취향은 채택 질문에서 먼저 정하고, reproduction test를 만들 수 없는 repair만 사람의 확인을 acceptance check로 둔다.
- 확인: 각 종류를 생성·검사할 수 있고 자유 산문 조건을 거절하며 사람 확인은 "내가 확인함"으로 남고 test result 통과와 구별된다.
- 의도: coding-agent#I4

**[R8]** 구현 ticket은 같은 묶음의 app test와 실행 가능한 test command를 각각 하나 이상 요구하고 실제 사용까지 맡긴 경우에만 release activation 조건을 명시한다.
- 이유: 테스트·preview 준비 완료와 운영 사용까지의 완료를 숨은 기본값 없이 구별한다.
- 확인: 필수 테스트 없는 구현은 거절되고 지킬 blueprint 선언도 실행 가능한 조건으로 검사하며 activation 조건이 없는 ticket은 승인 대기로 완료가 막히지 않으며 조건이 있으면 실제 active release를 비교한다.
- 의도: coding-agent#I4

**[R9]** 수리 ticket은 app test·각 대상 문제의 고정 reproduction test 또는 그 테스트를 만들 수 없을 때의 사람 확인·연결 문제 전부의 닫힘을 필수 조건으로 요구하고 빈 조건을 자동 보충하거나 대상 문제를 검사에서 빼지 않는다.
- 이유: problems/tests의 실제 테스트와 문제 영역의 닫힘을 함께 쓰고, 테스트를 만들 수 없으면 사람 확인을 acceptance로 허용한다.
- 확인: reproduction test도 사람 확인도 없는 ticket을 거절하고 사람 확인을 test 통과로 세지 않으며 일부 문제만 통과하거나 전부 제외된 경우 자동 완료·대기 전이를 만들지 않는다.
- 의도: coding-agent#I4

**[R10]** test command 조건은 실행 파일·분리된 인자·앱 source 안의 상대 작업 위치·양의 timeout·기대 종료 값을 명시하고 shell 문자열 해석·루트 밖 경로·외부 symlink를 거절한다.
- 이유: 조건을 실제로 동일하게 실행할 수 있어야 한다.
- 확인: 공백 인자를 그대로 전달하고 실제 종료 값을 정확히 비교하며 절대 경로·외부 symlink·누락 timeout을 거절한다.
- 의도: coding-agent#I4

### claim과 만료

**[R11]** claim은 자기 터미널의 사람 지시 또는 coding-agent/sessions의 [Start] 첫 prompt로 지정한 ticket에 대해 범위 안 coding agent 연결만 MCP로 요청하며 ticket 하나의 현재 연결은 하나이고 한 연결의 동시 ticket 수에는 상한을 두지 않는다. claim 대상은 `ready` ticket뿐이 아니라 `needs_confirmation` ticket도 여섯 진행 구분 안에서 claim된다.
- 이유: problems/repairs과 lophn-agent/harness/tool-judgment를 유지하면서 외부 프로세스의 작업 선택을 대신하지 않는다.
- 확인: 같은 ticket 동시 claim 중 하나만 성공하고 같은 연결이 다른 ticket도 claim할 수 있으며 목록 읽기만으로 claim이 생기지 않는다.
- 의도: coding-agent#I4

**[R12]** claim의 기본 기한은 생성 또는 마지막 명시 갱신 시각부터 60분(3,600,000ms)이며 현재 연결만 기한 전에 명시 갱신·반납할 수 있고 자료 읽기나 release 준비는 기한을 연장하지 않는다.
- 이유: 버려진 세션이 ticket을 영구히 붙잡지 않게 하고 갱신을 드러낸다.
- 확인: 정확히 기한 경계에서 옛 갱신이 거절되고 읽기·묶음·release 준비로 기한이 바뀌지 않으며 응답에서 기한과 반납 방법을 찾는다.
- 의도: coding-agent#I4

**[R13]** machine은 60초마다와 재시작 때 만료 및 연결 회수 claim을 정리하되 모든 ticket 쓰기와 ticket 근거 release 준비에서도 즉시 현재 claim·기한·연결과 이번 claim의 일치를 검사한다.
- 이유: 주기 정리 지연이나 같은 연결의 재claim이 옛 요청을 유효하게 하면 안 된다.
- 확인: 만료 직후 다음 정리 전에도 갱신·release 준비·완료 보고가 거절되고 같은 연결의 재claim 뒤 옛 claim 요청은 충돌한다.
- 의도: coding-agent#I4

**[R14]** 만료·반납·연결 회수로 claim이 끝나면 ticket을 다시 열린 상태로 두되 이전 완료 보고·문서·release·고친 기록·test result를 보존하고 읽기 실패나 5분 무호출만으로 claim을 해제하지 않는다.
- 이유: claim은 업무 권리이지 외부 세션의 생존 감시나 source lock이 아니다.
- 확인: 무호출·일시 조회 실패에서는 기한이 유지되고 만료 뒤 새 claim이 가능하며 과거 결과는 여전히 읽힌다.
- 의도: coding-agent#I4

**[R15]** ticket 근거 release 준비는 현재 유효 claim을 함께 확인해 apps/releases의 출처로 남기며 완료 보고도 같은 앱과 같은 ticket·claim 출처의 release만 받는다.
- 이유: apps/releases에 따라 다른 작업의 release를 자기 완료 결과로 붙이지 못하게 한다.
- 확인: 다른 앱·다른 claim release 연결을 거절하고 ticket과 release에서 원래 claim 출처를 역조회한다.
- 의도: coding-agent#I4

**[R16]** 직접 제작·수리 요청도 ticket 생성 뒤 MCP claim·작업·보고로 처리하고 문제 직접 claim이나 ticket 없는 coding 시작 통로는 제공하지 않는다.
- 이유: 모든 coding 작업의 검사 가능한 계약을 하나로 만들고 과거 ticket 없는 기록은 보존한다.
- 확인: 직접 요청에서도 실제 ticket·claim·완료 보고가 있으며 근거 부족이면 담당 agent가 다음 결정을 준비하고 과거 고친 기록은 조회 가능하다.
- 의도: coding-agent#I4

### 완료 보고와 machine 검사

**[R17]** 완료 보고에는 만든 release·변경 내용·수행한 확인·미실행 확인·한계·문서 산출물·수리 문제별 고친 기록·실제 test result 참조를 연결하고 접수 때 claim을 끝내지만 보고만으로 확인됨이 되지 않는다.
- 이유: 완료 주장과 검증을 분리하고 결과를 원래 ticket에서 찾게 한다.
- 확인: 보고 접수 뒤 claim이 없고 모든 산출물과 한계를 읽을 수 있으며 machine 검사 전 확인됨으로 바뀌지 않는다.
- 의도: coding-agent#I4

**[R18]** machine은 최신 완료 보고의 release에 대해 모든 acceptance check를 조건별로 검사해 통과·실패·미확인과 이유·실제 근거를 보여 주고 test 근거는 problems/tests의 같은 test result만 가리킨다.
- 이유: shell log나 완료 문장을 테스트 결과 정본으로 복제하지 않는다.
- 확인: 일반 shell 성공 문장은 통과 근거가 되지 않고 각 실제 테스트에 같은 묶음 hash의 test result가 연결되며 늦은 옛 보고 검사로 최신 상태를 덮지 않는다.
- 의도: coding-agent#I4

**[R19]** ticket은 열림·claim 중·보고됨·확인됨·확인 실패·취소 여섯 진행 구분을 보이며 최신 보고의 모든 조건 통과는 확인됨, 실제 실패 하나 이상은 확인 실패, 미실행·승인·운영 확인만 남으면 이유와 남은 조건을 가진 보고됨으로 판정한다.
- 이유: 사람 승인 대기를 구현 실패로 오해하면 안 된다.
- 확인: 승인 대기와 실제 테스트 실패가 다른 상태로 나오고 확인 실패는 새 claim 가능하며 확인됨·취소는 다시 열리지 않는다.
- 의도: coding-agent#I4

**[R20]** machine은 재시작 뒤 보고된 ticket의 누락 검사를 이어 하고 test result·문제 닫힘과 재발·release activation과 교체 뒤 남은 조건을 다시 비교한다.
- 이유: 검사 도중 중단되거나 운영 조건이 뒤늦게 맞아도 사람이 다시 지시할 필요가 없게 한다.
- 확인: 검사 중 재시작해도 결과가 이어지고 활성 release가 달라진 늦은 검사로 잘못 확인하지 않으며 model call 없이 정본 비교로 처리한다.
- 의도: coding-agent#I4

**[R21]** 수리 ticket 검사는 problems/closing이 먼저 판정한 닫힘과 이번 보고의 고친 release 근거를 읽고 ticket 완료 보고·확인됨·취소를 이유로 문제를 닫지 않는다.
- 이유: 문제의 정상 여부와 작업 완료는 서로 다른 사실이다.
- 확인: 보고만 제출하거나 ticket을 취소해도 문제는 닫히지 않고 문제 영역의 닫힘 근거가 맞아야 해당 조건이 통과한다.
- 의도: coding-agent#I4

### 취소와 경계

**[R22]** 사람은 종료 전 ticket을 1~200자의 한 줄 사유로 확인 없이 취소할 수 있고 App Engineer 생성의 revert 취소는 외부 claim·보고·결과가 한 번도 없을 때만 허용한다.
- 이유: ticket 취소는 되돌릴 수 있는 일이라 묻지 않는다.
- 확인: 빈 사유·201자·외부 claim 뒤 revert 취소를 거절하고 사람이 유효 사유로 취소하면 confirmation window 없이 적용되며 완료와 구별된다.
- 의도: coding-agent#I4

**[R23]** 취소 직후 옛 claim의 갱신·ticket 근거 release 준비·완료 보고를 거절하되 외부 파일 편집이나 프로세스 종료를 보장하지 않고 이미 남은 결과와 문제를 삭제하지 않는다.
- 이유: 권한을 잃은 새 플랫폼 변경만 막고 과거 사실은 보존한다.
- 확인: 취소 뒤 옛 요청이 거절되고 이전 결과는 조회되며 외부 프로세스를 멈췄다는 가짜 확인이 없다.
- 의도: coding-agent#I4

**[R24]** 문제의 수리 요청은 lophn·App Engineer의 ticket 준비로 이어지고 사람이 자기 터미널에 지정 ticket 지시를 전달하거나 [Start]로 TUI를 열되 priority·요청 표시만으로 자동 시작하지 않는다.
- 이유: 사람의 수리 부탁과 되돌릴 수 없는 approval를 구별한다.
- 확인: 요청 버튼과 자기 터미널 지시와 [Start] 첫 prompt로 claim 근거를 찾되 platform/approvals의 승인이 자동 생성되거나 coding agent가 자동 시작되지 않는다.
- 의도: coding-agent#I4

**[R25]** 기능 요청으로 판명된 문제도 원문·기대 기준·고정 출처를 보존한 채 새 구현 ticket 근거로 연결하고 볼 곳·지킬 것·claim을 권한 grant로 해석하지 않는다.
- 이유: 원래 필요와 기대를 잃지 않고 작업 종류만 바꾼다.
- 확인: 기능 요청 ticket에서 원문과 이전 문제 근거를 찾고 근거 주소나 claim으로 다른 앱 data·임의 code 실행 권한을 얻지 못한다.
- 의도: coding-agent#I4

### 사람이 쓰는 화면

**[R26]** 사람 화면에서 직접 만드는 ticket은 선택한 열린 문제 하나의 수리로 한정하고 제목·무엇과 왜·고정 근거·acceptance check를 기존 증상과 채택 자료에서 자동으로 준비하되 생성 검사를 완화하거나 없는 reproduction 기준·채택 답을 만들어 넣지 않으며 reproduction test를 만들 수 없으면 사람 확인을 조건으로 두고 새 구현 요청과 그 외 근거가 부족한 수리는 담당 App Engineer에게 연결한다. 화면에서 만든 ticket은 `needs_confirmation`으로 열리고 App Engineer가 make_ready로 검사 가능한 계약을 완성하면 `ready`가 된다.
- 이유: 사람이 복잡한 작성 양식을 채우지 않게 하면서 검사 가능한 ticket 계약을 지킨다.
- 확인: 근거가 갖춰진 문제에서는 양식 없이 같은 필수 검사를 통과한 ticket이 생기고 reproduction test를 만들 수 없으면 "내가 확인함" 조건만 생기며 그 외 근거 부족은 무생성과 다음 행동이 보이고 새 구현 요청은 대화로 이어진다.
- 의도: coding-agent#I4

**[R27]** 사람 화면에는 ticket의 제목·원래 요청 또는 문제·지금 결과와 다음 행동만 기본으로 보이고 여섯 진행 구분은 shell/wording의 영어 화면 말로 표현하며 claim 기한·연결 식별자·전체 조건과 보고·test 원문은 기본에서 숨긴다.
- 이유: coding-agent#I5의 사실 구별을 유지하되 바이브코딩 사용자에게 안쪽 작업 계약을 노출하지 않는다.
- 확인: 각 domain 상태가 서로 다른 화면 상태로 보이고 claim이라는 말·기한·연결 ID는 기본에 없으며 실제 검사 근거와 남은 조건은 필요할 때 펼쳐 읽는다.
- 의도: coding-agent#I4

## 열린 질문

없음.

## 버린 것

- 선행 ticket 목록·의존 graph·선행 관계 제거 기능은 현재 일 목록에 필요하지 않으므로 버리고 앞 결과를 근거로 다음 ticket을 새로 만든다.
- lophn agent와 coding agent가 문제를 직접 claim하는 통로 및 문제 요청 상태에 따른 lophn agent claim 테스트는 problems/repairs과 code 작성 경계에 따라 버린다.
- ticket 없는 직접 수리는 두지 않는다. 모든 coding 작업은 ticket이다.
- ticket 취소의 confirmation window는 두지 않는다. 취소는 되돌릴 수 있는 일이다.
- reproduction test를 만들 수 없는데 빈 reproduction을 채우거나 사람 확인을 test 통과로 세지 않는다.
