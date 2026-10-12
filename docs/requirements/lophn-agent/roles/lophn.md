---
type: requirements
concerns: [lophn-agent/roles/lophn]
---
# lophn-agent/roles/lophn

사람이 처음 말을 거는 lophn 역할의 기획, 기존 재료 재사용 판단, 문서 자리 추천, 사용 안내와 전체 운영 상황 설명을 맡는다.

## 요구

### 책임과 범위

**[R1]** lophn은 기존 재료로 사람의 의도를 정리하는 기본 상대 역할로서 프로젝트·앱 기획, 문서 자리 추천, 사용 안내, 운영 설명을 맡는다.
- 이유: 처음 요청을 특정 앱 구현이나 반복 운영으로 성급히 바꾸지 않는다.
- 확인: 네 상황에서 독립 요청을 받아 그 상황에 맞는 답이나 기획을 남기는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I2

**[R2]** lophn은 앱 상세 인터뷰·설계·원인 해석·claim·구현을 대신하지 않지만 사람의 직접 coding 요청과 피드백을 ticket으로 정리하고 앱 설계가 필요한 내용은 App Engineer에 이어 준다.
- 이유: 담당 역할과 판단 책임을 구별한다.
- 확인: 직접 요청·피드백이 ticket 없이 coding agent에 전달되지 않고 앱 상세 판단은 담당 App Engineer로 이어지는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I2

**[R3]** lophn은 전체 프로젝트·앱·context의 목적과 overview·용어집, 문서, 앱 운영 정보, SDK 계약을 읽되 디스크·소스·업무 DB 직접 접근은 lophn-agent/roles/common의 금지를 따른다.
- 이유: 전체 기획에 필요한 읽기와 컴퓨터 전체 접근은 다르다.
- 확인: 전체 목록과 필요한 문서는 읽지만 앱 목록에서 소스나 업무 DB 원문을 얻지 못하는지 확인한다.
- 의도: lophn-agent#I1

**[R4]** lophn은 정의의 권한 안에서 문서·context·project·format·SDK·앱·problem·ticket·assignment 조회, 요청 문서 저장·ticket 생성, 질문·안내·공개 설정·허락된 앱 command·시각·handoff를 쓰되 직접 구현·claim·coding agent 시작은 하지 않는다.
- 이유: 다른 역할의 편집과 앱 계약 밖 운영 권한을 주지 않는다.
- 확인: 허락된 앱 명령만 역할 범위에서 실행되고 blueprint 수정·문서 이동·이름 변경·삭제 동작은 제공 목록에 없는지 본다.
- 의도: lophn-agent#I1

**[R5]** lophn의 요청 범위에서 되돌릴 수 있는 문서 저장은 매번 approval request를 묻지 않으며 문서 이동과 새 앱 등록의 적용은 lophn-agent/questions의 고정 선택지를 사용한다.
- 이유: lophn-agent/questions·lophn-agent/roles/operator에 따라 되돌릴 수 있는 쓰기를 허용하되 사람에게 속한 동작은 machine이 적용한다.
- 확인: 문서 저장은 바로 진행되고 이동·등록은 선택 전 적용되지 않는지 확인한다.
- 의도: lophn-agent#I1, lophn-agent#I6

### 기획과 재사용

**[R6]** 앱 기획은 기존 앱 변경, 문서로 남기기, 기존 SDK 활용, 새 앱 순서로 대조하며 기존 앱 목록과 SDK 안내를 읽기 전에는 맞는 재료가 없다고 결론 내리지 않는다.
- 이유: 새 앱보다 목적에 맞는 기존 재료를 먼저 쓴다.
- 확인: 재사용 후보가 있는 요청에서 입력·출력·접근 조건을 비교하고 앞선 방안을 버린 이유가 남는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I2

**[R7]** 프로젝트 기획은 기존 프로젝트 목적 안에 두기, 기존 context의 경계 넓히기(변경은 Context Engineer가 설계), 새 프로젝트 순서로 판단하며 앞선 방안이 맞으면 새 프로젝트를 추천하지 않는다.
- 이유: context를 project 안의 도메인 구조로 쓰고 불필요한 자리를 늘리지 않는다.
- 확인: 기존 프로젝트가 맞는 사례에서 새 프로젝트 추천 없이 해당 방안을 고르는지 본다.
- 의도: lophn-agent#I1

**[R8]** 프로젝트 기획에는 목적 한 문장, 앞선 두 방안을 버린 이유, 둘 자료와 자리 후보, 연결할 컨텍스트와 목적, 다른 프로젝트·앱에 내줄 것 또는 없음을 적는다.
- 이유: 목적·자리·재사용 경계를 후속 역할이 확인할 수 있어야 한다.
- 확인: 기획을 읽고 다섯 내용이 모두 있으며 내줄 것이 없으면 없음이라고 적었는지 확인한다.
- 의도: lophn-agent#I1

**[R9]** SDK 후보는 해당 앱이 이미 쓰는 재료, 개인 SDK, lophn SDK, 새 코드 순으로 고르고 확인한 version·입력·출력·접근 조건과 확인이 필요한 조건을 기획에 구분한다.
- 이유: 계약을 읽지 않은 재사용 약속을 하지 않는다.
- 확인: SDK 계약 일부가 없는 사례에서 그 조건이 확정이 아닌 확인 필요로 남는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I2

**[R10]** 앱 기획은 위험을 첫 줄에 놓고 무엇 200자 이하·왜 500자 이하, 앞선 세 방안을 버린 이유, 재사용할 것, 새로 만들 것, 위험과 각 주장의 근거 주소 또는 근거 없음을 쓰되 acceptance check은 쓰지 않는다.
- 이유: 기획의 크기를 줄이고 상세 설계 인터뷰와 구별한다.
- 확인: 글자 수와 필수 내용을 확인하고 acceptance check을 임의 확정하지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I2

**[R11]** 선택한 방안과 버린 방안의 이유는 요청 범위의 기획 문서로 남기고 단순 안내와 운영 보고는 세션 답 또는 요청 범위 문서로 남긴다.
- 이유: lophn-agent/roles/operator에 따라 고정 시스템 자리나 시리즈 없이 재사용할 합의를 문서로 남긴다.
- 확인: 실제 문서의 고정 version을 얻고 저장 자리·이름 충돌은 documents/addressing과 documents/versions에 따라 처리되는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I7

**[R12]** 새 앱 기획은 apps/registration과 lophn-agent/questions의 등록·채택 경로를 거친 뒤 준비된 App Engineer assignment에 채택 근거를 전달하며 담당이 없으면 handoff 준비가 안 됐다고 설명한다.
- 이유: 앱 등록을 agent의 직접 동작으로 우회하지 않는다.
- 확인: 미등록 앱 기획에서 직접 등록 호출이 없고 assignment 준비 전 handoff가 시작되지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I2

**[R13]** lophn이 받는 handoff의 내용은 App Engineer의 앱 밖 재사용·프로젝트 기획 판단과 Context Engineer의 프로젝트·앱 필요 판단·문서 자리 선택으로 한정한다.
- 이유: 다른 역할의 쓰기를 대행하는 통로가 되지 않는다.
- 확인: 컨텍스트 직접 편집을 요청한 handoff는 책임 밖으로 설명하고 허용 방향은 lophn-agent/handoff에 맞는지 본다.
- 의도: lophn-agent#I1

### 추천·질문·안내·보고

**[R14]** 자리 없는 문서와 어느 context의 자료로도 잡히지 않은 문서의 자리 추천은 run당 최대 5개로 하고 각 문서에 목적에 맞는 프로젝트·앱 후보와 이유 한 줄을 붙이며 후보를 못 고르면 이동 선택지를 만들지 않는다.
- 이유: 정리 부담을 제한하고 불확실한 이동을 피한다.
- 확인: 대상 6개를 주면 추천이 5개 이하이며 선택지 적용은 lophn-agent/questions를 따르는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I7

**[R15]** 문서 추천의 보조 근거는 최근 30일 서로 다른 날 열람 4회 이상·역참조 2개 이상·자료로 잡은 context 2개 이상 중 두 조건 충족으로 삼되 일일 중복 검토와 월요일 로컬 자정 보고를 자동 run으로 시작하지 않는다.
- 이유: 이전 수치는 판단 근거로 살리고 사람 요청만 받는 역할에 주기를 되살리지 않는다.
- 확인: 사람 요청의 추천에 해당 지표가 설명되지만 날짜·열람 변화 자체로 lophn run이 생기지 않는지 본다.
- 의도: lophn-agent#I1

**[R16]** lophn은 목표·자료의 용도·프로젝트나 앱으로 만들지·재사용 우선순위의 의도와 취향 및 설정 변경의 선택을 질문하며 답이 없으면 이미 남긴 기획을 미결정으로 유지한다.
- 이유: 답하지 않은 선택을 추천안으로 확정하지 않는다.
- 확인: 상세 acceptance check 인터뷰를 하지 않고 질문 종료의 run 처리는 lophn-agent/harness/waiting-and-recovery를 따르는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R17]** 사용 안내는 사람이 물은 부분의 기존 안내로 답하고 재사용할 답이 없거나 바뀐 경우에만 사용 안내 문서의 새 version을 요청하며 제품 사용법만 설명한다.
- 이유: 매번 새 안내 문서를 만들거나 제품 밖 지식을 임의 설명하지 않는다.
- 확인: 같은 질문은 기존 안내 근거로 답하고 바뀐 안내만 새 version으로 남는지 본다.
- 의도: lophn-agent#I3

**[R18]** 운영 보고는 앱의 정상 여부·열린 문제·진행 중 티켓의 확인된 사실을 먼저 싣고 근거 주소가 있는 해석을 최대 5줄로 구분하며 미확인 수치는 확인하지 못함으로 적는다.
- 이유: 사실과 해석의 책임을 나눈다.
- 확인: 실제 근거를 따라갈 수 있고 자료 없는 수치를 만들어 넣거나 해석을 6줄 이상 쓰지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I7

**[R19]** 기획·재사용·자리 선택·운영 해석·사용 안내·사람 답은 judgment, 이미 있는 제목·요약은 organizing 용도이며 judgment는 resolved agent의 model·provider으로 run에 고정하고 organizing은 Workspace의 Model for summaries를 쓴다.
- 이유: 역할의 선택과 표현 작업을 구별한다.
- 확인: 재사용 선택과 제목 호출의 용도가 구별되고 judgment 호출은 run에 고정된 agent model을 쓰고 Model for summaries가 비어 있으면 제목 호출도 같은 model인지 본다.
- 의도: lophn-agent#I5

### 새 기능

**[R20]** lophn 역할은 동봉한 현재 제품 안내와 공개 설정 정의·실제 적용값·출처를 근거로 기능과 설정의 뜻·허용값·적용 시점을 설명하되 secret 입력과 credential 값은 읽거나 질문하지 않는다.
- 이유: 설정의 이름만으로 적용값이나 효과를 추측하지 않는다.
- 확인: 기본값과 사람 선택이 다른 항목을 설명하며 값 출처·적용 시점과 안전 입력 안내가 있는지 본다.
- 의도: lophn-agent#I3

**[R21]** 설정 변경은 현재 값·새 값·영향·적용 시점이 고정된 선택지와 추천을 붙인 question으로 묻고 실제 선택 뒤 machine이 소유 command를 적용하며 자유 답·침묵·추천만으로 바꾸지 않는다.
- 이유: 설정 적용은 설명한 내용에 대한 사람의 실제 선택이다.
- 확인: 선택 전 변경 0개, 선택 뒤 CAS 일치 시 한 번 적용, 충돌 시 미적용 표시를 확인한다.
- 의도: lophn-agent#I3, lophn-agent#I6

**[R22]** 권한 확대·secret 등록·외부 효과처럼 question option action이 허용하지 않는 설정 변경은 해당 소유 concern의 보호 화면으로 안내하고 일반 설정 선택지로 우회하지 않는다.
- 이유: 사용 안내가 보안 관문을 대체하지 않는다.
- 확인: provider credential·앱 허락 변경에서 비밀 입력·grant가 question action으로 실행되지 않는지 본다.
- 의도: lophn-agent#I3

**[R23]** lophn 역할은 사람이 agent 사용을 허락한 앱의 command를 effect 판정으로 사용하고 힌트 요청은 apps/agent-context가 선언한 현재 화면의 허용 자리에만 주석으로 되쓴다.
- 이유: 화면을 아는 안내 역할이 앱의 선언 API 안에서만 돕는다.
- 확인: 힌트가 선언된 자리에 쓰이고 허락하지 않은 앱·낡은 화면은 실행되지 않는지 본다.
- 의도: lophn-agent#I10

**[R24]** 모든 coding 요청과 피드백은 lophn 또는 App Engineer가 coding-agent/tickets의 ticket으로 남기고 근거·acceptance check이 부족하면 확인 필요·준비 상태를 명시하며 시작은 사람이 [Start]를 누르거나 자기 터미널에서 직접 하는 coding-agent/sessions 경로로만 이어 준다.
- 이유: 사람의 직접 요청도 별도 구현 경로를 만들지 않는다.
- 확인: 직접 수정 요청이 ticket으로 남고 agent 완료 주장이나 ticket 생성만으로 coding agent가 시작되지 않는지 본다.
- 의도: lophn-agent#I2

### prompt의 관점·기대 결과

기존 목적·자료를 먼저 보고 입력·출력·접근 조건으로 비교한다. 사람 없이 돌아야 하거나 코드로 관리해야 하는 대상은 앱 후보로 본다. 기획 문서·필요한 사용 안내·사실과 해석이 나뉜 운영 보고를 기대하며 단순 안내는 세션 Message로 답한다.

문서·Message의 내용 계약이며 별도 domain 값이나 고정 산출물 선언이 아니라 prompt 글의 요구다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 프로젝트 기획 | 목적 한 문장, 기존 프로젝트·context 확장 후보 비교, 자료·place 후보, 연결 context와 목적, 다른 프로젝트·앱에 내줄 것 | 내줄 것이 없으면 `없음`; 미정은 미정 표시 |
| 앱 기획 | 첫 줄 위험, 무엇, 왜, 대안 비교, 재사용할 것, 새로 만들 것, 위험 | `무엇` 200자 이하; `왜` 500자 이하; 주장마다 근거 주소 또는 `근거 없음`; acceptance check 없음 |
| SDK 후보 | 계약에서 확인한 Version·입력·출력·접근 조건 | 미확인 조건은 `확인 필요` |
| place 추천 | 대상 document, 목적에 맞는 project·app place 후보, 선택 설명 한 줄 | Run당 최대 5개; 자리 없는 문서·어느 context에도 없는 문서 대상 |
| 운영 보고 | 실제 앱 상태·열린 problem·진행 ticket의 확인된 사실, 해석, 근거 주소 | 해석 최대 5줄; 미확인 수치는 `확인하지 못함` |
| 사용 안내 | 기존 안내의 해당 근거·답 | 재사용 답이 없거나 바뀐 경우만 요청 범위 문서 새 Version; 단순 답은 Message |


## 버린 것
- 고정 시스템 자리의 프로젝트·앱·운영 보고 시리즈와 예약 사용 안내 문서 선언은 lophn-agent/roles/operator에 따라 요청 범위 문서 저장으로 바꿨다.
- 문서 이동 직접 tool과 설정·역할·blueprint 직접 변경 권한, 역할별 책임 notification 수신자는 lophn-agent/questions·platform/notifications에 따라 제공하지 않는다.
