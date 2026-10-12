---
type: requirements
concerns: [lophn-agent/agents]
---
# lophn-agent/agents

agent 정의와 설정 층을 맡는다. built-in(lophn·Context Engineer·App Engineer)과 사람이 만든 Operator가 어떤 칸을 가지고, 칸의 값이 어느 층에서 오며, 어디에 어떻게 저장되고, run마다 어떻게 고정되는지를 정한다. 실행 정체·역할별 개수·Operator를 만들고 거두는 일은 lophn-agent/assignments, model catalog와 option은 lophn-agent/harness/model, LOPHN.md 지침은 lophn-agent/instructions, skill·MCP 서버의 등록은 lophn-agent/extensions가 맡는다.

## 요구

### 책임과 범위

**[R1]** agent 정의는 agent 하나의 이름·profile·지침 글과 사람이 바꾼 설정 칸(model, context, 읽을 앱 command, skill·MCP 고르기, 권한)만 가지고 담당 자리의 실행 정체·session·run 상태는 넣지 않는다.
- 이유: 구성과 실행 정체를 중복 정의하지 않고, 정의를 고치거나 지워도 지난 기록의 주체가 바뀌지 않게 한다.
- 확인: 정의를 고치거나 Operator를 지운 뒤에도 그 agent의 지난 session·run이 같은 agent를 가리키고, 정의 글에 진행 중인 일이나 이력이 들어 있지 않은지 본다.
- 의도: lophn-agent#I5

**[R2]** agent는 제품이 정하는 built-in 셋(lophn, Context Engineer, App Engineer)과 사람이 만든 Operator이며, built-in은 이름·역할·기본 지침을 제품이 정하고 사람은 자리마다 바꾼 칸만 덧붙이고, Operator는 이름과 칸 전부를 사람이 정한다.
- 이유: 제품이 지키는 역할과 사람이 필요한 만큼 만드는 일꾼을 구별한다(lophn-agent#I4).
- 확인: built-in은 이름·역할을 바꿀 수도 지울 수도 없고, Operator는 이름을 바꾸고 지울 수 있는지 본다.
- 의도: lophn-agent#I4

**[R3]** agent 정의는 자리(project 또는 앱)마다 lophn app data에 둔 Markdown 글 하나로 저장하고 project 폴더나 앱 폴더에는 쓰지 않는다.
- 이유: 사람이 정했다: 정의는 app data의 자리별 폴더에 두고, project 폴더에는 coding agent도 읽는 파일만 남긴다(LOPHN.md는 lophn-agent/instructions).
- 확인: 같은 project의 Operator 둘이 파일 둘로 app data에 있고, project 폴더와 앱 폴더에서는 정의를 찾을 수 없는지 본다.
- 의도: lophn-agent#I5

**[R4]** 정의 글은 사람이 읽고 고치는 Markdown으로 앞부분에 설정 칸을, 본문에 그 agent의 지침을 쓰며, 저장은 파일 전체를 덮어쓰는 것이고 판(version)은 두지 않는다.
- 이유: 판을 고르고 붙이는 단계를 없애 사람이 고친 값이 다음 run부터 바로 쓰이게 한다.
- 확인: 저장하면 파일이 새 내용으로 바뀌고 이전 판 목록이 없으며, 저장이 중간에 실패해도 이전 파일 전체가 남는지 본다.
- 의도: lophn-agent#I5

**[R5]** Operator의 이름과 지침 본문은 앞뒤 공백을 뺀 1자 이상이어야 하고, 이름은 같은 자리의 Operator 사이에서 앞뒤 공백과 영문 대소문자를 무시해 중복을 거절하며 built-in 이름은 쓰지 못한다.
- 이유: 사람이 목록에서 고를 agent를 빈 이름이나 빈 책임으로 만들지 않고 이름만으로 다른 agent를 가리키지 않게 한다.
- 확인: 공백뿐인 이름·본문, 이미 있는 이름(대소문자만 다름), lophn·Context Engineer·App Engineer라는 이름을 저장할 때 모두 거절되는지 본다.
- 의도: lophn-agent#I4

**[R6]** 지침 본문은 맡는 일·맡지 않는 일·관점·기대 결과를 Markdown 글로 쓰며, 이를 별도 기계 값 칸으로 복제하지 않는다.
- 이유: 관점과 기대 결과는 사람이 읽고 고치는 글이지 기계가 해석하는 칸이 아니다.
- 확인: 저장한 본문 원문을 읽어 책임을 알 수 있고 같은 내용을 가진 다른 칸이 없는지 본다.
- 의도: lophn-agent#I5

**[R7]** 자리에서 부를 수 있는 agent는 project에서는 lophn·Context Engineer·그 project의 Operator, 앱에서는 lophn·그 앱의 App Engineer·그 앱의 Operator이며 목록은 이 규칙으로 만든다.
- 이유: sidebar와 앱 title bar의 agent 목록이 같은 규칙을 쓰고, Context Engineer는 context가 속한 project에서만 부른다.
- 확인: 앱 자리의 목록에 Context Engineer가 없고, 다른 project나 다른 앱의 Operator가 보이지 않으며, 두 자리의 lophn가 각각 그 자리 설정을 쓰는지 본다.
- 의도: lophn-agent#I4

**[R8]** agent 정의의 저장과 삭제는 사람만 하고 agent는 자기 또는 다른 agent의 정의를 만들거나 고치거나 지우지 않는다.
- 이유: 판단과 제안은 agent가, 결정과 허락은 사람이 한다. 정의는 agent가 하는 일의 범위를 정하는 값이다.
- 확인: agent에게 제공하는 tool 중 정의를 쓰거나 지우는 것이 없고, 사람이 editor에서 저장한 뒤에만 정의가 바뀌는지 본다.
- 의도: lophn-agent#I6

### 설정 층

**[R9]** 설정 값은 기본값 < Workspace < 자리(project 또는 앱) < agent 정의 < session 순으로 합치고 위 층이 이긴다.
- 이유: 사람이 전역에서 정한 기본값을 따르게 하고, 자리와 agent와 session이 필요한 칸만 바꾸게 한다.
- 확인: 네 층에 서로 다른 model을 둔 agent는 session의 값을, session 값을 지우면 정의의 값을, 정의 값을 지우면 자리의 값을 쓰는지 본다.
- 의도: lophn-agent#I5

**[R10]** 칸마다 값을 둘 수 있는 층이 정해져 있다. model과 option은 Workspace·자리·agent 정의·session, 지침은 전역·project·앱·agent 정의, skill·MCP의 등록은 Workspace·자리이고 고르기는 agent 정의, 권한은 Workspace 기본·자리 규칙·agent 정의(좁히기만)·session의 이번 허락, profile·context·읽을 앱 command는 agent 정의에만 두며, 허용하지 않은 층에 값을 쓰려 하면 거절한다.
- 이유: 같은 칸을 여러 곳에서 고치게 하면 어느 값이 왜 쓰이는지 알 수 없다.
- 확인: 자리 설정에 context를 쓰거나 session에 profile을 쓰려는 시도가 거절되는지 본다.
- 의도: lophn-agent#I5

**[R11]** agent 정의와 자리 설정은 사람이 바꾼 칸만 저장하고, 비운 칸은 그 층보다 낮은 층(자리, Workspace, 기본값)의 값을 그때그때 따르며 사람은 바꾼 칸을 하나씩 되돌릴 수 있다.
- 이유: 전역·자리 기본값을 바꾸면 값을 바꾼 적 없는 agent가 따라가야 한다.
- 확인: model을 바꾼 적 없는 Operator는 Workspace의 Operator 기본 model을 바꾸면 다음 run부터 새 값을 쓰고, 바꾼 칸을 되돌리면 다시 아래 층을 따르는지 본다.
- 의도: lophn-agent#I5

**[R12]** 화면에서 보이는 모든 설정 값은 어느 층에서 왔는지(기본값, Workspace, 자리, agent 정의, session)를 값과 함께 읽을 수 있다.
- 이유: 사람이 왜 이 model·권한이 쓰이는지 한 줄로 알 수 있어야 값을 고칠 곳을 안다.
- 확인: 값 하나마다 출처가 있고, 정의를 지워 아래 층 값이 쓰이면 출처도 바뀌는지 본다.
- 의도: lophn-agent#I5

### 칸

**[R13]** agent의 profile은 design system의 icon 하나이거나 사람이 올린 이미지(png·jpg·webp, 1 MB 이하, svg는 받지 않음)이며 built-in은 기본 icon을 가진다.
- 이유: 대화 화면과 목록에서 agent를 알아보게 하되 위험한 형식과 큰 파일을 받지 않는다.
- 확인: 1 MB를 넘는 이미지, svg, 지원하지 않는 형식은 거절되고 올린 이미지를 지우면 icon으로 돌아가는지 본다.
- 의도: lophn-agent#I5

**[R14]** model 칸은 provider와 model, 그 model의 option 값을 통째로 고르는 것이며 credential 값·서버 인증·가격표는 넣지 않고, 비우면 아래 층의 값을 따라가고 복사하지 않는다.
- 이유: model 선택의 모양은 lophn-agent/harness/model이 정하고 인증 값은 platform/secrets가 맡으며, 기본값 변경이 모든 agent에 따라가야 한다.
- 확인: Workspace 기본값을 바꾸면 칸이 빈 agent의 다음 run이 새 값을 쓰고 정의 파일에 credential이나 가격이 없는지 본다.
- 의도: lophn-agent#I5

**[R15]** project의 Operator는 그 project의 context를 0개 이상 고르고, 한 context를 여러 Operator가 고를 수 있으며, 0개이면 project 문서만 다루고, 실제로 읽는 것은 고른 context와 현재 접근 허락과 제품이 고정한 역할별 읽기 상한의 교집합뿐이다.
- 이유: Operator가 무엇을 아는지는 사람이 고르고, context 선택이 문서 접근을 넓히지 않는다.
- 확인: 같은 project의 Operator 둘이 서로 다른 context를 읽고, 0개인 Operator는 context 자료 없이 시작하며, 고르지 않은 context와 범위 밖 주소는 거절되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

**[R16]** built-in agent의 context는 선택 칸이 없고 실행할 때 그 자리 project의 active context 전부로 풀리며 보관한 context는 빠지고, project가 없는 앱 자리에서는 context 자료 0개로 시작하되 이유를 밝히며, 다만 App Engineer는 앱 자리에서 그 앱을 app-data source로 읽는 active context를 받는다(→ lophn-agent/roles/app-engineer#R2).
- 이유: 정의가 context id를 적지 않아도 지금 project의 context를 읽게 하고, 빈 채로 남은 이유를 숨기지 않는다.
- 확인: context 둘이 있는 project의 lophn session은 둘 모두를 자료로 받고, 하나를 보관하면 다음 run부터 빠지며, 앱 자리 session은 0개와 그 이유가 보이는지 본다. context 자료의 모양은 lophn-agent/harness/prompt-assemble을 따른다.
- 의도: lophn-agent#I5

**[R17]** 앱 Operator는 앱에 context가 없으므로 읽을 앱 command를 고르고, 호출은 고른 앱·command 쌍 가운데 그 순간 effect가 read이고 confirm이 아니며 사람이 그 앱의 agent 사용을 허락한 것만 허용한다.
- 이유: 앱 Operator가 읽는 자료는 앱 data이고, 이름만 같은 command나 쓰기 command를 실행하지 않는다.
- 확인: 고른 쌍만 호출되고, 고르지 않은 command와 confirm이 필요한 command와 허락을 회수한 앱은 거절되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R18]** skill과 MCP는 등록된 것 가운데 agent가 쓸 것을 고르며 기본은 전부 켜고 끈 것만 정의에 저장하고, 없어졌거나 이름이 바뀐 것은 지우지 않고 표시한다.
- 이유: 새로 등록한 skill·MCP가 agent에 따라오게 하되 사람이 끈 것은 켜지지 않게 한다. 등록과 연결은 lophn-agent/extensions가 맡는다.
- 확인: 새 skill을 등록하면 끈 것이 없는 agent는 바로 쓰고, 끈 skill은 계속 꺼져 있으며, 없어진 skill을 끈 기록이 있어도 저장이 막히지 않는지 본다.
- 의도: lophn-agent#I5

**[R19]** agent 정의는 되돌림을 모르는 외부 MCP tool 가운데 사람이 안전하다고 표시한 tool 목록을 둘 수 있고 그 tool은 lophn-agent/harness/tool-judgment에서 묻지 않으며, 표시는 그 tool 하나에만 적용하고 제품이 고정한 역할 금지·상한·confirm=true를 넓히지 못한다.
- 이유: 안전하다고 본 tool을 매번 묻지 않되 제품 경계를 정의로 풀지 않는다.
- 확인: 표시한 tool은 묻지 않고, 표시하지 않은 미분류 tool은 물으며, Operator의 제품 상한과 confirm=true는 표시로 풀리지 않는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I6

### 권한과 상한

**[R20]** 역할마다 쓸 수 있는 tool의 상한(읽기 범위와 개별 동작)과 금지(코드·shell·임의 파일·웹·브라우저·subagent·secret 직접 읽기·자기 정의 적용·사람 대신 승인)는 제품이 고정하며 정의·자리 설정·session 어느 것으로도 넓히지 못한다.
- 이유: 설정은 사람이 바꾸는 값이고 경계는 제품이 지키는 값이다.
- 확인: 정의에 상한 밖 tool이나 금지된 동작을 넣은 저장이 거절되고, 직접 고친 파일에 있어도 run에 제공되지 않는지 본다.
- 의도: lophn-agent#I6

**[R21]** agent가 실제로 쓰는 tool은 역할 상한과 자리의 권한과 정의의 권한의 교집합이며, 정의는 권한을 자리의 권한보다 넓힐 수 없다.
- 이유: 한 project에서 허락한 것보다 넓은 권한을 그 project의 Operator에게 줄 수 없다.
- 확인: 자리에서 허락하지 않은 동작을 정의에 넣으면 거절되고, 자리의 권한을 좁히면 다음 run부터 Operator의 tool이 줄어드는지 본다.
- 의도: lophn-agent#I6

**[R22]** 권한 칸은 개별 동작의 이름으로 저장하고 묶음 이름이나 wildcard로 저장하지 않으며, 역할 상한에 새 동작이 생겨도 이미 좁혀 둔 정의의 tool은 자동으로 늘지 않는다.
- 이유: 제품 갱신이 사람이 좁힌 권한을 몰래 넓히지 않게 한다.
- 확인: 역할 상한에 동작을 하나 더하면 권한을 좁혀 둔 Operator의 tool은 그대로이고 칸을 비운 agent는 새 동작을 받는지 본다.
- 의도: lophn-agent#I6

**[R23]** 정의의 지침 본문·skill·붙인 지침 파일은 권한·approval·제품 금지·읽기와 결과 상한을 넓히지 못하며 실제 호출은 현재 lophn-agent/harness/tool-judgment 검사를 따른다.
- 이유: 글로 쓴 책임을 권한으로 취급하지 않는다.
- 확인: 범위 밖 tool 요청은 지침에 허용하는 문구가 있어도 거절되는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I6

### 저장 검사

**[R24]** 정의를 저장하거나 읽을 때 칸의 형식·필수 값·이름·지침 본문·context와 앱 command와 skill·MCP 참조·model·권한 상한·profile 형식을 전체 검사하고 하나라도 잘못이면 어느 칸이 왜 틀렸는지 항목별로 알리며 저장은 전체를 거절하고 읽기는 그 agent를 시작하지 않는다.
- 이유: 부분적으로 유효한 agent가 남지 않게 하고, 파일을 직접 고쳐 틀려도 다른 agent는 영향받지 않게 한다.
- 확인: 유효한 지침과 없는 context를 함께 저장하면 아무것도 바뀌지 않고 context 칸이 지목되며, 깨진 파일의 agent만 시작되지 않고 목록에서 이유가 보이는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I6

### resolved agent

**[R25]** run을 시작할 때 층을 합쳐 값마다 출처가 붙은 resolved agent 하나를 만들어 그 run의 기준에 고정하고, 같은 입력에서는 같은 결과가 나오며, 정의가 나중에 바뀌어도 지난 run이 쓴 값을 확인할 수 있다.
- 이유: 한 run 안에서 agent가 중간에 바뀌지 않아야 하고, 나중에 어떤 설정으로 일했는지 되짚을 수 있어야 한다.
- 확인: 같은 파일과 설정으로 두 번 만들면 내용이 같고, run 도중 정의를 고쳐도 그 run은 시작 때 값을 쓰며, 지난 run에서 쓴 값과 출처를 읽을 수 있는지 본다.
- 의도: lophn-agent#I7

**[R26]** 정의를 고쳐도 시작한 run은 바뀌지 않고 다음 run부터 새 값을 쓰며, 이어 하기는 처음 고정한 resolved agent를 그대로 쓰되 현재 권한 회수와 자리 보관은 정의 값을 이유로 미루지 않는다.
- 이유: 진행 중인 일의 책임을 몰래 바꾸지 않되 줄어든 권한은 즉시 막는다.
- 확인: 이어 하는 run이 옛 model과 지침을 쓰고, 그동안 앱의 agent 사용 허락을 회수하면 즉시 막히는지 본다.
- 의도: lophn-agent#I5, lophn-agent#I7

**[R27]** built-in agent의 자리별 설정은 session의 작업 자리로 고른다. 같은 lophn라도 phroner 탭의 session은 phroner의 설정과 그 자리 정의를 쓰고 다른 자리의 설정은 쓰지 않는다.
- 이유: lophn와 Context Engineer는 전역으로 하나지만 사람은 자리마다 다르게 설정한다.
- 확인: 두 project의 lophn session이 각 project의 model과 지침을 쓰고 서로 섞이지 않는지 본다.
- 의도: lophn-agent#I5

**[R28]** 정의와 자리 설정의 저장·삭제는 누가 언제 어느 자리의 어느 agent에서 했는지를 남기며 내용의 전후 이력은 남기지 않는다.
- 이유: 책임의 변경 시점은 알아야 하지만 판을 두지 않는다는 결정(R4)과 맞춘다.
- 확인: 저장·삭제마다 사람·시각·자리·agent가 조회되고 이전 내용을 되돌려 읽는 길은 없는지 본다.
- 의도: lophn-agent#I7

## 열린 질문

lophn-agent/agents#Q1

lophn-agent/agents#Q2

lophn-agent/agents#Q3

lophn-agent/agents#Q4

lophn-agent/agents#Q5

lophn-agent/agents#Q6

lophn-agent/agents#Q7

## 버린 것

이전 lophn-agent/presets 요구를 옮기지 않은 것과 그 이유.

- 제품 기본 preset과 사용자 preset의 구분, 같은 역할 preset을 여러 개 만들고 복사하고 이름 중복을 가리는 요구(presets R3·R9·R10)는 preset을 없애고 agent 정의가 바꾼 칸만 저장하는 모델(R2, R11)로 바뀌어 없앴다.
- 전체 새 판 저장, 과거 내용 복원, 판 고정과 사용 중 assignment에 명시 적용하는 요구(presets R12·R14)는 판(version)을 없애 버렸다. 대신 run마다 resolved agent를 고정한다(R25, R26). 전후 전체 내용과 이유의 보존(presets R13)도 같이 없앴고 저장 시점의 기록만 남긴다(R28).
- capability 묶음을 저장 때 펼쳐 판에 고정하는 요구(presets R7)는 권한 칸을 개별 동작 이름으로 저장하는 요구(R22)로 바꿨다.
- Operator preset에 범위·남길 문서·주기를 결합한 초안을 검토하는 요구(presets R15)는 agent가 Operator를 제안하는 길을 첫 판에서 지워 없앴다. Operator는 사람이 editor에서 만든다(R8, lophn-agent/assignments#R4).
- organizing model(제목·요약용) 선택은 정의에 두지 않고 Workspace의 요약용 model 한 칸으로 바꿨다(presets R6, lophn-agent/harness/model). 공통 기본값을 새 구성에 복사할 후보로만 쓰는 규칙도 기본값을 복사하지 않고 따라가는 규칙으로 바뀌었다(R11, R14).
- context 선택 종류(all·project·app·document·sdk·section)는 Operator의 context 목록과 built-in의 active context 전부로 줄였다(R15, R16; presets R5·R17).
