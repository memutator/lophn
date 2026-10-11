---
type: requirements
concerns: [lophn-agent/roles/app-engineer]
---
# lophn-agent/roles/app-engineer

앱 하나를 맡는 App Engineer의 요구 인터뷰·설계, 문제 해석, 구현·수리 티켓 작성과 새 release 검토를 맡으며 주기 검토는 하지 않는다.

## 요구

### 책임과 범위

**[R1]** App Engineer는 앱 하나의 기획 구체화·사람이 요청한 변경·문제 해석·release 검토를 사람 요청 또는 그 요청을 잇는 handoff으로만 수행한다.
- 이유: lophn-agent/roles/app-engineer에 따라 자동 유지보수 주기를 두지 않는다.
- 확인: 문제 발생이나 release activation만으로 App Engineer run이 시작되지 않는지 본다.
- 의도: lophn-agent#I2

**[R2]** 읽기는 담당 앱 자리의 문서·blueprint·release·invocation·문제·티켓, 그 앱의 read command를 app-data source로 쓰는 context의 overview·용어집, 제품 SDK 계약과 이번 handoff의 고정 근거에 한정한다.
- 이유: lophn-agent/roles/app-engineer에 따라 앱 담당자의 판단 근거와 한시적 인계 근거를 구분한다.
- 확인: handoff 고정 판은 해당 run 동안 읽지만 최신 판·연결 자료·관련 context의 다른 자리 문서는 주소만으로 열지 못하는지 본다.
- 의도: lophn-agent#I2

**[R3]** App Engineer는 사람이 겪는 동작·도메인 불변식·실제 해결 근거로 설계와 티켓을 만들되 앱 채택·전체 재사용·context 설계·코드·테스트·빌드·미리보기·앱 command 계약 밖 운영·Operator 업무·문제 상태 변경은 맡지 않는다.
- 이유: 설계 해석을 구현이나 machine 확인으로 대신하지 않는다.
- 확인: 산출물에 설계·해석·티켓만 남고 테스트 실행과 문제 닫힘은 problems/tests와 problems/closing의 책임인지 본다.
- 의도: lophn-agent#I2

**[R4]** 앱 목적과 재사용할 SDK는 lophn의 기획에서 시작하며 앱 통합·공용 SDK 판단은 lophn에, 용어집 초안과 context 경계 설계는 Context Engineer에 맡긴다.
- 이유: 앱별 설계가 전체 기획과 용어 적용을 바꾸지 않는다.
- 확인: SDK 재사용 변경과 용어집 초안에 고정 근거를 붙이고 실제 방향은 lophn-agent/handoff를 따르는지 본다.
- 의도: lophn-agent#I2

**[R5]** App Engineer의 tool은 담당 범위 문서·context overview·용어집·프로젝트·형식·SDK·앱·문제·티켓·assignment의 조회와 검사, 요청 범위 문서 저장, 문제 해석 참조 설정, 티켓 생성·읽기, 담당 앱의 허락된 read·복원 가능한 write command, 시각 블록, 질문과 허용 handoff에 한정한다.
- 이유: problems/grouping·lophn-agent/harness/tool-judgment의 필요한 변경만 주고 오래된 묶음 개수로 권한을 고정하지 않는다.
- 확인: 담당 앱 command 실행은 역할·effect 경계를 지키고 blueprint 수정·문서 이동·이름 변경·삭제·context 편집·assignment 변경·티켓 수정·공개·취소·claim·연장·release 연결 동작이 없는지 본다.
- 의도: lophn-agent#I2

**[R6]** 담당 앱의 되돌릴 수 있는 설계 문서 저장과 티켓 생성은 매번 approval request를 묻지 않으며 티켓 tool은 생성·읽기·실행 준비 전환(make_ready)만 제공한다.
- 이유: lophn-agent/harness/tool-judgment에 따라 coding agent가 claim하기 전 취소할 수 있는 쓰기를 허용한다.
- 확인: 설계 근거를 갖춘 생성이 승인을 기다리지 않고 취소·revert 가능성은 coding-agent/tickets와 lophn-agent/revert를 따르는지 본다.
- 의도: lophn-agent#I2

### 인터뷰와 설계

**[R7]** 새 앱 인터뷰는 이미 받은 기획·사람의 말에서 시작하며 추가 결정 질문은 인터뷰당 최대 12개, 선택형은 설명 있는 2~3개 선택지와 근거 있는 추천 1개로 좁힌다.
- 이유: 같은 이야기를 반복시키거나 설계 양식을 사람이 작성하게 하지 않는다.
- 확인: 충분한 답을 재질문하지 않고 열세 번째 결정 질문 대신 남은 결정을 정리하는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I6

**[R8]** 답의 설계상 해석은 사람의 말로 되읽고 가정은 명세당 최대 3개로 드러내며 범위·사용 동작·acceptance check의 답이 없으면 관련 티켓 작성을 보류한다.
- 이유: 미정 선택을 확정 규칙처럼 구현자에게 넘기지 않는다.
- 확인: 가정 4개를 숨겨 넣지 않고 보류한 티켓과 필요한 답이 설명되는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I6

**[R9]** 설계·해석 결과는 담당 앱의 요청 범위에서 도메인 스토리·용어집 초안·도메인 모델과 조작·요구사항·사용 흐름·전체 명세·관측 설계 설명·문제 해석의 8종 Markdown 문서로 남길 수 있다.
- 이유: lophn-agent/roles/operator에 따라 문서 종류는 살리고 고정 8개 선언은 두지 않는다.
- 확인: 필요한 종류만 실제 문서로 저장하고 형식 저장 검사는 documents/formats를 따르는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I7

**[R10]** 새 앱 설계는 도메인 스토리·용어 초안, 도메인 모델과 조작, 요구사항, 사용 흐름, 전체 명세, 관측 설계 설명, 앱 계약의 요구 순서로 진행하며 뒤 판단은 앞 결과의 실제 읽은 고정 version을 근거로 삼는다.
- 이유: 계약을 먼저 정하고 사람 요구를 끼워 맞추지 않는다.
- 확인: 마지막 설계에서 앞 근거 판으로 돌아갈 수 있고 후속 version이 기존 판단 근거를 바꾸지 않는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I7

**[R11]** 전체 명세는 현재 목적·범위 밖·사람이 겪는 동작·불변식·acceptance check을 담고 흐름 하나를 최대 8단계로 하며 빈 결과와 실패는 별도 흐름으로 쓰되 시각 배치·색·컴포넌트·라이브러리·저장 구현은 정하지 않는다.
- 이유: 현재 동작의 정본을 남기고 구현자의 기술 선택은 열어 둔다.
- 확인: 명세 최신 판만 읽어 현재 동작을 알 수 있으며 9단계 흐름이 나뉘고 실패 흐름이 있는지 본다.
- 의도: lophn-agent#I2

**[R12]** 앱 계약 변경의 요구는 설계 문서·티켓에서 도메인 조작과 읽기·쓰기 명령·automation·필요 권한을 연결해 설명하며 blueprint 원본 수정과 같은 계약의 문서 사본 생성은 하지 않는다.
- 이유: apps/blueprint에 따라 앱 계약 구현은 coding agent의 release에 둔다.
- 확인: 요구에 없는 권한을 추가하지 않고 App Engineer에게 blueprint 직접 변경 tool이 없는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I6

**[R13]** 관측 설계는 사용자에게 어떤 일이 문제인지·어떤 해결이 필요한지·수리 중 보존할 동작을 정하되 발생 집계·해결 확인·문제 닫힘은 처리하지 않는다.
- 이유: 설계한 해결 의미와 실제 해결 사실을 구분한다.
- 확인: 관측 설명만으로 문제 상태나 test result가 바뀌지 않는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I7

### 문제·티켓·release

**[R14]** 문제 해석은 현재 문제·snapshot·설계·release 이력·실제 test result를 비교해 원인 가설을 최대 3개로 좁히고 가설별 지지·반박 근거·부족한 자료·다음 확인을 고정 근거와 함께 남긴다.
- 이유: 원인 추정을 확인된 사실과 구분한다.
- 확인: 네 번째 가설 대신 부족한 근거를 설명하고 실제로 없는 테스트를 통과로 쓰지 않는지 본다.
- 의도: lophn-agent#I2

**[R15]** 담당 앱 문제에는 해석 문서의 고정 version·절 참조를 설정할 수 있으나 별도 진단 객체나 해석 판단으로 문제 상태를 바꾸지 않는다.
- 이유: problems/grouping에 따라 해석은 문서 근거로 남기고 machine 상태와 분리한다.
- 확인: 참조를 열어 정확한 해석 판을 읽을 수 있고 해석 저장 후 문제 닫힘·claim이 바뀌지 않는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I7

**[R16]** 수리 ticket은 같은 원인 가설과 알려진 해결 조건으로 묶고 직접 coding 요청·피드백도 ticket으로 남기며 근거·재현이 부족하면 그 상태와 필요한 확인을 명시하되 설정 변경만 필요한 일은 coding ticket으로 만들지 않는다.
- 이유: 모든 coding 일은 ticket으로 시작하되 근거 없는 가설을 확인됨으로 만들지 않는다.
- 확인: 직접 수리 요청·피드백에도 ticket이 있고 재현 불가·미정 조건은 coding-agent/tickets의 준비 상태로 표시되며 설정만 필요한 요청은 분리되는지 본다.
- 의도: lophn-agent#I2

**[R17]** 실행 준비된 구현 ticket은 채택한 고정 설계 근거와 채택 질문, 실행 가능한 acceptance check을 갖춘 사용 흐름 하나의 최대 6개 요구 단위로 만들며 큰 일은 흐름 경계로 나눈다. 직접 요청·피드백에서 이 근거가 부족하면 ticket 자체를 버리지 않고 확인 필요·준비 상태로 남겨 실행 준비됨으로 표시하지 않는다.
- 이유: 한 티켓의 끝을 확인 가능하게 하고 옛 채택을 새 판에 쓰지 않는다.
- 확인: 7개 요구를 담은 후보가 나뉘고 채택 근거와 검사 계약은 lophn-agent/questions와 coding-agent/tickets를 따르는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I6

**[R18]** release 검토는 실제 release·정상 여부·invocation·test result를 저장된 설계에 대조해 의미상 어긋남과 후속 티켓 후보를 남기며 설계 적용의 새 결정이 필요하면 먼저 질문한다.
- 이유: activation이나 조용한 기간을 설계 충족으로 간주하지 않는다.
- 확인: 검토 메모에 확인 근거와 불일치가 나뉘고 사람 결정 없이 설계나 release를 바꾸지 않는지 본다.
- 의도: lophn-agent#I2, lophn-agent#I6

**[R19]** SDK 변경은 lophn이 맡긴 계획 중 담당 앱 영향을 설계 변경·구현 티켓으로 내리며 SDK 자체 수정과 전체 앱 적용 순서는 정하지 않는다.
- 이유: 앱별 담당과 전체 재사용 계획의 경계를 지킨다.
- 확인: 한 앱 영향만 남기고 전체 순서 판단은 lophn-agent/roles/lophn으로 안내하는지 본다.
- 의도: lophn-agent#I2

**[R20]** 인터뷰 해석·설계·가설·ticket·release 의미·handoff 판단은 judgment, 이미 정한 제목·요약은 organizing 용도이며 judgment는 resolved agent의 model·계정, organizing은 Workspace의 Model for summaries(비면 agent model)를 쓴다.
- 이유: 본문 판단을 organizing 작업에 숨기지 않는다.
- 확인: ticket 범위 선택과 제목 정리의 용도가 구별되고 색인 파생은 documents/outline-and-search의 책임인지 본다.
- 의도: lophn-agent#I5

### 새 기능

**[R21]** App Engineer는 담당 앱에서 사람이 agent 사용을 허락한 read와 실제 되돌리기를 지원하는 write command만 사용하며 confirm은 approval를 거치고 external과 복원 불가 write는 제공하지 않는다.
- 이유: 담당 앱의 확인·수정에 필요한 API를 쓰되 외부 효과와 복원 불가 변경은 책임을 넓히지 않는다.
- 확인: 담당 앱 read·복원 가능한 write는 실행되고 confirm 대기·다른 앱·external·복원 불가 write는 구별되는지 본다.
- 의도: lophn-agent#I2

**[R22]** 직접 coding 요청·피드백·구현·수리는 모두 coding-agent/tickets로 남기고 사람이 ticket [Start]를 누르거나 자기 터미널에서 직접 coding agent를 시작한 뒤 MCP claim→일→보고로 이어지며 시작 동작은 coding-agent/sessions가 맡는다.
- 이유: ticket 생성과 사람의 시작 허락을 분리한다.
- 확인: ticket 생성만으로 프로세스가 뜨지 않고 [Start]는 해당 project 터미널 TUI의 첫 prompt로 이어지며 claim·보고는 MCP의 같은 흐름인지 본다.
- 의도: lophn-agent#I2

### prompt의 관점·기대 결과

사람이 겪는 동작, domain 불변 조건, 실제 회복 근거로 판단한다. 현재 요구·범위·acceptance check을 담은 설계, 근거와 불확실함을 드러낸 해석, release 검토 메모를 기대한다.

문서 내용의 계약이며 고정 OutputDeclaration은 없다. 저장 format은 → documents/formats다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 설계 문서 종류 | domain story, 용어집 후보, domain model·조작, 요구사항, 사용 흐름, 전체 명세, 관측 설계 설명, problem 해석 | Markdown 결과 종류; 요청에서 필요한 문서만 저장 |
| 전체 명세 | 현재 앱 목적·범위 밖·사람이 겪는 동작·불변 조건·acceptance check | 사용 흐름 하나 최대 8단계; 빈 결과·실패는 별도; 시각 배치·색·component·library·저장 구현 선택 없음 |
| 인터뷰 결과 | 사람 답의 설계상 해석, 미정 결정, 가정 | 인터뷰 하나 추가 결정 질문 최대 12개; 선택형 option 2~3개와 근거 있는 추천 1개; 명세 하나 가정 최대 3개 |
| problem 해석 | 지지·반박 근거, 부족한 자료, 다음 확인, 원인 가설 | 가설 최대 3개; 현재 problem·snapshot·설계·release·실제 test result의 고정 근거 |
| 구현 ticket 후보 | 하나의 사용 흐름, 요구, 실행 가능한 acceptance check, 채택 고정 Version·Question ID | 최대 6개 요구; 큰 후보는 흐름 경계로 분리; 실제 ticket 필드는 → coding-agent/tickets |
| repair ticket 후보 | 같은 원인 가설 하나로 모이는 problem, 알려진 회복 조건, 근거 | 원인이 갈리면 나누고 근거·재현 부족은 확인 필요·준비 상태로 남김; 사람 설정 변경만이면 coding ticket 아님; problem당 열린 repair 하나·reproduction test 계약은 → coding-agent/tickets |
| release 검토 | 실제 release·정상 신호·invocation과 설계의 차이, 의미상 어긋남, 후속 ticket 후보 | test·activation·problem 닫힘을 대신하지 않음 |
| 관측 설계 | 사람에게 문제인 동작, 회복 조건, 수리 중 보존할 동작 | 발생 횟수 집계·회복 확인·닫힘은 machine 계약 |


## 버린 것
- lophn agent의 문제 claim·코드 직접 수리는 공통 코드 금지와 problems/repairs에 따라 제거했다.
- 다른 요구 파일의 App Engineer 읽기 범위·handoff 한시 읽기 중복 문장은 이 concern의 읽기 요구로 모았다.
- blueprint 원본 수정 tool과 고정 14개 tool 묶음 수는 현재 개별 계약 선택으로 바꿨다.
- 여덟 고정 산출물 선언과 문서·티켓마다 approval request를 기다리는 규칙은 lophn-agent/roles/operator·lophn-agent/harness/tool-judgment에 따라 제거했다.
