---
type: requirements
concerns: [shell/workspace]
---
# shell/workspace

프로젝트 탭의 종류(문서 편집기·터미널·앱 패널·Agent·Contexts·Context·Search)·줄·배치·복원, 접힌 sidebar의 바로 가기 rail, 탭 kind로 그리는 Contexts·Context·Search 화면의 구성, agent에게 제공할 현재 보기 상태, 세션 안 시각 블록의 표시 틀을 맡는다; 문서 저장은 shell/editor, 터미널은 shell/terminal, 앱 신원과 격리는 shell/app-frame, 시각 블록의 내용·보존은 lophn-agent/visuals, context의 계약·검색 선언·위반·용어집이 무엇인지는 documents/contexts, 저장한 보기는 documents/outline-and-search, Agent 탭의 화면은 lophn-agent/conversation을 따른다. 탭 kind는 프로젝트 화면에만 있고 Lophn Workspace는 칸·탭 없는 따로인 페이지다(→ shell/desktop#R33).

## 요구

**[R1]** 프로젝트 작업대의 같은 탭 줄에서 문서 편집기·터미널·앱 패널·Agent·Contexts·Context·Search 탭을 열고 각 탭에 종류·대상 이름·닫기를 표시한다.
- 이유: 같은 프로젝트 일을 위해 창과 공간을 계속 오가지 않게 한다.
- 확인: 일곱 종류를 한 프로젝트에서 열어 키보드로 전환하고 종류를 글자로 구별한다.
- 의도: shell#I2

**[R2]** 탭 줄은 높이 36px로 두고 넘치는 탭은 줄 안에서 스크롤하여 선택 탭을 드러내되 페이지 전체에 가로 스크롤을 만들지 않는다.
- 이유: 탭이 늘어도 현재 작업과 본문 폭을 잃지 않는다.
- 확인: 좁은 창에서 탭 20개를 열어 모든 탭에 접근하고 선택 탭이 보이는지 본다.
- 의도: shell#I2

**[R3]** 탭은 좌우 한 칸 또는 두 칸에 배치하고 drag와 키보드의 다른 칸으로 옮기기를 모두 제공하며 각 칸의 탭 순서·선택 탭과 한 곳의 focus를 유지한다.
- 이유: 문서 옆 터미널·앱 패널을 원하는 위치에 놓고 키보드로도 같은 배치를 한다.
- 확인: 문서와 앱 또는 터미널을 나란히 놓고 탭을 옮겨 순서와 focus가 따라가는지 본다.
- 의도: shell#I2

**[R4]** 두 칸의 최소 폭은 각각 480px로 하고 부족하면 원래 분할 비율과 탭 소속을 보존한 한 칸 보기로 바꾸며 다시 넓어지면 원래 배치로 돌아간다.
- 이유: 좁은 창 때문에 사람의 배치가 새 설정으로 덮이지 않는다.
- 확인: 창을 좁혔다 넓혀 두 칸의 탭·순서·분할 비율이 돌아오는지 본다.
- 의도: shell#I5

**[R5]** 앱 패널은 apps/blueprint가 패널 표시를 선언한 화면만 프로젝트 탭에 열고 지원하지 않는 앱에는 앱 공간으로 열기를 안내한다.
- 이유: 전체 창용 앱을 임의로 축소하여 깨진 화면으로 만들지 않는다.
- 확인: 패널 선언 앱만 탭 선택에 나오고 미지원 화면은 조용히 축소되지 않는지 본다.
- 의도: shell#I2

**[R6]** 프로젝트를 다시 열거나 shell/desktop#R24의 이어서를 누르면 마지막 탭 순서·두 칸 배치·선택 탭·분할 비율·문서 읽던 위치·Context 탭의 하위 탭·Search 탭의 선택한 검색과 채운 입력을 복원한다.
- 이유: 재시작 뒤 같은 작업을 다시 배치하는 비용을 줄인다.
- 확인: 문서·터미널·앱 패널·Context·Search 탭을 배치하고 Electron을 종료한 뒤 이어서로 같은 배치를 열며 Context 탭의 하위 탭과 Search 탭에 채운 입력·page도 돌아오는지 본다.
- 의도: shell#I5

**[R7]** 탭 복원은 현재 대상과 권한을 다시 검사하여 없거나 사용할 수 없는 대상은 이유와 닫기를 가진 자리표시로 남기고 터미널은 사람이 새로 시작하기 전까지 종료된 자리표시로 복원한다.
- 이유: 배치 복원이 앱 호출·이전 터미널 명령의 자동 실행으로 바뀌어서는 안 된다.
- 확인: 보관 앱·없는 문서·없어진 context·계약에서 사라진 선언된 검색·종료 터미널을 복원해 다른 대상으로 바뀌지 않고 PTY가 자동 생성되지 않는지 본다.
- 의도: shell#I5

**[R8]** 탭 배치는 사람의 로컬 UI 편의 상태로만 보존하고 문서 본문·편집 초안·터미널 출력·검색 결과·credential·승인·앱 업무 상태를 함께 저장하지 않는다.
- 이유: 다시 여는 편의와 업무의 정본·민감한 내용을 구별한다.
- 확인: 복원 자료에서 대상 참조·배치·읽던 위치·검색 입력만 확인되고 내용과 검색 결과와 secret이 없는지 본다.
- 의도: shell#I5

**[R9]** agent의 사람 요청에는 그 요청을 보낸 창의 프로젝트·열린 탭 종류와 허용 대상 참조·선택 탭·focus 칸·문서 선택 범위·관측 시각을 현재 보기 상태로 묶어 제공한다.
- 이유: 다른 창의 작업을 현재 요청의 문맥으로 오인하지 않는다.
- 확인: 두 창에서 요청하여 각각 요청 창의 탭과 선택 범위만 제공되는지 보고 문맥에 넣는 방법은 lophn-agent/harness/prompt-assemble을 따른다.
- 의도: shell#I1

**[R10]** 현재 보기 상태는 허용 대상과 platform/redaction을 검사한 최대 2KiB의 요약부터 제공하고 나머지 탭 참조는 한 번에 최대 20개씩 읽게 하며 생략·단절·관측 시각을 표시한다.
- 이유: 탭 전체 내용이 매 turn의 token과 민감한 자료로 번지지 않는다.
- 확인: 많은 탭과 범위 밖 탭을 열어 요약 한도·이어 읽기·생략 표시를 확인하고 선택 본문·편집 초안·터미널 출력이 자동 첨부되지 않는지 본다.
- 의도: shell#I1

**[R11]** 앱 탭의 현재 보기 상태는 실제 앱·release·모드·화면 참조만 먼저 넘기고 상세 상태와 힌트·주석은 apps/agent-context의 선언된 command로만 읽고 쓴다.
- 이유: DOM 캡처나 임의 입력 통로가 앱의 공개 범위를 우회하면 안 된다.
- 확인: 민감한 입력칸이 있는 앱에서 DOM·screenshot이 자동 전송되지 않고 선언한 상세 읽기만 가능한지 본다.
- 의도: shell#I1

**[R12]** 세션의 시각 블록은 답의 해당 위치에 설치된 SDK의 선언형 컴포넌트·고정 문서 뷰어·카드 표시를 선언한 앱 frame으로 그리며 agent가 준 script·HTML을 shell 코드로 실행하지 않는다.
- 이유: 답을 그림으로 읽는 기능이 shell 실행 권한으로 바뀌어서는 안 된다.
- 확인: lophn-agent/visuals가 제공한 표·차트·도표·문서·앱 카드를 표시하고 script 입력은 실행 없이 거절되는지 본다.
- 의도: shell#I5

**[R13]** 시각 블록 틀은 제목·출처·관측 시각·내용 또는 실패 이유와 lophn-agent/visuals의 문서로 남기기를 제공하고 세션 전환·새 답이 사용자의 스크롤 위치와 focus를 빼앗지 않게 한다.
- 이유: 그림의 근거와 저장 결과를 알면서 읽던 작업을 이어간다.
- 확인: 블록 로딩·실패·문서 저장·streaming 중에도 입력 focus와 읽던 위치가 유지되고 저장 후 고정 문서 링크가 보이는지 본다.
- 의도: shell#I5

**[R14]** 탭 kind는 등록 구조로 늘리고 kind 하나를 더하는 일이 다른 kind의 동작과 공통 탭 줄을 바꾸지 않으며 kind마다 이름·복원 때 대상 검사·열기 진입을 한 곳에서 선언한다.
- 이유: kind를 늘릴 때마다 여러 곳을 고쳐야 하면 화면을 병렬로 만들 수 없고, 하나를 더하다 다른 kind가 깨진다.
- 확인: Agent·Contexts·Context·Search를 따로 더해도 서로의 복원·열기가 영향받지 않고, 등록되지 않은 옛 kind가 든 저장 배치는 그 탭만 건너뛴 채 열린다.
- 의도: shell#I2

**[R15]** 탭 줄의 `+`는 새 탭 메뉴(Document, Terminal, Agent ▸ lophn·Context Engineer·Operator…, Context, Search, App panel)를 열고 Context를 고르면 이 프로젝트의 context 목록에서 하나를 골라 그 Context 탭을 연다.
- 이유: 사이드바나 rail을 거치지 않고도 지금 칸에 어떤 탭이든 바로 연다.
- 확인: `+`에서 일곱 종류가 모두 열리고 Context는 이 프로젝트의 context 이름만 고르게 보인다.
- 의도: shell#I2

**[R16]** Contexts 탭은 이 프로젝트의 context를 카드로 나열하고 카드마다 이름·목적·다루는 것의 종류 수·적용된 판과 검사 결과·위반 수·쓰는 Operator 수와 [Open]을 보이며 아래에 [New context]를 둔다.
- 이유: context를 만들거나 열기 전에 어떤 context가 있고 어느 것이 손볼 데가 있는지 한 번에 본다.
- 확인: context 둘이 있을 때 카드 둘이 각자의 목적·위반 수를 보이고 위반이 있는 카드는 글자로 구별되며 [Open]이 그 Context 탭을 연다. context가 없으면 비었음 상태와 [New context] 하나만 보인다.
- 의도: shell#I1

**[R17]** Context 탭은 머리에 이름·Context 표시·목적·"Kept up to date by Context Engineer"를 보이고 하위 탭을 Overview(기본)·Search·Violations(위반이 있으면 개수 함께)·Glossary·Contract 순으로 둔다.
- 이유: 계약 세부보다 이 context가 무엇을 다루는지를 먼저 보게 한다.
- 확인: 탭을 열면 Overview가 보이고 Contract는 맨 뒤이며 Violations 이름에 위반 개수가 붙는다.
- 의도: shell#I1

**[R18]** Overview는 context가 다루는 것마다 이름·한 줄 뜻·개수·가진 것·예시 문서·"See all"을 담은 카드를 보이고, 카드 사이를 "runs on", "graded by"처럼 사람 말을 붙인 화살표로 잇고, 그 아래 Composition 트리에 개체마다 어느 자료(경로 포함)로 이루어지고 무엇을 가지며 무엇과 이어지는지를 보인다.
- 이유: 코드를 읽지 않는 사람이 "이 context에 무엇이 있고 서로 어떻게 이어지나"를 어려운 말 없이 안다.
- 확인: 개체 카드·화살표·Composition이 모두 보이고 kind·public·검색 함수 같은 계약 말이 한 곳도 나오지 않으며 예시의 문서 이름을 누르면 그 문서 탭이 열린다.
- 의도: shell#I1

**[R19]** Violations는 계약을 어긴 문서를 줄마다 파일 이름·무엇이 어긋났는지·어긴 규칙 한 줄·[Send to Context Engineer]로 보이고 위에 [Send all to Context Engineer]를 두며, 이미 넘긴 줄은 단추 대신 "Context Engineer is on it"을 보이고 위반이 없으면 "No violations."만 보인다.
- 이유: 위반을 알게 된 사람이 단추 하나로 고칠 사람(Context Engineer)에게 넘기고 넘겼는지 안다.
- 확인: 위반 둘 중 하나를 넘기면 그 줄만 상태 글로 바뀌고 문서 이름은 누르면 그 문서 탭을 연다.
- 의도: shell#I1

**[R20]** Glossary는 이 context의 용어와 뜻을 목록으로 보이고 사람이 뜻을 고칠 수 있게 하며, 용어집이 agent가 사람 말을 알아듣기 위한 자료임을 한 줄로 밝히고 비었을 때는 비었음 상태를 보인다.
- 이유: 용어집의 뜻은 Context Engineer와 사람이 함께 정하므로(documents/terms) 사람이 읽고 고칠 자리가 있어야 한다.
- 확인: 용어 하나의 뜻을 고치면 목록에 반영되고 용어가 없으면 비었음 상태가 보인다.
- 의도: shell#I1

**[R21]** Contract는 가장 뒤 하위 탭으로 두고 "Details for Context Engineer and the curious"라는 안내 아래에 개체마다 이름·public 표시·자료 위치 종류(kind)와 경로·문서 수·field와 관계를, 선언된 검색마다 이름과 예시 검사 결과를, 위쪽에 개체 관계 그림을 보이고 적용된 판 번호·적용 시각·검사 통과 여부와 [Ask Context Engineer]·[History]를 머리에 둔다.
- 이유: 계약 세부는 필요한 사람만 보는 자리로 보내고 기본 화면에서 안쪽 개념을 뺀다.
- 확인: Contract에서만 kind·public·판 번호가 보이고 [Ask Context Engineer]가 그 탭 머리의 유일한 primary다.
- 의도: shell#I1

**[R22]** Context 탭의 Search 하위 탭은 이 context가 선언한 검색의 목록을 보이고 하나를 고르면 Search 탭에서 연다.
- 이유: context 화면에서 검색으로 가는 길을 한 곳에 둔다.
- 확인: 선언된 검색 이름을 누르면 같은 context로 맞춰진 Search 탭에서 그 검색이 열린다.
- 의도: shell#I2

**[R23]** Search 탭은 왼쪽에 context 고르기·"Open context" 링크·그 context의 선언된 검색 목록·Saved views를, 본문에 고른 검색의 입력 form과 결과를 둔다.
- 이유: 검색을 다른 context로 바꾸거나 저장한 보기로 바로 가고, 해당 context 탭으로 돌아갈 수 있어야 한다.
- 확인: context를 바꾸면 검색 목록과 Saved views가 그 context 것으로 바뀌고 "Open context"가 그 Context 탭을 연다. 선언된 검색이 없는 context는 비었음 상태와 [Open context]만 보인다.
- 의도: shell#I2

**[R24]** Search 탭의 입력 form은 context가 선언한 검색의 입력 이름과 타입에서 그리며 고르는 입력은 타이핑으로 후보를 거르는 combobox, 여럿 고르는 입력은 선택한 것을 표시하는 chip, 범위 입력은 시작과 끝 두 칸으로 보이고, 선언이 그릴 수 없는 입력 타입을 쓰면 그 검색을 열지 않고 이유와 [Ask Context Engineer]를 보인다.
- 이유: 필드 하나에 검색어 일치만 하는 화면은 검색 도구를 만든 의미가 없고, 검색마다 화면을 따로 코딩할 수 없다.
- 확인: 선언만 다른 두 검색이 코드 변경 없이 각자의 입력으로 그려지고, combobox에 일부를 치면 맞는 후보만 남으며 후보에 없는 값은 고를 수 없다.
- 의도: shell#I1

**[R25]** Search 탭의 결과는 선언이 정한 대로 표 또는 board(열마다 카드)로 그리고 결과가 한 page 25줄을 넘으면 이전·다음과 page 번호로 이동하게 하며 결과 개수와 지금 보는 범위를 적는다.
- 이유: 긴 결과가 한 화면을 밀어내지 않고 지금 어디를 보는지 안다.
- 확인: 결과 61건이면 3 page이고 "1–25 of 61"처럼 범위가 보이며 입력을 바꾸면 1 page로 돌아간다.
- 의도: shell#I1

**[R26]** 검색 결과·board·Overview 예시·Agent 탭의 대화에서 보이는 도메인 객체(exp-008, F-009 같은 이름)는 링크이고 누르면 그 객체의 문서 탭을 새 탭으로 열며 객체만을 위한 탭 kind를 두지 않는다.
- 이유: 도메인 객체는 결국 project의 문서이므로 이미 있는 문서 탭에서 읽고 고친다.
- 확인: 결과의 F-009를 누르면 F-009가 든 문서 탭이 열리고 같은 문서가 이미 열려 있으면 그 탭이 선택된다.
- 의도: shell#I2

**[R27]** 검색 결과에서 [Save as view]를 누르면 지금 입력을 채운 검색에 이름을 붙여 저장하고, Saved views 목록이나 바로 가기 rail의 Saved views에서 고르면 그 입력을 채운 Search 탭을 열어 결과를 다시 계산한다.
- 이유: 자주 보는 검색을 다시 채우지 않고 연다(저장한 보기의 정의는 documents/outline-and-search).
- 확인: 입력을 채워 저장한 보기를 연 탭에 같은 입력이 채워져 있고 열 때마다 최신 결과가 나온다.
- 의도: shell#I1

**[R28]** 문서 탭의 Info에서 Contexts 하위 탭은 이 문서가 들어 있는 context를 이름과 [Open]으로 나열하고 [Open]은 그 Context 탭을 연다.
- 이유: 문서를 읽다가 이 문서를 다루는 context로 바로 간다.
- 확인: 두 context에 든 문서의 Info › Contexts에 둘이 나열되고 하나도 없으면 비었음 상태가 보이며 [Open]이 Context 탭을 연다.
- 의도: shell#I2

**[R29]** 계약 위반이 감지되면 toast로 알리고 [View]는 그 context의 Context 탭을 Violations 하위 탭으로 연다.
- 이유: 위반을 놓치지 않으면서 작업 중인 탭과 focus를 빼앗지 않는다.
- 확인: toast가 입력 focus를 바꾸지 않고 [View]를 누르면 해당 context의 Violations가 선택된 탭이 열리며 이미 열린 탭이면 그 탭의 하위 탭만 바뀐다.
- 의도: shell#I1

**[R30]** [New context]는 폼을 열지 않고 Context Engineer와의 Agent 탭을 열어 첫 메시지에서 무엇을 도와야 하는지·어느 폴더나 파일을 보는지·무엇을 찾고 싶은지를 묻고, 대화를 시작하면 drafting 상태의 Context 탭을 남겨 단계(읽기·초안·검사·적용 중 몇 번째)와 흐린 초안 개체를 보이고 막히면 Agent 탭에서 묻는다.
- 이유: context 설계는 Context Engineer가 경계를 정하는 일이라 사람에게 설문을 시키지 않고 대화로 시작하며, 만드는 동안에도 결과가 탭에 보인다.
- 확인: [New context]가 Agent 탭만 열고 다른 form이 없으며, 대화 뒤 drafting 탭이 "step n of 4"를 보이고 막힌 질문의 답 단추가 Agent 탭에 나온다.
- 의도: shell#I2

**[R31]** Context 탭은 아홉 길로 열린다: 사이드바의 Contexts 행, 접힌 바로 가기 rail의 Contexts에서 Contexts 탭의 [Open], 탭 줄 `+` › Context, Search 탭의 "Open context", 문서 Info › Contexts의 [Open], 위반 toast의 [View], 상단 검색(Ctrl+K)의 context 이름, Agent 탭 대화 속 context 이름 링크, [New context]의 Context Engineer 대화 뒤 drafting 탭.
- 이유: 사람이 어디서 출발해도 같은 Context 탭에 닿고 어느 길이든 같은 context의 열린 탭이 있으면 새로 만들지 않고 그 탭을 선택한다.
- 확인: 아홉 길을 각각 눌러 도착한 Context 탭이 같은 context이고(위반 toast만 Violations 하위 탭) 이미 열려 있으면 탭이 늘지 않는다.
- 의도: shell#I2

**[R32]** 접힌 sidebar는 바로 가기 rail이 되어 Terminal · Contexts · Saved views · Search · Agent 단추만 두고 단추를 누르면 그 종류의 탭을 바로 연다(Terminal은 터미널 탭, Contexts는 Contexts 탭, Search와 Saved views는 Search 탭, Agent는 Agent 탭이고 Saved views는 왼쪽 저장한 보기 목록이 보이는 상태로 연다).
- 이유: 사이드바를 닫아도 자주 쓰는 탭 종류로 한 번에 간다.
- 확인: 접은 상태에서 다섯 단추 모두 해당 종류의 탭을 열고 각 단추에 이름 tooltip이 보이며 펼치면 원래 sidebar로 돌아온다.
- 의도: shell#I2

**[R33]** Agent는 탭 kind이자 rail 단추의 이름이며 열면 대화 탭이 열린다; 그 탭 안의 화면은 lophn-agent/conversation의 몫이고 여기서는 탭 줄·복원·열기만 정한다.
- 이유: 대화를 오른쪽 도크가 아니라 다른 탭과 같은 줄·칸에서 옮기고 복원한다.
- 확인: Agent 탭을 칸 사이로 옮기고 재시작해 복원하며 탭 이름이 Conversation이 아니라 Agent다.
- 의도: shell#I2

## 열린 질문

- shell/workspace#Q4
- shell/workspace#Q5

## 버린 것

- 문서 뷰어 탭(R1에서 뺌) — 문서 판과 판 고정이 없어져 고정 판을 읽는 viewer가 필요 없다. 읽기는 문서 편집기의 읽기 모드가 한다.
- Context의 관점(기준·참고·watch)·watch 변화 화면(옛 Materials·Meanings)과 context export 단추 — context 모델에서 없앴다. 대신 R17~R21의 Overview·Violations·Glossary·Contract로 보인다.
- 도메인 객체마다 따로 여는 객체 탭과 새 context 폼("Use things from other contexts"·질문 설문·"Words to know") — 객체는 문서 탭을, 시작은 Context Engineer 대화를 쓰기로 했다(R26, R30).
- 일반 조건(제목에 든 말·형식·기간·보관 상태)으로 만든 저장 보기 — 저장 보기는 선언된 검색 호출만 저장한다(R27). 일반 키워드 검색은 상단 검색(팔레트)이 한다.
