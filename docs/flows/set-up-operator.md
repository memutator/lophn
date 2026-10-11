---
type: flow
concerns: [lophn-agent/agents, lophn-agent/assignments, lophn-agent/instructions, lophn-agent/extensions, lophn-agent/harness/model, shell/workspace, shell/app-frame]
---
# 맡길 일에 Operator를 만든다

사람이 project나 app에서 자기 방식으로 일할 agent를 더 두려 할 때 시작한다. Operator는 사람이 editor에서 직접 만들고 사람이 부를 때 일한다. 주기도 남길 문서도 없다. Operator는 원하는 만큼 만들며 읽을 context와 일을 맡긴 project/app은 별개다.

## 흐름

1. project의 Agents 탭 사람은 카드 목록 아래의 [+ New Operator]를 눌러 같은 탭 안에 editor를 연다. 목록에는 lophn·Context Engineer 카드와 이 project의 Operator 카드가 있다. (shell/workspace#R36, shell/workspace#R38, lophn-agent/assignments#R2)
2. Operator editor 사람은 Profile에서 icon을 고르거나 이미지를 올리고 Name을 쓴다. 이름은 같은 project의 Operator 사이에서 겹치지 않고 lophn·Context Engineer·App Engineer라는 built-in 이름을 쓰지 못한다. (shell/workspace#R39, lophn-agent/agents#R13, lophn-agent/agents#R5)
3. Instructions 칸에는 위에 이 project의 LOPHN.md가 읽기 전용 블록으로 보이고 그 아래에 이 Operator만의 instructions 편집기가 있다. 사람은 맡는 일·맡지 않는 일·관점·기대 결과를 글로 쓴다. 사람은 "The agent reads project instructions first, then these."를 보고 project 지침을 고치려면 [Edit LOPHN.md]로 그 파일의 문서 탭을 연다. (shell/workspace#R40, lophn-agent/agents#R6, lophn-agent/instructions#R5, lophn-agent/instructions#R9)
4. Model 칸을 비워 두면 project와 Workspace에서 상속하는 model과 그 출처가 한 줄로 보인다. 사람이 model을 고르면 그 model이 가진 option 값만 보이고, 바꾼 칸에는 Changed와 [Reset]이 붙는다. 바꾼 칸만 저장되고 나머지는 위 층의 기본값을 따라간다. (shell/workspace#R41, lophn-agent/agents#R9, lophn-agent/agents#R11, lophn-agent/agents#R12, lophn-agent/agents#R14, lophn-agent/harness/model#R21)
5. Contexts 칸에서 사람은 [+ Add context]로 이 project의 context를 0개 이상 붙인다. 한 context를 여러 Operator가 붙일 수 있고, 0개이면 "No contexts. This operator works with project documents only."가 보인다. 읽는 자료는 붙인 context와 현재 접근 허락의 교집합이다. (shell/workspace#R42, lophn-agent/agents#R15)
6. Skills와 MCP servers 칸은 이 project에서 쓸 수 있는 것을 모두 켠 채로 보이고 사람은 쓰지 않을 것만 끈다. Permissions 칸은 "Can't be wider than the project's permissions."를 밝히며 project 권한보다 넓은 선택지를 고를 수 없다. (shell/workspace#R43, lophn-agent/agents#R18, lophn-agent/agents#R21, lophn-agent/extensions#R30, lophn-agent/extensions#R31)
7. 사람은 [Save]를 누른다. 확인 창은 없다. lophn은 형식·이름·지침 본문·context·skill·MCP·model·권한 상한을 전체 검사해 모두 맞을 때만 정의를 lophn의 app data에 저장하고 이 Operator의 assignment 하나를 만든다. 저장한 사람·시각·자리를 남긴다. 검사와 저장은 사람에게는 보이지 않는다. (shell/workspace#R38, lophn-agent/agents#R3, lophn-agent/agents#R24, lophn-agent/agents#R28, lophn-agent/assignments#R4)
8. Agents 탭 목록에 Operator 카드가 생기고 project sidebar의 Agents 묶음에 줄이 생긴다. 사람은 줄이나 [Open]으로 부르고, 새 session에서 말을 걸어 일을 시킨다. 정의는 다음 run부터 쓰인다. (shell/workspace#R34, shell/workspace#R36, lophn-agent/agents#R7, lophn-agent/assignments#R15, lophn-agent/assignments#R17)

## 다른 갈래

- 앱의 Operator는 앱 공간 title bar의 agent select에서 Manage를 열어 같은 editor로 만든다. 앱에는 context가 없으므로 Contexts 칸 대신 App data 칸에서 읽을 앱 command를 고른다. 고른 앱·command 쌍 가운데 그때 effect가 read이고 confirm이 아니며 사람이 그 앱의 agent 사용을 허락한 것만 호출된다. (shell/app-frame#R37, shell/app-frame#R39, lophn-agent/agents#R17)
- 2에서 빈 이름·빈 지침 본문, 같은 자리의 이미 있는 이름(대소문자만 달라도), built-in 이름은 저장을 거절한다. 받을 수 없는 이미지(1 MB 초과, svg, 지원하지 않는 형식)는 저장되지 않고 이유가 보인다. (lophn-agent/agents#R5, lophn-agent/agents#R13, shell/workspace#R39)
- 6~7에서 역할 상한 밖 tool이나 자리의 권한보다 넓은 권한을 넣으면 어느 칸이 왜 틀렸는지 알리고 저장 전체를 거절한다. 지침 글이나 skill 본문에 권한을 넓히는 문구가 있어도 실제 호출은 현재 판정을 따른다. (lophn-agent/agents#R20, lophn-agent/agents#R21, lophn-agent/agents#R23, lophn-agent/agents#R24)
- 7 전에 사람이 [Cancel]을 누르면 고친 값을 버리고 목록으로 돌아간다. 아무것도 저장되거나 만들어지지 않는다. (shell/workspace#R38)
- agent는 Operator 정의나 assignment를 만들거나 고치지 않는다. agent가 필요하다고 말하면 사람이 이 흐름으로 직접 만든다. (lophn-agent/agents#R8, lophn-agent/assignments#R4)
- 정의 파일을 직접 고쳐 틀리게 만들면 그 Operator만 시작되지 않고 목록에서 이유가 보인다. 다른 agent는 영향받지 않는다. (lophn-agent/agents#R24)

## 끝

Agents 탭에 새 Operator 카드(avatar·이름·Operator·model·"n contexts · n skills · n MCP")가 보이고 일정이나 마지막 실행 줄은 없다. 정의는 project 폴더가 아니라 lophn에 저장돼 있다. (shell/workspace#R36, shell/workspace#R37, lophn-agent/agents#R3)
