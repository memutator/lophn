---
type: requirements
concerns: [lophn-agent/assignments]
---
# lophn-agent/assignments

역할을 실제 범위에 붙이는 assignment의 생성·승인·변경·멈춤·재개·회수, Operator 남길 문서와 반복 실패 멈춤을 맡는다.

## 요구

### 책임과 범위

**[R1]** machine은 앱 등록 뒤 앱마다 거두지 않은 App Engineer assignment 하나를 준비하며 담당 앱 보관 시 멈추고 자동 보관 해제·재개는 하지 않는다.
- 이유: apps/registration에 따라 앱 담당을 준비하고 사람이 재개를 결정하게 한다.
- 확인: 같은 등록 처리가 중복돼도 담당이 하나이고 보관 뒤 새 일이 막히는지 본다.
- 의도: lophn-agent#I4

**[R2]** 거두지 않은 lophn과 Context Engineer의 전역 assignment는 각각 하나이고 App Engineer는 앱마다 하나이며 Operator는 project 또는 app마다 필요한 만큼 두고 assignment·남길 문서 수 상한은 두지 않는다.
- 이유: 실제 책임 중복만 제한하고 임의 개수 한도를 두지 않는다.
- 확인: 같은 project나 app에 8개를 넘는 Operator도 독점·승인 조건을 갖추면 등록되고 같은 앱의 App Engineer 중복은 거절되는지 본다.
- 의도: lophn-agent#I4

**[R3]** 기본 화면에는 맡긴 일의 목적·현재 진행·필요한 행동만 보여 주고 역할·현재 담당 범위·Operator 남길 문서·주기·켜짐·멈춤·회수는 상세에서 현재 run 상태와 구별해 확인하게 하며 화면 말은 shell/wording을 따른다.
- 이유: 책임의 상태와 한 번의 실행 상태는 다르다.
- 확인: run이 완료돼도 assignment가 유지되고 paused 이유와 진행 run을 따로 확인할 수 있는지 본다.
- 의도: lophn-agent#I4

**[R4]** Operator는 사람이 작성하거나 Context Engineer가 제안한 초안의 고정 version을 사람이 승인한 뒤 preset 하나의 고정 판과 assignment를 적용하며 agent가 자기 또는 다른 assignment를 직접 적용하지 않는다.
- 이유: 초안과 실제 반복 책임을 분리한다.
- 확인: 초안 저장·approval request 제출만으로 반복 run이 시작되지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R5]** Operator 생성·변경은 preset 전체 판(context·capability·MCP·skill·provider 계정·model·붙일 지침 포함)과 project/app 범위·남길 문서·주기·승인 앱별 read 명령의 전후 내용·이유를 승인에 묶고 검토 내용이나 이전 판이 달라지면 적용하지 않는다.
- 이유: 승인한 책임보다 넓은 쓰기나 읽기가 생기지 않는다.
- 확인: 승인 후 tool 하나나 이전 assignment를 고친 사례에서 전체 변경이 거절되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

### 남길 문서

**[R6]** Operator assignment에는 실제 첫 version이 있고 새 version을 저장할 수 있는 기존 문서를 최소 1개와 각 문서에 남길 판단을 지정하며 원본 파일 연결·보관 문서·빈 예약·시리즈·동적 이름은 허용하지 않는다.
- 이유: lophn-agent/roles/operator에 따라 승인 쓰기의 실제 대상을 먼저 준비한다.
- 확인: 문서가 없거나 원본 연결인 초안은 거절되고 최초 양식은 주기 결과로 표시되지 않는지 본다.
- 의도: lophn-agent#I4

**[R7]** 남길 문서는 이름·자리가 바뀌어도 같은 문서를 가리키며 최신 형식 계약은 documents/formats를 따르고 Operator의 그 문서 읽기는 자료 속 주소의 추가 읽기를 허용하지 않는다.
- 이유: 결과 문서의 이름과 반복 책임의 정체성을 분리한다.
- 확인: 문서 이름 변경 후 같은 문서에 저장하고 연결된 다른 문서는 권한 없이 읽히지 않는지 본다.
- 의도: lophn-agent#I4

**[R8]** 같은 남길 문서는 거두지 않은 Operator assignment 하나만 소유하며 일시 멈춤도 독점을 유지하되 사람의 직접 편집은 허용하고 충돌을 검사한다.
- 이유: 두 반복 책임의 경쟁 쓰기를 막는다.
- 확인: 두 번째 assignment 선언은 거절되고 사람 편집 뒤 저장은 documents/versions의 기준 판 충돌로 처리되는지 본다.
- 의도: lophn-agent#I4

### 멈춤·실패·재개

**[R9]** 사람은 assignment를 멈추거나 회수할 수 있으며 멈춘 책임은 새 실행 요청을 접수하지 않고 회수된 책임은 재개하지 않으며 다시 맡기려면 새 assignment를 만든다. 거두지 않은 lophn·Context Engineer 전체 범위 assignment는 회수할 수 없고 멈춤·재개만 할 수 있다.
- 이유: 일시 중단과 영구 책임 종료를 구분한다.
- 확인: paused는 사람이 다시 켤 수 있지만 withdrawn은 새 요청·재개를 거절하고 과거 기록은 남는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R10]** 모든 assignment에서 실제 시작한 run의 최종 실패가 연속 3회면 machine이 해당 assignment를 멈추고 실패 종류·횟수·마지막 이유·이미 완료한 일을 secret 없이 보여 준다.
- 이유: lophn-agent/assignments에 따라 한 run 안의 tool 실패와 최종 run 실패를 구분한다.
- 확인: 최종 실패 세 번 뒤 새 회차·실행 요청 접수·후속 호출이 막히고 무관한 assignment·앱은 계속되는지 본다.
- 의도: lophn-agent#I4

**[R11]** 실패 집계는 정상 완료와 Operator 무변화 완료에서 끊고 미시작·사람 중단·거절·답 없음·질문·approval 대기는 세지도 연속 묶음을 지우지도 않는다.
- 이유: 사람의 결정과 기다림을 장애 실패로 취급하지 않는다.
- 확인: 실패·미룸·실패·실패는 멈추고 실패·무변화 완료·실패는 멈추지 않는지 본다.
- 의도: lophn-agent#I4

**[R12]** 반복 실패의 멈춤과 실패 묶음은 사람의 명시적 재개만으로 풀고 시간 경과·재시작·재시도·정의 변경·다음 주기·다른 역할 handoff로 자동 해제하지 않는다.
- 이유: 문제 있는 책임이 재시작 뒤 조용히 되살아나지 않게 한다.
- 확인: 멈춘 책임의 정의를 바꾸거나 컴퓨터를 다시 켜도 paused이고 사람이 재개한 뒤 새 실패 집계를 시작하는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R13]** 반복 실패 멈춤은 해당 assignment와 그 run의 후속 진행에만 적용하고 실패 근거 공개는 lophn-agent/observability와 platform/redaction을 따른다.
- 이유: 하나의 판단 장애가 다른 책임의 실행을 막거나 secret을 노출하지 않는다.
- 확인: 다른 assignment는 진행되고 원인 안내에 인증 값이 없는지 확인한다.
- 의도: lophn-agent#I4

**[R14]** 담당 project·app·남길 문서가 보관되면 그 assignment를 멈추며 일시적으로 접근할 수 없는 대상은 새 일을 시작하거나 호출하지 않는다.
- 이유: 없는 대상에 반복 결과를 쓰지 않는다.
- 확인: 보관은 machine pause로 남고 일시 장애는 변경을 만들지 않으며 진행 run 정리는 lophn-agent/harness/run-loop를 따르는지 본다.
- 의도: lophn-agent#I4

**[R15]** Operator의 실제 진행과 사람 기다림 실행은 lophn-agent/harness/run-loop의 겹침 규칙을 따르며 주기·사람 요청 외 앱 업무 단계나 event 변화로 책임을 자동 접수하지 않는다.
- 이유: 범위·주기·실패 정책을 역할 밖 경로로 우회하지 않는다.
- 확인: 앱 문제나 watch 변화가 assignment의 새 run을 만들지 않는지 확인한다.
- 의도: lophn-agent#I4

**[R16]** enabled·paused assignment는 대화를 열 수 있고 회수된 assignment는 지난 대화만 읽으며 새 대화·입력을 받지 않는다. paused의 입력 보존은 lophn-agent/conversation을 따르고 실행 접수·model·tool 호출이나 자동 재개를 허용하지 않는다.
- 이유: 대화 입력과 책임 실행의 상태를 분리해 멈춘 일이 조용히 되살아나지 않게 한다.
- 확인: paused에 보낸 말은 보존되지만 run·model·tool이 생기지 않고 withdrawn은 지난 대화 읽기만 되는지 본다.
- 의도: lophn-agent#I4

**[R17]** 모든 assignment는 역할 종류가 같은 preset 하나의 존재하는 판을 고정해 사용하고 preset 새 판 저장만으로 연결 판을 바꾸지 않으며 명시 적용한 변경은 다음 run부터 쓴다.
- 이유: 책임 개수와 재사용 구성 수를 구분하고 사용 중 구성을 몰래 바꾸지 않는다.
- 확인: preset을 여러 개 만든 뒤 lophn·Context Engineer의 개수는 하나이고 공유 preset 변경이 연결된 assignment를 자동 이동하지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

## 버린 것
- Operator 시리즈 생성 계약은 lophn-agent/roles/operator에 따라 기존 문서 새 version만 사용하므로 제거했다.
- 최근 60분 최종 실패 5회와 context당 8개·정의당 assignment 1개·run당 결과 1개 한도는 lophn-agent/assignments·lophn-agent/roles/operator의 연속 3회와 책임·문서 독점 조건으로 바꿨다.
