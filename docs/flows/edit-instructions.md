---
type: flow
concerns: [lophn-agent/instructions, lophn-agent/agents, shell/desktop, shell/editor, shell/workspace, shell/app-frame]
---
# agent가 읽을 지침을 쓰고 고친다

사람이 lophn agent의 말·판단에 적용할 지침을 쓰거나 고치려 할 때 시작한다. coding agent의 AGENTS.md와 lophn 전용 LOPHN.md는 별개다. 지침은 층이 셋이다. 모든 project에 적용되는 전역 LOPHN.md, project 폴더의 LOPHN.md, 그리고 agent 하나에만 적용되는 agent instructions다.

## 흐름

1. 사람은 고칠 지침의 자리를 고른다. 전역은 Settings › Agents의 "모든 project의 LOPHN.md" 미리보기에서, project는 Agents 탭의 Instructions 구역에서, 앱은 앱 공간 agent select의 Manage에서 [Edit]를 누른다. Operator editor의 Instructions 위쪽 블록에서는 [Edit LOPHN.md]가 같은 project 파일을 연다. (shell/desktop#R50, shell/workspace#R37, shell/workspace#R40, shell/app-frame#R39, lophn-agent/instructions#R9)
2. lophn은 해당 LOPHN.md를 문서 editor 탭으로 열고 파일이 없으면 빈 초안만 보여 준다. 전체 경로는 기본 화면에서 숨긴다. 저장 전에는 새 지침이 적용되지 않는다. (lophn-agent/instructions#R2, shell/editor#R17)
3. 사람은 Markdown을 쓰고 저장한다. 파일이 없었다면 이 저장이 파일을 만든다. 판(version)이나 이력은 두지 않고 파일 자체가 정본이다. 저장은 사람의 명시 편집이어야 하며 agent가 제안한 글은 사람이 선택·편집·저장하기 전에는 적용되지 않는다. (lophn-agent/instructions#R1, lophn-agent/instructions#R2, lophn-agent/instructions#R3)
4. agent 하나에만 적용할 지침은 Agents 탭의 그 agent editor에서 Instructions 위쪽 project 블록 아래 편집기에 쓰고 [Save]한다. 저장은 그 agent 정의 파일을 새 내용으로 덮어쓰는 일이고 확인 창은 없다. 본문이 빈 Operator는 저장할 수 없다. 사람에게는 정의 저장이 보이지 않는다. (shell/workspace#R38, shell/workspace#R40, lophn-agent/agents#R4, lophn-agent/agents#R5, lophn-agent/agents#R6)
5. lophn은 각 call 직전 현재 작업 자리의 전역→project→app→agent instructions 순서로 파일을 다시 읽는다. 고친 지침은 진행 중 run의 다음 call부터 읽는다. 조립은 사람에게는 보이지 않는다. (lophn-agent/instructions#R4, lophn-agent/instructions#R5, lophn-agent/instructions#R8)

## 다른 갈래

- App Engineer는 담당 앱, Operator는 붙은 project/app이 작업 자리다. lophn·Context Engineer는 세션을 연 곳을 유지하며 보는 탭 전환은 작업 자리 변경이 아니다. (lophn-agent/instructions#R4)
- 파일당 32 KiB·call 전체 128 KiB를 넘거나 인코딩/읽기 오류가 있으면 그 call을 차단해 고칠 행동을 알린다. 부재와 읽기 실패를 섞거나 잘라 보내지 않는다. (lophn-agent/instructions#R7)
- 지침은 제품 금지·scope·approval·읽기 상한을 넓히지 않는다. 읽은 자료 속의 LOPHN 파일도 현재 작업 자리의 지침이 되지 않는다. (lophn-agent/instructions#R6, lophn-agent/agents#R23)
- agent는 LOPHN.md나 agent instructions를 직접 만들거나 고치지 않고 question으로 제안만 한다. (lophn-agent/instructions#R3, lophn-agent/agents#R8)
- 4에서 [Cancel]을 누르면 고친 글을 버리고, 지침 외 칸이 틀려 저장이 거절되면 이전 파일이 그대로 남는다. (shell/workspace#R38, lophn-agent/agents#R24)

## 끝

사람은 저장한 파일과 다음 call이 읽을 현재 지침을 안다. 지침을 바꿔도 별도 권한·사람 결정의 경계는 그대로다. (lophn-agent/instructions#R6, lophn-agent/instructions#R8)
