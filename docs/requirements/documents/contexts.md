---
type: requirements
concerns: [documents/contexts]
---
# documents/contexts

한 project의 파일 위에 두는 결정적 계약(도메인 개체의 type, 자료 위치 kind, field, 관계, 검사 규칙, public/private)과 계약을 따르는 선언된 검색, 그 saved view, 계약·검색 묶음의 판과 격리 검사, 위반 감지와 index를 맡는다. 용어집은 documents/terms, 반복 문서의 다음 이름 계산은 documents/series, 문서 편집·목차는 documents/formats와 documents/outline-and-search, 계약을 쓰는 역할은 lophn-agent/roles/context-engineer가 맡는다.

## 요구

### 소속과 범위

**[R1]** context는 한 project의 파일 위에 두는 결정적 계약과 선언된 검색의 묶음이며 project마다 여러 개 둘 수 있고 Lophn Workspace에는 없다.
- 이유: 실험·시나리오·결과 같은 도메인 구조를 사람이 매번 직접 찾아다니지 않고 program과 agent가 같은 계약으로 찾아야 한다.
- 확인: 한 project에 context 둘을 만들면 둘 다 그 project의 목록에 나오고, Workspace에는 context 목록도 만들기도 없다.
- 의도: documents#I6, documents#I3

**[R2]** context는 자기 project의 문서와 app-data만 읽으며 다른 project의 파일을 가리키는 계약은 검사에서 거절한다.
- 이유: 한 project의 계약이 다른 project의 자료에 기대면 project를 옮기거나 지울 때 조용히 깨진다.
- 확인: 다른 project의 경로를 자료 위치로 적은 계약을 검사에 올리면 거절되고, 같은 project의 경로는 통과한다.
- 의도: documents#I6

**[R3]** context는 파일과 앱 데이터를 읽기만 하며 계약과 그 판은 lophn ledger(와 blob)에 두고 project 폴더에는 파일을 쓰지 않는다.
- 이유: 사람이 가진 폴더를 계약 파일로 어지럽히지 않고, 앱 source처럼 lophn이 계약을 갖는다.
- 확인: context를 만들고 계약 판을 적용한 뒤에도 project 폴더의 파일 목록과 내용이 그대로이다.
- 의도: documents#I1, documents#I6

**[R4]** 사람은 context를 보관하고 해제할 수 있으며 보관한 context는 검색·위반 알림에서 빠지고 agent 정의(Operator `contexts`)에 새로 고를 수 없으며 계약과 판은 남는다.
- 이유: 쓰지 않는 context를 지우지 않고 화면과 알림에서 치운다.
- 확인: context를 보관하면 검색 목록에서 사라지고 알림이 멎으며 Operator 정의에 새로 고르려 하면 거절되며 해제하면 이전 계약 그대로 돌아오고 project 파일은 변하지 않는다.
- 의도: documents#I6

### 계약

**[R5]** 계약은 도메인 개체의 type마다 자료 위치 kind 하나를 정하며 kind는 folder, docs, series, index, section, outline, app-data 일곱뿐이다.
- 이유: 위치의 종류가 정해져 있어야 program이 개체를 추측 없이 결정적으로 계산하고 검사한다.
- 확인: 일곱 가지 kind로 type을 각각 적은 계약은 통과하고 여덟 번째 kind나 kind 없는 type은 거절된다.
- 의도: documents#I6

**[R6]** 계약의 type은 field(frontmatter 키, YAML 키, section 본문, 경로에서 잡은 값, 제목, 링크)와 type 사이 관계를 가지며 같은 파일에서는 시간·난수·model 호출 없이 언제나 같은 개체와 값을 낸다.
- 이유: agent가 추측으로 찾던 구조를 program이 같은 결과로 계산해야 Operator가 빠르고 믿을 수 있게 움직인다.
- 확인: 같은 파일 상태에서 개체 계산을 두 번 하면 개체·field·관계가 똑같고, 계산 중 model이나 외부 호출이 없다.
- 의도: documents#I6, documents#I3

**[R7]** folder는 폴더 하나를, docs는 지정한 문서(경로나 이름 패턴) 하나하나를 개체 하나로 삼고 둘 다 폴더 이름·파일 이름·경로를 field로 쓸 수 있다.
- 이유: 개체가 폴더에 담긴 프로젝트와 문서 한 장에 담긴 프로젝트를 모두 같은 계약으로 쓴다.
- 확인: 폴더마다 개체 하나인 type과 문서마다 개체 하나인 type을 적고 각 개체 수와 경로 field가 파일 구조와 맞는지 본다.
- 의도: documents#I6

**[R8]** index는 README처럼 다른 문서로의 링크를 모은 목차 문서이며 program이 그 링크를 결정적으로 따라가 링크된 문서들을 개체로 삼는다.
- 이유: 사람이 목차 문서에 모아 둔 문서 묶음을 계약이 그대로 쓴다.
- 확인: README가 링크한 문서 셋을 개체로 얻고 링크를 하나 빼거나 깨진 링크로 바꾸면 개체와 위반이 그에 맞게 바뀐다.
- 의도: documents#I6, documents#I7

**[R9]** section은 문서의 section 하나를 개체 자체로 삼을 수도 있고(decisions.md의 H2 하나하나가 Decision) 다른 type의 field로 쓸 수도 있다(Experiment의 질문 = "## 질문" section 본문).
- 이유: 한 문서에 여러 개체가 있는 경우와 한 개체의 문서 안에 의미 있는 부분이 있는 경우를 모두 다룬다.
- 확인: H2마다 개체인 type과 section 본문이 field인 type을 각각 적고, section 이름을 바꾸면 개체나 field가 없어진 것이 위반으로 잡힌다.
- 의도: documents#I3, documents#I7

**[R10]** outline은 문서의 제목 tree이며 지금은 Markdown만 읽고 다른 형식은 parser를 붙일 자리만 열어 두고, 저장하거나 index에 넣지 않고 쓸 때마다 문서 editor와 같은 parser로 결정적으로 읽는다.
- 이유: 목차는 문서에서 늘 다시 계산할 수 있어 따로 두면 낡을 뿐이고, editor와 계약이 다른 목차를 보면 안 된다.
- 확인: 문서를 고친 직후 outline 읽기에 새 제목 tree가 나오고, index를 지워도 outline 결과가 같으며, Markdown 아닌 형식은 읽을 수 없다는 이유와 함께 거절된다.
- 의도: documents#I3

**[R11]** series는 파일 이름 패턴(예: eval/experiments/exp-{n}-*.md)이 순서 있는 개체들을 정하고 순서는 이름의 번호를 수로 비교한 자연스러운 순서이며, 이어 쓸 다음 이름은 그 패턴에서 결정적으로 계산한다.
- 이유: 반복 문서가 계약 안에서 개체이면서 다음 이름과 자리가 저절로 정해져야 한다.
- 확인: exp-9, exp-10 패턴에서 exp-9 다음이 exp-10이고 다음 이름이 exp-11로 계산된다; 이름 계산의 규칙은 documents/series를 따른다.
- 의도: documents#I5

**[R12]** app-data는 앱의 read 명령 자체를 자료로 삼으며 읽기 효과가 아닌 명령은 계약 검사에서 거절하고 명령의 입력·결과는 계약에도 index에도 저장하지 않는다.
- 이유: 앱의 지금 데이터를 개체로 쓰되 자료 선택이 앱을 바꾸는 통로가 되면 안 된다.
- 확인: 읽기 명령을 type으로 적은 계약은 통과하고 쓰기 명령은 거절되며, 명령 효과는 apps/blueprint를 따른다.
- 의도: documents#I6

**[R13]** 계약은 개체가 지켜야 할 검사 규칙(필수 field, 유일해야 하는 key, 관계 대상의 존재 등)을 적고 program이 같은 규칙을 같은 방식으로 판정한다.
- 이유: 문서는 사람과 외부 도구가 마음대로 고치므로 어긋남을 사람이 눈으로 찾지 않고 program이 알아야 한다.
- 확인: 필수 field가 빠진 문서와 존재하지 않는 개체를 가리키는 관계 문서를 두면 각각 어느 규칙을 어겼는지 판정된다.
- 의도: documents#I6, documents#I7

**[R14]** 계약은 type과 field에 public 또는 private를 표시하고 다른 context는 public인 것만 가리킬 수 있으며 이를 program이 검사하고, context 사이 참조는 필요한 만큼만 둔다.
- 이유: context를 module처럼 안은 단단히 뭉치고 밖과는 적게 이어서, 안쪽을 바꿔도 다른 context가 깨지지 않게 한다. 그 경계를 긋는 일은 lophn-agent/roles/context-engineer의 핵심 책임이다.
- 확인: 다른 context의 private type이나 field를 가리킨 계약은 검사에서 거절되고, public만 가리키면 통과하며 내놓은 부분이 그대로면 안쪽 변경이 참조한 context의 검사를 깨지 않는다.
- 의도: documents#I6

### 선언된 검색

**[R15]** 계약은 선언된 검색을 가지며 검색 하나는 이름, 타입 있는 입력(다른 개체 고르기, 값 고르기, 범위 같은 것), 선언형 query(어디서, 조건, 관계 따라가기, 정렬, 묶기), 결과 보기(표, board, page 이동)를 선언한다.
- 이유: "검색어 일치 칸 하나"로는 도메인 지식을 쓴 검색을 못 하고, 검색마다 코드를 쓰면 결정적이고 잘게 검사하기 어렵다.
- 확인: "C-049를 검증한 실험과 그 finding"처럼 개체를 고르고 관계를 따라가 묶어 보여 주는 검색을 선언해 실행하고, 선언에 없는 입력이나 타입이 다른 입력은 거절된다.
- 의도: documents#I3, documents#I6

**[R16]** lophn은 선언만으로 검색 화면(입력 form과 결과)을 그리고 같은 선언을 agent가 호출하며 결과의 개체는 그 개체의 파일과 section을 여는 링크로 낸다.
- 이유: 사람이 쓰는 검색 화면과 agent의 검색 호출이 한 선언에서 나와야 둘이 달라지지 않는다.
- 확인: 검색 하나를 선언하면 화면의 입력 form과 agent 호출 입력이 같은 타입이고 결과 개체의 링크가 그 파일 위치를 연다; 화면 모양은 shell이 맡는다.
- 의도: documents#I3, documents#I6

**[R17]** 선언된 검색의 결과는 정렬이 결정적이고 cursor로 이어 볼 수 있으며 같은 파일 상태와 입력이면 같은 결과를 낸다.
- 이유: page를 넘기거나 검색을 다시 해도 순서와 내용이 흔들리면 목록을 믿을 수 없다.
- 확인: 같은 입력으로 검색을 두 번 하면 결과와 순서가 같고, 첫 page 뒤 cursor로 이어 본 결과가 한 번에 본 결과의 이어짐이다.
- 의도: documents#I3

**[R18]** saved view는 선언된 검색의 호출을 고정 입력으로 저장해 이름 붙인 것이며 열 때마다 검색을 다시 계산하고, 사람이 검색 결과에서 저장하거나 Context Engineer가 미리 둔다.
- 이유: 자주 보는 묶음(예: 진행 중인 실험)을 바로 열고, 열 때마다 최신 파일에서 계산한다.
- 확인: "진행 중인 실험"을 저장해 열고, 문서를 고친 뒤 다시 열면 결과가 새 파일 상태를 따르며 일반 조건(제목에 든 말·형식·바뀐 기간)만으로는 saved view를 만들 수 없다.
- 의도: documents#I4

### 계약의 판과 격리 검사

**[R19]** Context Engineer는 초안에서 계약, 선언된 검색, saved view, 예(examples)를 한 묶음으로 만들고 묶음은 판(r1, r2 …)을 가지며 초안을 고치는 동안 Operator와 사람은 지금 적용된 판을 계속 쓴다.
- 이유: 계약을 고치는 동안 쓰는 쪽이 멈추거나 반쯤 고쳐진 계약을 보면 안 된다.
- 확인: 초안을 쓰는 중에도 검색은 적용된 판으로 돌고, 검사에 낸 묶음에 다음 판 번호가 붙는다.
- 의도: documents#I6

**[R20]** 묶음은 적용 전에 그 순간 project 파일의 임시 snapshot에 대해 격리 검사를 받고 계약이 돌아가는지, 예가 모두 맞는지, 다른 context 참조가 public뿐인지, 모든 saved view가 호출되는지 확인하며 snapshot에서 나온 위반은 세어서 남긴다.
- 이유: Context Engineer가 계약을 망가뜨린 것과 사람이 문서를 계약 밖으로 고친 것을 구별해서, 앞의 것만 적용을 막는다.
- 확인: 예가 틀린 묶음은 검사에서 실패해 적용되지 않고, 문서 하나가 규칙을 어긴 snapshot에서 예가 모두 맞는 묶음은 통과하며 위반 수가 기록된다; 임시 snapshot은 검사가 끝나면 지워진다.
- 의도: documents#I6

**[R21]** 검사를 통과한 묶음은 사람 승인 없이 자동으로 적용되고 이전 판은 남으며 사람은 이전 판으로 되돌릴 수 있다.
- 이유: 계약은 읽기만 하고 바깥 효과가 없어 앱 release와 달리 사람 승인이 필요 없다.
- 확인: 통과한 묶음이 승인 요청 없이 적용되고 직전 판이 남아 있으며, 되돌리면 이전 판이 다시 적용된다; 검사에 실패한 묶음은 적용된 판을 바꾸지 않는다.
- 의도: documents#I6

**[R22]** 이 판은 계약 판이며 문서의 판이 아니다. 근거(위반, 검색 결과, 용어집)는 파일 경로와 section만 가리키고 문서 판을 가리키지 않는다.
- 이유: 문서의 판과 tracking은 없어졌고 context는 지금 project 파일을 읽는다.
- 확인: 위반·검색 결과·용어 근거에 문서 판 번호가 없고, 계약 판을 되돌려도 project 파일은 그대로이다.
- 의도: documents#I1, documents#I6

### index와 위반

**[R23]** index는 계약이 가리키는 경로만 파일 크기와 수정 시각으로 훑어 개체를 계산해 두는 derived store이며, 검색하거나 context를 열기 전에 다시 가볍게 훑는다. 그 밖에는 활성 context의 계약 경로에서 파일이 바뀐 것만 최소로 감지해 바뀐 파일을 다시 계산하고 검사하며, 변화 기록·변화 event·화면 상태·agent 표시는 남기지 않는다.
- 이유: 문서 판 없이도 검색이 빠르고 최신이어야 하고, 아무도 context를 열지 않아도 위반은 알아야 한다(R25). 옛 watch처럼 변화를 비교해 기록하고 알리는 일은 과했다(사람 결정 2026-10-12).
- 확인: 파일을 고친 직후 검색하면 새 내용이 나오고, context를 열지 않은 채 계약 경로의 파일을 고쳐 규칙을 어기면 위반이 기록되며, 계약이 가리키지 않는 경로의 변경에는 아무 일도 없고, 파일 변경 자체는 event·알림·화면 표시를 만들지 않으며, index를 지워도 같은 검색 결과가 다시 만들어진다.
- 의도: documents#I3, documents#I1

**[R24]** program은 개체로 읽을 수 없는 파일, 검사 규칙을 어긴 개체, 계약의 경로 패턴과 어긋난 이름이나 자리를 위반으로 감지하고 어느 파일·section이 어느 규칙을 어겼는지 근거를 남기며 위반이 있어도 나머지 개체의 검색은 그대로 된다.
- 이유: 문서는 밖에서 마음대로 고쳐지므로 계약은 어긋난 문서를 견디되 어긋남을 숨기지 않아야 한다.
- 확인: 파일 이름을 패턴 밖으로 바꾸거나 필수 field를 지우면 위반이 파일·section·규칙과 함께 잡히고, 다른 개체의 검색 결과는 달라지지 않는다.
- 의도: documents#I7, documents#I6

**[R25]** 위반 수가 늘면 사람에게 notification으로 알리고 사람은 위반 하나 또는 전부를 단추 하나로 Context Engineer에게 넘기며 근거는 자동으로 붙고 사람이 설명을 쓸 필요가 없다.
- 이유: 계약 위반을 사람이 알아야 하지만, 고치게 하는 길은 최소로 짧아야 한다.
- 확인: 문서를 고쳐 위반이 늘면 알림이 하나 생기고, 알림에서 위반 목록을 열어 "넘기기"를 누르면 Context Engineer 요청이 어느 파일·section·규칙인지와 함께 만들어지며 위반 수가 줄거나 그대로면 알림이 없다; notification은 platform/notifications를 따른다.
- 의도: documents#I6, documents#I7

### 쓰는 쪽과 쓰는 역할

**[R26]** context의 용어집은 context마다 두는 agent용 자료이며 Context Engineer와 사람이 정하고, 계약의 검색과 검사에는 쓰이지 않는다.
- 이유: program 검색은 계약이 맡고, 용어집은 agent가 사람의 말을 같은 뜻으로 알아듣는 데만 쓴다.
- 확인: 용어집을 바꿔도 계약 판·검색 결과·위반이 변하지 않는다; 용어의 모양과 규칙은 documents/terms를 따른다.
- 의도: documents#I6

**[R27]** context는 Operator 등 lophn agent가 정의(Operator `contexts`)에서 고르는 읽기 자료이며 Operator의 담당 범위를 만들지 않고 coding agent는 context에 접근하지 않는다.
- 이유: 자료와 일을 맡긴 대상을 분리하고, 앱을 만들고 고치는 coding agent는 context와 상관없다.
- 확인: 같은 project의 Operator 둘이 다른 context를 고르고 context를 보관해도 assignment 대상이 바뀌지 않으며, coding agent의 tool과 CLI에는 context 통로가 없다; 구성은 lophn-agent/agents와 lophn-agent/assignments를 따른다.
- 의도: documents#I6

**[R28]** 계약, 선언된 검색, 용어집과 saved view의 초안은 전체에 하나인 Context Engineer가 쓰고 고치며 적용은 R20·R21의 검사 경로로만 한다.
- 이유: project가 여러 개여도 context를 설계하는 방식이 한 손에서 맞춰져야 하고, 적용된 계약이 검사 없이 바뀌면 안 된다.
- 확인: Context Engineer의 계약 변경이 새 판으로만 나타나고 적용된 판을 직접 고치는 길이 없으며, 역할의 범위·책임은 lophn-agent/roles/context-engineer를 따른다.
- 의도: documents#I6

## 열린 질문

- documents/contexts#Q10
- documents/contexts#Q11
- documents/contexts#Q12
- documents/contexts#Q13
- documents/contexts#Q14
- documents/contexts#Q15
- documents/contexts#Q16

## 버린 것

- context 항목의 관점(기준·참고·watch)과 항목마다 적던 선택 이유(reason)는 버렸다; 항목 개념 자체가 없어졌고 개체는 계약의 규칙으로 program이 계산한다.
- 문서 watch(변화 비교, 변화 기록, 소실·미확인 표시, 같은 변화 한 번만 기록)는 통째로 버렸다; 자료가 바뀐 것을 사람에게 알리거나 결정받지 않는다. 남긴 것은 위반을 찾으려고 계약 경로의 파일 변경을 감지하는 일뿐이다(R23).
- 평평한 항목 목록, 항목 추가·제거·순서 편집, 문서 전체와 section을 별개 항목으로 다루기, 같은 문서를 여러 context에 다른 관점으로 넣기는 버렸다; 도메인 type·관계가 이를 대신한다.
- 항목이 최신 문서 판을 따르고 읽은 판을 근거로 고정하던 규칙은 버렸다; 문서 판이 없어졌고 근거는 파일 경로와 section뿐이다.
- 항목 section key가 사라질 때 소실로 표시하고 다시 고르게 하던 규칙은 버렸다; section이 없어진 것은 계약 위반으로 잡혀 Context Engineer에게 넘어간다.
- 프로젝트 폴더·미추적 파일을 항목으로 못 넣던 규칙은 버렸다; folder kind가 폴더를 자료로 삼고 tracking은 없다.
- 문서가 직접 든 context를 역조회하던 규칙은 버렸다; 문서 Info의 context 목록은 계약의 위치 규칙에서 계산한다(화면은 shell).
- context export(목적·항목·고정 판 참조·용어 내보내기)는 제품 결정으로 버렸다; export 기능 자체가 없다.
- coding agent의 context 구성 변경 제안 통로와 읽기 통로는 버렸다; coding agent는 context와 상관없다.
- Workspace의 Documents·Context 화면과 Materials·Meanings 화면, 새 context form은 버렸다; context는 project 안에만 있고 새 context는 Context Engineer 대화로 만든다.
- 용어 후보와 문서 고정 판 근거를 쓰는 관점 기반 용어 연결은 버렸다; 용어집은 agent용이고 근거에 문서 판이 없다(documents/terms).
- 일반 조건(제목에 든 말·본문 검색어·형식·최근 바뀐 기간·보관 상태)으로 만든 saved view는 버렸다; 그런 검색은 project 검색에서 그때그때 하고 saved view는 선언된 검색의 호출만 저장한다.
- 앱 read 명령 항목의 watch 관점과 자동 호출 금지 규칙은 버렸다; app-data kind가 읽기 명령을 자료로 삼으며 첫 구현은 port와 fake까지이다.
- section 의미 대응 제안·확정·유사도 queue·watch rename 자동 추적은 버렸다.
- 상위 context·3단 hierarchy·용어 상속·항목별 깊이·context 분할과 병합·문서 사이 영향 간선과 관계 지도·관계로 관련 context 찾기는 버렸다; context 사이 연결은 public 계약으로만 최소로 둔다.
- registry(파일 하나 안의 항목 목록, 예 components.yaml이나 CSV 줄)를 kind로 두는 것은 지금 넣지 않는다; 반복되면 program으로 내린다.
- 검색 script(QuickJS)는 첫 판에서 두지 않는다; 선언형 query로 표현이 안 되는 것이 실제로 나오면 더한다.
