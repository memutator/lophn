---
type: flow
concerns: [documents/contexts, documents/terms, documents/outline-and-search, lophn-agent/roles/context-engineer, lophn-agent/questions, platform/notifications, shell/workspace, shell/desktop]
---
# 내 폴더의 도메인 구조를 context로 만들어 찾고 지킨다

실험·시나리오·결과처럼 폴더 안에 쌓인 자료에 사람 나름의 구조가 있는데, 그 구조를 매번 직접 찾아다니거나 agent가 추측하게 두기 싫을 때 시작한다. 사람은 무엇을 도와야 하는지, 어느 폴더나 파일을 보는지, 무엇을 찾고 싶은지만 말한다. 파일을 읽고 계약과 선언된 검색을 쓰는 일은 Context Engineer가 맡고, 이후 개체를 계산하고 검색하고 위반을 찾는 일은 program이 같은 규칙으로 한다.

지키는 약속: documents#I3, documents#I4, documents#I6, lophn-agent#I1, lophn-agent#I6, shell#I1.

## 흐름

1. 사람이 project sidebar의 Agents 묶음에서 Context Engineer를 눌러 새 Agent 탭을 연다. 단추나 폼은 없고, 첫 메시지가 무엇을 도와야 하는지·어느 폴더나 파일을 보는지·무엇을 찾고 싶은지를 묻는다. 사람이 세 가지를 말한다. context는 이 project 안에만 두며 Lophn Workspace에는 context 목록도 만들기도 없다. (shell/workspace#R16, shell/workspace#R30, shell/workspace#R34, documents/contexts#R1, shell/desktop#R33)
2. Context Engineer가 사람이 말한 폴더와 파일을 읽는다. 목차와 keyword 검색으로 어디를 볼지 고르고 필요한 section이나 줄 범위만 읽으며, 읽기만 하고 project 폴더에는 아무것도 쓰지 않는다. 다른 project의 파일은 읽지도 가리키지도 않는다. 이 읽기는 사람에게는 보이지 않고 3의 "read" 단계로만 드러난다. (lophn-agent/roles/context-engineer, documents/outline-and-search#R1, documents/outline-and-search#R8, documents/outline-and-search#R12, documents/contexts#R2, documents/contexts#R3)
3. 대화를 시작하면 drafting 상태의 Context 탭이 남는다. 탭은 "drafting · step n of 4"(read ✓ · draft ● · check ○ · apply ○)와 흐린 초안 개체를 보인다. Context Engineer는 초안에 계약(개체 type마다 자료 위치 kind, field, 관계, 검사 규칙, public/private), 선언된 검색, 그 saved view, 예(examples)를 한 묶음으로 쓴다. 정할 수 없는 것이 있어 막히면 Agent 탭에서 사람에게 묻고, 사람이 답할 때까지 그 부분을 정하지 않는다. 초안을 쓰는 동안 이 context에 이미 적용된 판이 있으면 Operator와 사람은 그 판을 계속 쓴다. (shell/workspace#R30, documents/contexts#R5, documents/contexts#R6, documents/contexts#R13, documents/contexts#R15, documents/contexts#R18, documents/contexts#R19, documents/contexts#R28, lophn-agent/questions#R1)
4. Context Engineer가 묶음을 판(r1, r2 …)으로 제출하면 lophn이 그 순간 project 파일의 임시 snapshot에 대해 격리 검사를 한다. 계약이 돌아가는지, 예가 모두 맞는지, 다른 context 참조가 public뿐인지, 모든 saved view가 호출되는지 본다. snapshot에서 나온 위반은 세어서 남기고 사람 파일은 건드리지 않는다. 사람에게는 3의 탭에서 "check" 단계로만 보인다. (documents/contexts#R20, documents/contexts#R22, documents/contexts#R3)
5. 검사를 통과한 묶음은 사람 승인 없이 자동으로 적용된다. 확인 창은 열리지 않고, 이전 판은 남으며 사람이 이전 판으로 되돌릴 수 있다. 탭이 drafting에서 보통 Context 탭이 되고 Contexts 탭의 카드에 이름·목적·다루는 것의 종류 수·적용된 판과 검사 결과·위반 수가 나온다. (documents/contexts#R21, documents/contexts#R22, shell/workspace#R16)
6. 사람이 Context 탭의 Overview에서 context가 다루는 것을 카드(이름·한 줄 뜻·개수·예시 문서)와 "runs on", "graded by" 같은 사람 말 화살표, 아래 Composition 트리로 읽고 맞는지 확인한다. Glossary에서는 Context Engineer가 적은 용어와 뜻을 보고 누가 언제 정했는지 확인하며 뜻을 고치거나 지울 수 있고, Context Engineer는 사람이 정한 항목을 고치지 않는다. Contract는 맨 뒤 하위 탭에 두어 필요할 때만 연다. (shell/workspace#R17, shell/workspace#R18, shell/workspace#R20, shell/workspace#R21, documents/terms#R5, documents/terms#R6, documents/terms#R11)
7. 사람이 Context 탭의 Search에서 선언된 검색 하나를 고르면 Search 탭이 열린다. 입력 form은 선언에서 그려지고(고르는 입력은 타이핑으로 후보를 거르는 combobox, 여럿 고르는 입력은 chip), 결과는 선언대로 표나 board로 나온다. 같은 파일 상태와 입력이면 결과가 같고 25줄 넘으면 page로 이동한다. 결과의 exp-008 같은 도메인 객체는 링크이고 누르면 그 문서를 새 탭으로 연다. (shell/workspace#R22, shell/workspace#R23, shell/workspace#R24, shell/workspace#R25, shell/workspace#R26, documents/contexts#R16, documents/contexts#R17)
8. 사람이 자주 쓰는 입력이면 결과에서 [Save as view]를 눌러 이름을 붙인다. 이후 Search 탭의 Saved views나 접힌 바로 가기 rail의 Saved views에서 고르면 그 입력을 채운 Search 탭이 열리고 결과를 다시 계산한다. 옛 결과의 사본은 남기지 않는다. (shell/workspace#R27, shell/workspace#R32, documents/contexts#R18)
9. 얼마 뒤 사람이든 Operator든 파일을 고쳐서 계약을 어기는 문서가 생긴다. 예를 들어 필수 field가 빠지거나 이름이 pattern에서 벗어난다. lophn은 검색하거나 context를 열기 전에 계약이 가리키는 경로만 다시 가볍게 훑어 개체로 읽을 수 없는 파일과 규칙을 어긴 개체를 위반으로 센다. 파일 변화를 계속 지켜보지는 않는다. 사람에게는 보이지 않는다. (documents/contexts#R23, documents/contexts#R24)
10. 위반 수가 늘면 사람이 notification으로 받는다. toast의 [View]는 그 context의 Context 탭을 Violations 하위 탭으로 연다. 현재 탭과 입력 focus는 뺏기지 않으며, notification만으로 agent의 run이 시작되지 않는다. (documents/contexts#R25, shell/workspace#R29, platform/notifications#R1, platform/notifications#R7, platform/notifications#R12)
11. Violations에서 사람은 줄마다 파일 이름·무엇이 어긋났는지·어긴 규칙 한 줄을 읽는다. Violations에는 agent를 부르는 단추가 없다. Context Engineer에게 넘기려면 10의 계약 위반 toast에서 [Ask Context Engineer]를 눌러 위반 대상이 첫 chip으로 붙은 새 Agent 탭을 열거나 sidebar의 Context Engineer를 열어 말한다. 근거가 chip으로 붙어 사람이 설명을 쓸 필요가 없고, 사람이 보내기 전에는 아무것도 보내지 않는다. (shell/workspace#R19, documents/contexts#R24, documents/contexts#R25, shell/desktop#R35)
12. Context Engineer가 위반의 근거를 읽고 계약이 현실과 어긋난 것이면 계약을 고친 묶음을 새 판으로 제출한다. 그 판도 4의 격리 검사를 통과해야 5처럼 자동으로 적용된다. 파일이 잘못된 것이면 계약을 바꾸지 않고 어느 파일을 어떻게 고쳐야 하는지 Agent 탭에서 사람에게 알린다. 사람이 파일을 직접 고쳐도 되고, 다음에 검색하거나 context를 열 때 다시 훑어 위반이 줄어든다. (documents/contexts#R19, documents/contexts#R20, documents/contexts#R21, documents/contexts#R24, documents/contexts#R28)

## 다른 갈래

- 1에서 사람이 폴더나 목적을 말하지 못하면 Context Engineer가 필요한 만큼만 되묻고 정해지지 않은 채로는 초안을 적용하지 않는다. 대화를 닫거나 답이 없다는 이유로 추천을 확정하지 않는다. (lophn-agent/roles/context-engineer, lophn-agent/questions#R8)
- 4의 검사에서 계약이 돌지 않거나 예가 틀리거나 다른 context의 private를 가리키거나 호출되지 않는 saved view가 있거나 다른 project의 경로가 있으면 그 묶음은 적용되지 않는다. 이미 적용된 판이 있으면 그대로 쓰이고, 없으면 context는 drafting에 남는다. Context Engineer가 이유를 보고 고쳐 새 판을 제출한다. (documents/contexts#R2, documents/contexts#R14, documents/contexts#R19, documents/contexts#R20)
- 4의 snapshot에서 나온 위반은 적용을 막지 않고 세어서 남긴다. 적용 뒤 Violations에서 같은 근거로 본다. (documents/contexts#R20, documents/contexts#R24)
- 계약에 읽기 효과가 아닌 앱 명령이 자료로 들어 있으면 검사에서 거절한다. 앱 명령의 입력과 결과는 계약에도 index에도 저장하지 않는다. (documents/contexts#R12)
- 7에서 선언이 그릴 수 없는 입력 타입을 쓰면 그 검색은 열리지 않고 이유가 나온다. 고치려면 sidebar의 Context Engineer를 연다. 개체로 읽을 수 없는 파일이 있어도 나머지 개체의 검색은 그대로 된다. (shell/workspace#R24, documents/contexts#R24)
- 10에서 위반이 이미 있던 것이면 새 notification을 만들지 않는다. 새로 늘어난 위반만 알린다. 알림을 놓쳤으면 사람이 Contexts 탭의 위반 수나 Violations에서 직접 본다. (documents/contexts#R25, platform/notifications#R4, shell/workspace#R16)
- 12에서 새 판이 마음에 들지 않으면 사람이 Contract의 [History]에서 이전 판으로 되돌린다. 계약의 판일 뿐 project 파일은 바뀌지 않는다. (documents/contexts#R21, documents/contexts#R22, shell/workspace#R21)
- context를 보관하면 검색·위반 알림·Operator preset의 선택 후보에서 빠지고 계약과 판, 용어집은 남는다. 해제하면 이전 계약 그대로 돌아온다. (documents/contexts#R4, documents/terms#R9)
- Context 탭을 여는 길은 하나가 아니다. 사이드바의 Contexts 행, 접힌 바로 가기 rail의 Contexts, 탭 줄 `+`의 Context, Search 탭의 "Open context", 문서 Info의 Contexts, 위반 toast, 상단 검색(Ctrl+K)의 context 이름, Agent 탭 대화 속 context 이름 링크, 1의 drafting 탭이 모두 같은 Context 탭을 연다. (shell/workspace#R15, shell/workspace#R28, shell/workspace#R31, shell/workspace#R32, shell/desktop#R34)
- Operator나 다른 lophn agent는 preset에서 이 context를 읽을 자료로 고른다. context가 Operator의 담당 범위를 만들지는 않고 coding agent는 context에 접근하지 않는다. (documents/contexts#R27, coding-agent/mcp-server#R38)
- 연결이 끊기면 Context 탭과 Search 탭은 마지막 화면과 확인 못한 시각을 유지하고, 작성하던 답과 입력은 보존한다. 재연결 뒤 현재 판과 위반을 다시 읽는다. (shell/desktop#R7, shell/desktop#R8, shell/workspace#R6)

## 끝

사람은 자기 폴더의 구조를 Overview로 읽고, 선언된 검색과 saved view로 필요한 개체를 바로 찾으며, 파일이 계약에서 벗어나면 알림을 받아 Violations에서 읽고 알림의 [Ask Context Engineer]로 Context Engineer에게 넘긴다. 계약과 그 판은 lophn에 있고 project 폴더의 파일은 늘거나 바뀌지 않았다. (documents/contexts#R3, documents/contexts#R16, documents/contexts#R21, documents/contexts#R25)
