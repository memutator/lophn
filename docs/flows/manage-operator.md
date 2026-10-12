---
type: flow
concerns: [lophn-agent/agents, lophn-agent/assignments, lophn-agent/instructions, lophn-agent/harness/run-loop, shell/workspace]
---
# Operator를 고치거나 지운다

사람이 project의 Operator 설정을 바꾸거나 더 쓰지 않는 Operator를 지우려 할 때 시작한다. Operator는 멈췄다 다시 시작하는 것이 아니다. 쓰는 동안은 그대로 두고, 그만 쓰려면 지운다.

## 흐름

1. project의 Agents 탭 사람은 Operator 카드의 [Open]을 눌러 같은 탭 안에 editor를 연다. 카드는 avatar·이름·Operator·model·"n contexts · n skills · n MCP"를 보이고 일정이나 마지막 실행 줄은 없다. (shell/workspace#R36, shell/workspace#R38)
2. Operator editor 사람은 Profile·Name·Instructions·Model·Contexts·Skills·MCP servers·Permissions 가운데 고칠 칸을 바꾼다. 바꾼 칸에는 Changed가 붙고 [Reset]을 누르면 그 칸이 비워져 위 층의 기본값을 다시 따라간다. 그 층의 값이 바뀌면 비운 칸은 따라 바뀐다. (shell/workspace#R41, lophn-agent/agents#R11, lophn-agent/agents#R12)
3. 사람은 [Save]를 눌러 확인 창 없이 저장하거나 [Cancel]로 고친 값을 버리고 목록으로 돌아간다. lophn은 전체를 검사해 모두 맞을 때만 정의 파일 전체를 새 내용으로 덮어쓴다. 판(version)이나 이전 내용 목록은 없고, 저장한 사람·시각·자리·agent만 남는다. 검사와 저장은 사람에게는 보이지 않는다. (shell/workspace#R38, lophn-agent/agents#R4, lophn-agent/agents#R24, lophn-agent/agents#R28)
4. 시작한 run과 이어 하는 session은 처음 고정한 값을 그대로 쓰고 새 값은 다음 run부터 쓴다. project의 LOPHN.md나 이 Operator의 instructions는 진행 중 run의 다음 call부터 읽는다. 이름을 바꿔도 지난 session·run은 같은 Operator 아래에 남는다. 사람에게는 보이지 않는다. (lophn-agent/agents#R26, lophn-agent/assignments#R17, lophn-agent/assignments#R18, lophn-agent/instructions#R8)
5. 사람은 editor 맨 아래의 [Delete Operator](휴지통 icon)를 누르고 확인을 한 번 한다. lophn은 이 Operator의 assignment를 거두고 정의를 지운다. 열린 session은 닫히고 지난 대화·run·만든 문서는 남으며, 거둔 Operator는 지난 대화를 읽을 수만 있고 새 입력을 받지 않는다. 카드와 sidebar 줄이 사라진다. (shell/workspace#R34, shell/workspace#R38, lophn-agent/assignments#R9, lophn-agent/assignments#R16)
6. 다시 맡기려면 사람이 flow/set-up-operator로 새 Operator를 만든다. 거둔 Operator를 다시 켜는 길은 없다. (lophn-agent/assignments#R9)

## 다른 갈래

- lophn·Context Engineer 카드의 [Open]도 같은 editor를 열지만 Name은 고정 글자이고 Contexts 칸이 없으며 Instructions에는 읽기 전용 "Built-in instructions"가 더해진다. 지우는 길이 없다. (shell/workspace#R44, lophn-agent/agents#R2, lophn-agent/assignments#R9)
- 3에서 이름이 같은 자리의 다른 Operator나 built-in 이름과 겹치거나 비었으면, 또는 권한이 자리의 권한보다 넓으면 어느 칸이 왜 틀렸는지 알리고 저장 전체를 거절해 이전 파일이 그대로 남는다. (lophn-agent/agents#R5, lophn-agent/agents#R21, lophn-agent/agents#R24)
- 3에서 사람이 정의 파일을 직접 고쳐 틀리게 하면 그 Operator만 시작되지 않고 목록에서 이유가 보인다. (lophn-agent/agents#R24)
- 4에서 앱 권한을 회수하거나 자리를 보관하면 정의 값을 이유로 미루지 않고 즉시 막는다. 담당 project나 app이 보관되면 machine이 그 Operator의 새 일을 막는다. (lophn-agent/agents#R26, lophn-agent/assignments#R14)
- 5에서 확인을 취소하면 아무것도 지우지 않는다. 일하는 도중에 지우면 새 model·tool 호출을 막고 가능한 진행 호출에 취소를 요청하며 이미 생긴 효과를 취소 성공이라고 하지 않는다. (shell/workspace#R38, lophn-agent/harness/run-loop#R25)
- Pause·Resume 단추는 없다. 일시 멈춤은 담당 자리의 보관에 따라 machine이 하는 것뿐이다. (lophn-agent/assignments#R14)

## 끝

사람이 고친 값이 저장돼 있고 다음 run부터 쓰이거나, 지운 Operator가 목록에서 사라지고 지난 대화만 남아 있다. 어느 쪽이든 정의의 이전 내용은 되돌려 읽을 수 없다. (lophn-agent/agents#R4, lophn-agent/assignments#R9)
