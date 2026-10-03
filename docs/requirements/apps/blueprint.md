---
type: requirements
concerns: [apps/blueprint]
---
# apps/blueprint

앱의 실제 화면·command·automation·필요 접근·문서·problem code·고정 SDK를 사람이 읽을 수 있게 선언하고 검증한다; permission 강제는 apps/permissions, problem code의 세부 규칙은 problems/problem-codes, automation 정책은 apps/automations가 맡는다.

## 요구

### 앱 설명과 선언

**[R1]** blueprint는 앱 이름·한 줄 설명·화면·command·automation·permission과 이유·problem code·남길 문서·정확한 SDK 의존을 빠짐없이 선언하되 없는 화면과 automation을 억지로 만들지 않는다.
- 이유: 실행에 쓰는 작은 계약만 유지하고 앱의 목적과 접근을 읽을 수 있게 한다.
- 확인: 화면 없는 앱의 빈 화면 목록을 허용하고 누락·중복·모르는 선언은 거절한다.

**[R2]** 사람은 내부 표나 SQL을 읽지 않고 화면과 command의 설명에서 결과·시작 위치·선택·예시·정보 종류·보존 의미·제약과 automation을 끄는 방법을 알 수 있다.
- 이유: 함수 이름에서 목적을 추측하거나 LLM이 설명을 만들어야 앱을 쓰는 일이 없어야 한다.
- 확인: 앱 설명만 읽은 사람이 사용할 화면과 command 및 자료가 없을 때 결과의 의미를 설명한다.

**[R3]** blueprint의 설명·구조 검증·실제 테스트 통과를 서로 다른 근거로 표시한다.
- 이유: 설명이 완성됐거나 타입이 맞는 것만으로 업무가 정상이라고 주장하지 않는다.
- 확인: 설명만 작성된 앱에 실제 테스트 성공 표시가 붙지 않는다.

### command

**[R4]** command는 read·write·external 중 효과 하나와 그 효과와 독립적인 사람 확인 여부를 선언한다.
- 이유: apps/blueprint·apps/invocations에 따라 external 자체를 approval로 해석하지 않는다.
- 확인: external이지만 확인 불필요인 command가 추가 approval 없이 호출되고 확인 필수 command는 apps/invocations를 따른다.

**[R5]** 복합 효과는 external·write·read 순서로 가장 큰 효과를 선언한다. external은 앱 밖의 상태를 바꾸는 것(메일·메시지 보내기, 결제, 외부 서비스에 만들기·고치기·지우기)이고, 바깥에서 가져오기만 하는 요청은 external이 아니다. 가져오기만 하면 read, 가져온 것을 업무 데이터에 저장하면 write다.
- 이유: 사람이 신경 쓰는 것은 바깥에 남는 효과다. 동기화·조회까지 external로 묶으면 automation과 agent의 조회가 막힌다.
- 확인: Google Calendar 일정 조회는 read, 가져와 저장하는 동기화는 write, 외부 캘린더에 일정을 만드는 command는 external이며 read 호출 전후 업무 데이터와 외부 대상은 같다.
- 의도: apps#I5

**[R6]** secret 사용 여부로 confirm을 정하지 않고 confirm은 command가 하는 일의 무게로 선언한다.
- 이유: secret 사용 허락은 apps/permissions의 grant이고 호출마다 다시 묻지 않는다.
- 확인: secret을 쓰는 read·write command를 confirm=false로 선언할 수 있고 사용 조건은 apps/permissions에서 확인한다.
- 의도: apps#I7

**[R7]** command 선언의 효과와 확인 여부는 호출자가 보낸 주장이 아니라 고정 blueprint에서 읽으며 입력은 검증·기본값 적용·정규화한 뒤 정확한 입력 기준으로 사용한다.
- 이유: 확인한 입력과 실행한 입력이 달라지는 것을 막는다.
- 확인: 호출자가 read라고 주장해도 write 선언이 적용되고 생략한 기본값과 명시한 기본값은 같은 확인 대상으로 판정된다.

**[R8]** 선언한 command의 구현 목록은 실제 등록 목록과 정확히 일치해야 하며 미선언 command와 일치하지 않는 구현은 app test와 시작 검사에서 거절한다.
- 이유: 선언과 실제 호출 표면을 맞춘다.
- 확인: 구현 누락·추가가 있는 앱을 app test하면 실패하며 시작도 실패한다; 검사 실행은 problems/tests와 apps/runtime을 따른다.

**[R9]** 효과 선언을 실제 코드의 안전성 증명으로 취급하지 않고 apps/permissions와 problems/tests로 뒷받침한다.
- 이유: 선언한 read가 실제 쓰기를 하지 않는지는 선언만으로 알 수 없다.
- 확인: 실제 접근 제한과 업무 효과 테스트를 별도로 수행한다.

### 입력과 값

**[R10]** command 입력은 의존성 없는 JSON Schema 부분집합의 object·array·string·integer·number·boolean·null과 enum·선택 값·기본값·길이·수 범위만 지원한다.
- 이유: 같은 입력을 결정적으로 검사하고 과한 schema 실행기를 피한다.
- 확인: 필수 값 누락·타입 오류·미선언 속성·길이와 수 범위 위반을 거절하고 기본값을 채운다.

**[R11]** 외부 schema 참조·union schema·사용자 정의 format·실행 코드와 모르는 schema keyword는 거절한다.
- 이유: 검사 때 네트워크와 앱 코드를 실행하지 않는다.
- 확인: 원격 참조와 지원 밖 keyword가 있는 schema를 조용히 허용하지 않는다.

**[R12]** 큰 파일·이미지·문서 내용은 본문 JSON을 복제하지 않고 고정 version 또는 blob 참조로 전달하며 열 때 읽기 권한을 검사한다.
- 이유: 큰 내용의 반복 전달과 주소만으로 범위가 열리는 일을 막는다.
- 확인: 권한 없는 호출자가 참조를 알아도 내용을 얻지 못한다; 보관은 platform/blob-store를 따른다.

### 문서와 참조

**[R13]** blueprint의 남길 문서는 자기 앱 place의 목적·이름·설명·format을 선언하고 같은 선언을 다시 저장할 때 같은 문서의 새 version으로 이어진다.
- 이유: 다른 문서의 덮어쓰기와 매번 새 문서 생성을 막는다.
- 확인: 같은 보고서 선언으로 두 번 저장하면 같은 문서에 version이 쌓이며 다른 앱 place의 문서 참조는 거절한다; 저장은 documents/versions와 apps/permissions를 따른다.

**[R14]** automation은 같은 blueprint의 command와 검증된 고정 입력을 참조하고 그 command의 구현을 직접 호출과 공유한다.
- 이유: 버튼과 반복 동작의 구현이 갈라지지 않는다.
- 확인: 같은 입력으로 직접 호출과 automation을 실행해 같은 구현이 동작하는지 확인한다; 계기와 제한은 apps/automations를 따른다.

**[R15]** 화면과 command의 식별은 표시 이름·번역 변경과 분리하고 과거 호출은 당시 release의 선언으로 읽는다.
- 이유: 이름만 바뀌어도 과거 의미를 잃지 않게 한다.
- 확인: 이름을 바꾼 새 release 뒤에도 과거 호출의 설명과 대상은 당시 선언으로 조회된다.

### 작성과 검증

**[R16]** 작성 편의형과 SDK 검증기는 의존성 없는 하나의 정식 schema를 사용하며 runtime 검증과 blueprint 조회는 LLM·외부 네트워크 없이 동작한다.
- 이유: 계약 복사본의 불일치와 비결정적 조회를 피한다.
- 확인: 네트워크와 모델을 끈 상태에서 작성·검증·조회 결과가 같다.

**[R17]** TypeScript blueprint 값 추출은 core·supervisor 밖 권한 없는 Deno 프로세스에서 최대 10초 수행하고 release에는 정규 JSON을 고정한다.
- 이유: 앱 작성 코드를 플랫폼 신뢰 프로세스에 import하지 않는다.
- 확인: 파일·네트워크 접근과 무한 반복을 하는 작성형이 거절되거나 10초 안에 중단된다.

**[R18]** 정규 JSON은 목록과 object의 이름 순서를 고정하고 중복은 제거하지 않고 거절하며 옛 context 선언을 포함한 모르는 blueprint 항목은 오류로 거절한다.
- 이유: 입력의 조용한 보정과 과거 구조의 숨은 호환을 두지 않는다.
- 확인: 순서만 다른 작성형은 같은 정규 값이 되고 중복과 옛 context 항목은 수정할 이유와 함께 거절된다.

### 화면 크기와 공용 호출 계약

**[R19]** 화면은 전체·패널·카드 중 실제 제공하는 크기를 하나 이상 선언하고 패널과 카드는 그 크기로 만들고 테스트한 화면만 제공한다.
- 이유: 전체 화면을 억지로 줄여 탭과 세션에 넣지 않는다.
- 확인: 전체만 선언한 화면은 패널·카드로 열리지 않고 패널·카드 선언 화면은 각각 좁은 영역에서도 읽기와 조작이 가능하다.
- 의도: apps#I10

**[R20]** command의 이름·설명·입력 형식은 model이 사용할 목적·입력 뜻·결과와 부작용을 이해할 만큼 작성하며 같은 선언에서 agent tool 정의를 만들 수 있어야 한다.
- 이유: MCP server와 별도 tool 설명을 작성하지 않아도 같은 API를 쓴다.
- 확인: blueprint만으로 만든 tool 목록에서 command의 목적·필수 입력·효과·확인 여부를 찾고 별도 MCP 없이 호출한다.
- 의도: apps#I11

**[R21]** 모든 command는 되돌리기 지원 여부를 명시하고 지원하는 write command는 같은 앱의 되돌림 command와 변경에 묶인 되돌림 자료를 반환하는 계약을 선언한다.
- 이유: write의 즉시 실행 판단이 설명만의 되돌릴 수 있다는 주장에 기대지 않는다.
- 확인: 지원 선언이 빠지거나 되돌림 command가 없는 선언은 거절되고 실제 변경 뒤 되돌림 테스트가 원래 업무 상태를 확인한다.
- 의도: apps#I11

**[R22]** 다른 앱 command 사용과 화면 context 선언은 각각 apps/connections·apps/agent-context의 현재 계약을 blueprint에 포함하고 옛 context 형식과 구별해 검증한다.
- 이유: 공용 command 계약에 필요한 선언을 고정 release와 함께 남긴다.
- 확인: 대상 앱·command·주석 자리가 잘못된 새 선언은 거절되고 과거 context 형식을 새 선언으로 조용히 바꾸지 않는다.
- 의도: apps#I12

## 열린 질문

- apps/blueprint#Q1 출력·오류 schema와 opaque JSON 계약을 이번 작은 command 모델에도 추가할까?
- apps/blueprint#Q2 tagged union·nullable 조합과 입력 줄임 문법을 어디까지 지원할까?
- apps/blueprint#Q3 blueprint 작성형은 TypeScript만 받을까 선언형 YAML도 받을까?

## 버린 것

- 바깥 요청이 있는 command를 모두 external로 보는 정의와 secret 사용 command의 confirm 필수 — 가져오기·동기화와 grant된 secret 사용을 막아 버린다(R5, R6).

- 내부 table 쓰기 목록과 모든 함수·SQL·resource를 등록하는 모델은 실제 command 계약에 필요 없어 제거한다.
- Feature·Scenario·Expectation·Resource·Operation·Binding·Integration의 독립 계층과 관계 그래프·public API 탐색 화면·정규 ReadModel은 좁은 화면·command 모델과 apps/blueprint로 대체한다.
- serial group과 별도 저장·관측·공개 policy 모델 및 여러 revision 축은 실제 첫 판 호출에 필요하지 않아 제거한다.
- Home과 blueprint 옛 version 자동 migration·adapter·problems 누락 허용은 처음부터 재구축하는 현재 계약에 없어 지원하지 않는다; SDK pin 불변 약속은 apps/sdk가 맡는다.
- MaHas 예제의 집계 기능·API 이름과 삭제한 모델의 fixture 전환 gate는 플랫폼의 확정 지원 기능으로 옮기지 않는다.
- 앱 사이 reads 간선·PublicInterface·export·consumer 계약 모델은 그대로 되살리지 않으며 연결 지원 여부는 apps/runtime의 열린 질문으로 남긴다.
