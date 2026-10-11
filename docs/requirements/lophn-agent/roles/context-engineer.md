---
type: requirements
concerns: [lophn-agent/roles/context-engineer]
---
# lophn-agent/roles/context-engineer

project 문서 위의 context(결정적 계약과 선언한 검색)의 경계를 설계하고 계약·검색·예시·용어집·saved view를 짜서 판으로 제출하며, 계약 위반을 넘겨받아 고치는 Context Engineer를 맡는다. 계약과 검색의 모양·검사·적용은 documents/contexts, 용어집의 모양은 documents/terms가 맡는다.

## 요구

### 책임과 범위

**[R1]** Context Engineer는 전체에 하나이며 사람 요청, 허용 handoff, 사람이 위반 목록에서 넘긴 일로만 일하고 세션을 연 project 안의 context를 설계하거나 고친다.
- 이유: 여러 project의 context 설계 방식이 한 손에서 맞춰져야 하고 project마다 따로 역할을 두면 설계가 갈린다.
- 확인: 두 project에서 연 세션이 같은 하나의 Context Engineer assignment를 쓰고, 세션을 연 project 밖의 context는 바꾸지 않으며, 파일이 바뀐 것만으로 run이 생기지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I4

**[R2]** context의 경계를 긋는 것(추상화)이 Context Engineer의 핵심 책임이며, 한 context는 안의 type끼리 단단히 뭉치고 다른 context와는 public으로 표시한 type·field로만, 그것도 가능한 한 적게 잇는다.
- 이유: 경계가 흐리면 context끼리 서로의 안쪽을 알아야 해서 하나를 고칠 때 다른 것이 깨진다. 안쪽을 바꿔도 내놓은 부분이 그대로면 다른 context가 깨지지 않아야 한다.
- 확인: 두 context를 설계한 결과에서 서로 가리키는 것이 public으로 표시된 type·field뿐이고, 가리키는 이유가 보고에 있으며, 안쪽 type을 가리키려는 설계는 documents/contexts의 검사에서 걸리는지 본다.
- 의도: lophn-agent#I1

**[R3]** Context Engineer는 계약에 type(도메인 개체)·자료 위치 kind 일곱(folder·docs·series·index·section·outline·app-data)·field·type 사이 관계·검사 규칙·public 또는 private 표시를 쓰고, 자기 project의 문서와 앱의 read command만 자료로 가리킨다.
- 이유: 사람이 파일을 직접 찾지 않아도 agent와 program이 같은 도메인 모델로 찾게 하는 것이 context의 목적이다.
- 확인: 예시 project의 문서 묶음에서 개체 type 둘 이상과 그 관계가 계약으로 남고, 다른 project의 문서나 앱의 write command를 자료로 쓰려는 계약은 제출 검사에서 거절되는지 본다. 각 kind의 뜻은 documents/contexts를 따른다.
- 의도: lophn-agent#I1

**[R4]** Context Engineer는 계약을 따르는 검색을 선언으로 쓴다. 검색마다 이름·입력과 입력의 종류·결과 보기를 정하고, 그 검색이 맞게 도는지 보여 주는 예시(입력과 기대 결과) 하나 이상을 붙인다.
- 이유: 검색어 일치만 하는 칸으로는 도메인 지식을 쓸 수 없다. 예시가 있어야 계약이 바뀌어도 검색이 깨졌는지 program이 알 수 있다.
- 확인: 검색 선언 하나에 입력 종류와 예시가 있고, 예시가 없거나 기대 결과와 다르면 제출 검사가 실패해 그 판이 적용되지 않는지 본다. 선언의 모양과 첫 판의 표현 범위는 documents/contexts#Q10을 따른다.
- 의도: lophn-agent#I1

**[R5]** Context Engineer가 쓰는 계약과 검색은 선언이며, 임의 code·shell·파일 쓰기나 앱 write command 실행 tool은 주지 않는다.
- 이유: 선언만 쓰면 program이 결정적으로 검사하고 같은 입력에 같은 결과를 내며, context 설계가 코드 작성 권한으로 번지지 않는다.
- 확인: Context Engineer의 tool 목록에 code 실행·shell·파일 쓰기·앱 command 실행이 없고, 계약과 검색은 선언 말고는 쓸 방법이 없는지 본다.
- 의도: lophn-agent#I1

**[R6]** Context Engineer는 모델 입력 조립·cache·대화 압축, 앱 기획·설계·코드·수리·티켓, 앱 command 실행, Operator 업무 대행, 원본 문서의 이동·이름 변경·삭제와 내용 수정을 하지 않는다.
- 이유: context 설계를 구현이나 원본 변경과 구분하고, 계약을 어긴 문서는 계약을 고칠지 문서를 고칠지 사람이 정하게 한다.
- 확인: 책임 밖 요청은 해당 concern으로 안내하고 해당 변경 tool이 제공되지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

### 설계 흐름

**[R7]** 읽기는 context의 계약·초안·검색·위반·용어집과 project 문서의 목록·목차·검색에서 시작해 이번 설계에 필요한 문서의 section·범위만 펼쳐 읽는다.
- 이유: 경계를 정하려고 모든 본문을 먼저 읽을 필요는 없다.
- 확인: 여러 문서 요청에서 목록·목차·검색 뒤 필요한 부분만 읽고, 읽은 근거가 파일 경로와 section으로 남는지 본다.
- 의도: lophn-agent#I1

**[R8]** 설계는 초안으로 쓰고, 미리보기로 지금 project 파일에서 개체를 뽑아 계약 위반을 먼저 확인한 뒤 판으로 제출하며, 제출한 판의 check 결과와 위반을 보고 실패하면 고쳐 다시 제출한다.
- 이유: 쓰는 동안 Operator가 쓰던 지금 판은 그대로 있어야 하고, 망가진 판은 적용되기 전에 걸러져야 한다.
- 확인: 초안을 쓰고 미리보기하는 동안 적용된 판과 파일이 그대로이고, 제출한 판이 검사에 실패하면 적용되지 않으며 Context Engineer가 실패한 항목을 읽어 다시 제출하는지 본다. 검사 항목과 통과한 판의 적용은 documents/contexts를 따른다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R9]** 사람이 위반 목록에서 한 번의 단추로 넘긴 일은 어느 문서가 어느 규칙을 어겼는지 근거가 붙은 채 Context Engineer run으로 시작하고, Context Engineer는 위반을 계약을 고쳐야 하는 것과 문서가 틀린 것으로 나눠 보고한다.
- 이유: 사람이 설명을 쓰거나 대화를 새로 열 필요 없이 위반이 설계 개선으로 이어져야 한다. 문서는 사람과 외부 도구가 마음대로 고치므로 위반은 늘 생긴다.
- 확인: 위반 하나를 넘기면 사람이 입력한 것 없이 해당 위반의 문서 경로·규칙·최근 값이 run에 있고, 보고가 계약을 고칠 것과 문서를 고칠 것을 구별하며 문서를 직접 고치지 않는지 본다. 넘기는 화면은 shell, 위반 감지와 알림은 documents/contexts를 따른다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R10]** 경계·용어의 뜻·계약 위반의 처리 방향처럼 사람의 결정이 필요하면 선택지와 근거를 질문하며 답이 없으면 관련 변경을 제출하지 않고 보고에 미정으로 남긴다.
- 이유: 사람 뜻의 부재를 추천 수락으로 간주하지 않는다.
- 확인: 미답 내용이 계약이나 용어집에 적용되지 않고 질문 종료의 run 처리는 lophn-agent/harness/waiting-and-recovery를 따르는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

### 용어집과 saved view

**[R11]** Context Engineer는 사람과 함께 context마다 용어집 초안을 쓰고 고치며, 용어집은 agent가 사람의 말을 알아듣게 하는 자료이고 계약과 따로 둔다.
- 이유: 도메인 개체의 뜻을 사람이 쓰는 말로 알려 주어야 agent가 같은 말을 다른 개체로 읽지 않는다. 검색은 계약이 맡으므로 용어집이 검색을 대신하지 않는다.
- 확인: 용어집 항목이 용어·뜻·정한 사람(사람 또는 Context Engineer)을 갖고, 용어집을 고쳐도 계약의 검색 결과가 바뀌지 않는지 본다. 용어집의 모양은 documents/terms를 따른다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R12]** 같은 말이 context마다 다른 뜻으로 쓰이면 충돌로 구분해 보고하고, 어느 쪽 뜻을 쓸지 정하는 기획 판단은 사람에게 묻거나 lophn에 맡긴다.
- 이유: 용어를 자동으로 합쳐 뜻을 바꾸지 않는다.
- 확인: 두 context의 같은 말 다른 뜻이 보고에 충돌로 남고 한쪽 용어집이 말없이 바뀌지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R13]** Context Engineer는 사람이 자주 쓸 검색의 입력을 채워 이름 붙인 saved view를 초안으로 둘 수 있고, saved view는 그 context의 검색 선언과 함께 제출 검사를 받는다.
- 이유: saved view는 검색 호출을 저장한 것이라 계약이 바뀌면 같이 깨질 수 있다.
- 확인: 검색 입력을 바꿔 깨뜨린 판이 saved view 검사에서도 걸리는지 본다. saved view의 모양은 documents/outline-and-search를 따른다.
- 의도: lophn-agent#I1

### tool

**[R14]** 읽기 tool은 project 문서의 목록·목차·검색·section·범위, context의 계약·초안·위반·용어집·검색 결과, 형식 규칙, 프로젝트·역할·assignment 조회, 앱 blueprint의 command 이름·설명·입력·효과 조회만 선택한다.
- 이유: app-data kind를 정하려면 앱 read command의 모양을 알아야 하지만 command 실행 권한은 받지 않는다.
- 확인: 앱 command metadata는 읽히지만 호출은 제공 목록에 없는지 본다. tool 이름과 입력은 lophn-agent/harness/tools를 따른다.
- 의도: lophn-agent#I1

**[R15]** 쓰기 tool은 context 초안(계약·검색·예시·용어집·saved view) 쓰기와 미리보기, 판 제출, 요청 범위 설계 보고 저장, 질문과 허용 handoff만 제공한다.
- 이유: 초안과 제출은 판을 적용하는 것이 아니고 적용은 검사를 통과한 뒤에 정해지므로 매번 사람에게 묻지 않는다. 그러나 agent 정의 저장·assignment 변경과 권한 예외는 두지 않는다.
- 확인: 초안·미리보기·제출은 매번 묻지 않고 제출한 판의 적용은 documents/contexts를 따르고 정의·assignment를 바꾸는 tool이 없는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

### 설계 보고

**[R16]** 설계 보고는 요청 범위 문서에 context별 목적·경계(맡는 개체와 맡지 않는 일)·public으로 내놓는 것·다른 context를 가리키는 곳과 이유·제출한 판의 check 결과·남은 위반·미정 용어를 적는다.
- 이유: 고정 보고 자리 없이 설계의 이유와 남은 일을 읽을 수 있어야 한다.
- 확인: 보고의 일곱 부분이 있고 미정 용어가 확정 용어에 섞이지 않으며, 확정 용어는 용어집과 같은지 본다.
- 의도: lophn-agent#I1, lophn-agent#I7

### model 선택

**[R20]** 경계·계약·검색·용어 해석은 judgment 용도, 이미 정한 보고의 제목·요약은 organizing 용도로 분리하고 judgment는 resolved agent의 model·계정, organizing은 Workspace의 Model for summaries(비면 agent model)를 쓴다.
- 이유: 경계나 용어 뜻을 단순 정리 호출로 만들지 않는다.
- 확인: 본문과 정리의 용도가 기록되고 judgment 호출이 run에 고정된 agent의 provider·model·계정으로 가고 제목·요약 호출이 Model for summaries(비면 같은 model)로 가는지 본다.
- 의도: lophn-agent#I5

### prompt의 관점·기대 결과

context의 경계를 먼저 생각하고, 계약은 declarative하게 쓰며, 사람이 정한 뜻과 Context Engineer가 쓴 초안을 섞지 않는다. 경계의 이유가 있는 설계 보고, 예시가 붙은 검색, 검사를 통과한 판, 근거가 붙은 위반 처리 보고를 기대한다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| context 설계 보고 | context별 목적·경계·public로 내놓는 것·다른 context를 가리키는 곳과 이유·check 결과·남은 위반·미정 용어 | 가리키는 곳은 public type·field만; 값 정의는 → documents/contexts |
| 계약 초안 | type·kind·field·관계·검사 규칙·public 표시 | 자기 project 문서와 앱 read command만; 선언만 |
| 검색 선언 | 이름·입력과 입력 종류·결과 보기·예시 | 예시가 하나 이상; 같은 입력에 같은 결과 |
| 용어집 항목 | 용어·뜻·정한 사람 | 사람이 정하지 않은 뜻은 Context Engineer가 정한 것으로 표시; 미답 뜻은 확정하지 않음; → documents/terms |
| 위반 처리 보고 | 위반별 문서 경로·규칙, 계약을 고칠 것 또는 문서를 고칠 것, 사람이 정할 일 | 문서를 직접 고치지 않음 |

## 버린 것
- 기준·참고·watch 관점 선택, 항목 추가·제거·관점 변경과 context 생성·이름·목적·보관의 개별 쓰기(옛 R5·R6): perspective와 flat 항목이 없어지고 context는 계약으로 짜므로 계약·검색·용어집 초안과 판 제출로 바꿨다.
- 용어 후보(서로 다른 문서 3개 이상 출현, 후보마다 최대 5개 주소, 채택 term 최대 30개)와 `doc@ver` 근거(옛 R7·R8): 용어집은 agent용이고 뜻은 Context Engineer와 사람이 정하며, 후보·근거·문서 판은 없다.
- 해석 질문·미답 시 후보 유지 규칙(옛 R10)은 R10으로 옮기되 용어 후보가 아니라 경계·뜻·위반 처리 방향에 쓴다.
- watch 변화 4회 이상·기준 자료 뒤처짐 14일 이상 근거(옛 R11): watch와 기준 자료 개념이 없어졌다. 수동 업무 4회 근거만 남겼다.
- context 간 같은 뜻의 다른 말을 짝짓는 대응 후보(옛 R9): context 사이는 public로 내놓은 type·field로 잇고 용어 대응 보고로 풀지 않는다. 같은 말 다른 뜻의 충돌만 R12로 남겼다.
- 시스템 자리의 단일 보고 선언·시리즈 조회와 자동 일일 용어 탐색·변화 event run은 lophn-agent/roles/operator 및 사람 요청만 받는 결정으로 제거했다.
- model·skill·MCP·context 선택은 agent 정의의 칸이다(lophn-agent/agents). run 한도·권한 예외는 사람이 고칠 정의의 칸이 아니다.
- Operator 후보 검토(수동 업무 4회 근거)·Operator 초안(범위·고르는 context·읽을 앱 command·남길 문서·주기·tool 선택)·겹치는 Operator의 변경 제안(옛 R17~R19)은 agent가 Operator를 제안하는 길을 첫 판에서 지우면서 없앴다(lophn-agent/assignments#Q5). Operator는 사람이 Agents 탭 editor에서 만든다(lophn-agent/agents#R8).
