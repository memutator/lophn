---
type: requirements
concerns: [lophn-agent/roles/operator]
---
# lophn-agent/roles/operator

assignment된 컨텍스트 하나에서 정해진 반복 판단을 수행하고 승인한 기존 문서에 결과를 축적하는 Operator의 책임·읽기·tool·본문 판단을 맡는다.

## 요구

### 책임과 범위

**[R1]** Operator는 컨텍스트 하나의 반복 판단과 결과 축적을 맡으며 구체적 책임마다 반복할 판단·필요 근거·갱신 조건을 명시하고 주기 또는 그 assignment에 대한 사람 요청으로만 일한다.
- 이유: 반복 모델 판단과 임의 앱 작업을 구분한다.
- 확인: 정의의 이름·목적·사용 상황이 맡을 판단을 드러내고 다른 계기로 run이 생기지 않는지 확인한다.
- 의도: lophn-agent/roles#I5

**[R2]** 실행할 Operator는 내장 원본을 덮어쓰지 않는 승인된 구체적 정의를 사용하며 재사용과 실제 대상 결합은 lophn-agent/role-definition과 lophn-agent/assignments를 따른다.
- 이유: 책임 정의와 실제 컨텍스트·쓰기를 분리한다.
- 확인: 구체적 Operator가 독립 run으로만 쓰이고 승인 전 실행할 assignment가 생기지 않는지 본다.
- 의도: lophn-agent/roles#I5

**[R3]** Operator는 기획·앱 설계·수리 티켓·코드, 컨텍스트 목적·항목·용어·색인 변경, 자기 역할·assignment 변경과 개별 앱 작업의 판단 담당을 겸하지 않는다.
- 이유: 여러 앱을 읽어도 반복 책임 밖의 변경은 하지 않는다.
- 확인: 여러 앱 자료를 함께 판단한 문서만 남고 프로젝트·SDK·문제·티켓·역할·assignment 관리 tool이 제공되지 않는지 본다.
- 의도: lophn-agent/roles#I5, lophn-agent/roles#I1

**[R4]** Operator는 assignment의 컨텍스트 하나의 자료와 승인된 앱별 읽기 명령 결과만 읽어 목적·용어·기준·참고·watch 관점, 정의한 비교 기준과 변화의 의미에 따라 판단한다.
- 이유: 컨텍스트 항목이나 자료 속 주소가 승인 범위를 넓히지 않는다.
- 확인: 다른 컨텍스트와 미승인 명령은 읽지 못하고 남길 문서 읽기 예외는 lophn-agent/assignments를 따르는지 본다.
- 의도: lophn-agent/roles#I5

**[R5]** Operator의 tool은 담당 자료의 목차·검색·고정 판·절·범위·이력·차이, 남길 문서 읽기·형식 검사·새 version 저장, 질문과 승인한 정확한 앱별 읽기 명령 호출만 선택한다.
- 이유: apps/blueprint·lophn-agent/roles/operator에 따라 명령 이름만 같거나 컨텍스트에 있다는 이유로 실행시키지 않는다.
- 확인: 선택된 앱·명령 쌍의 현재 효과가 읽기인지 검사하고 쓰기·확인 필요·외부 효과 명령과 새 문서 생성은 거절되는지 본다.
- 의도: lophn-agent/roles#I5

### 결과 갱신과 사람 요청

**[R6]** 결과는 확인한 사실·판단·불확실함을 구분해 승인한 문서에 필요한 만큼 남기고 갱신 조건을 충족하지 않으면 근거와 함께 변화 없음으로 끝내며 새 version을 만들지 않는다.
- 이유: 무변화는 실패가 아니고 같은 내용을 형식상 덧쌓지 않는다.
- 확인: 변화 없는 회차에서 문서 수가 0이고 정상 완료로 남으며 다른 회차는 승인 문서 수 안에서 여러 결과를 저장할 수 있는지 본다.
- 의도: lophn-agent/roles#I5, lophn-agent/roles#I1

**[R7]** 승인한 기존 문서의 새 version은 회차마다 approval request를 다시 묻지 않되 문서 자리·형식을 바꾸거나 선언 밖 문서에 쓰는 것은 허용하지 않는다.
- 이유: lophn-agent/roles/operator에 따라 assignment 승인으로 범위를 고정한다.
- 확인: 남길 문서 저장은 진행되지만 다른 문서 저장은 approval request로 우회하지 않고 거절되는지 본다.
- 의도: lophn-agent/roles#I5

**[R8]** 사람은 Operator assignment를 직접 선택해 결과 해석·수정과 필요한 의도·취향을 이야기할 수 있지만 그 답으로 정의·범위·주기·tool을 바꾸지 않으며 오래 남길 답은 승인한 문서의 새 version으로만 남긴다.
- 이유: 업무 답과 반복 책임 변경 승인을 구분한다.
- 확인: 사람 답 후 변경은 문서 결과뿐이고 정의 변경은 lophn-agent/assignments의 별도 전체 승인을 요구하는지 본다.
- 의도: lophn-agent/roles#I5

**[R9]** 해석·판단·결과 본문은 judgment slot을 쓰고 제목·이미 있는 내용의 요약은 organizing slot을 쓰며 구체적 Operator에도 별도 provider·model 덮어쓰기를 두지 않는다.
- 이유: lophn-agent/harness/model의 공통 설정과 내용 판단 책임을 유지한다.
- 확인: 본문과 제목 호출의 slot을 확인하고 공통 model 변경이 다음 run부터 적용되는지 본다.
- 의도: lophn-agent/roles#I5, lophn-agent/harness#I1

**[R10]** Operator의 반복 실패와 대기 중 회차 처리는 lophn-agent/assignments와 lophn-agent/scheduling을 따르며 실패를 무시하고 계속하는 선택이나 handoff 송수신은 없다.
- 이유: 멈춘 반복 책임이 다른 계기로 자동 재개되지 않게 한다.
- 확인: 중단 후 새 회차와 handoff가 시작되지 않고 사람 직접 요청은 현재 assignment 상태 검사에 따르는지 본다.
- 의도: lophn-agent/roles#I5, lophn-agent#I2

## 열린 질문
- lophn-agent/roles/operator#Q1 구체적 Operator에 외부 MCP tool 선택을 허용할까.
- lophn-agent/roles/operator#Q2 구체적 Operator에 등록한 반복 절차 skill 선택을 허용할까.

## 버린 것
- 앱 업무 단계의 판단 담당·부재 처리까지 Operator가 겸하는 계약은 반복 판단 문서 책임과 맞지 않아 제거했다.
- run당 결과 최대 1개·시리즈 새 문서·문서 동적 이름은 lophn-agent/roles/operator에 따라 승인한 실제 문서의 필요한 새 version으로 바꿨다.
- 앱 쓰기·외부 효과 호출과 선언 밖 쓰기를 approval request로 허용하는 경로, provider·model 덮어쓰기는 apps/blueprint·lophn-agent/harness/model으로 제거했다.
