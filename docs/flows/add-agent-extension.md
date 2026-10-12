---
type: flow
concerns: [lophn-agent/extensions, lophn-agent/agents, lophn-agent/commands, platform/secrets, shell/desktop, shell/workspace, shell/app-frame]
---
# agent가 쓸 skill과 MCP를 고른다

사람이 agent에 skill이나 외부 MCP를 더하려 할 때 시작한다. 등록과 고르기는 다른 일이다. 등록은 전역(Settings › Agents)이나 자리(project의 Agents 탭, 앱의 Manage)에서 하고, 어떤 agent가 쓸지는 그 agent의 editor에서 정한다. 확장 발견·인증·선택·실제 사용은 서로 다른 단계다.

## 흐름

1. 사람은 등록할 층을 고른다. 모든 자리에서 쓸 것은 Settings › Agents의 [Add skill]·[Add server]로, 한 project나 앱에서만 쓸 것은 그 project의 Agents 탭이나 앱 Manage의 Skills·MCP servers 구역에서 같은 단추로 등록한다. 자리에 등록한 것은 그 자리에서 여는 agent에게만 보인다. (shell/desktop#R50, shell/workspace#R37, shell/app-frame#R39, lophn-agent/extensions#R32)
2. skill은 사람이 준비한 로컬 skill 폴더를 등록한다. lophn은 정한 폴더와 바로 아래 꾸러미만 검사하고 형식·이름·중복·출처를 구별한다. 검색 과정은 사람에게는 보이지 않는다. 원격 검색·자동 다운로드는 하지 않는다. (lophn-agent/extensions#R1, lophn-agent/extensions#R2, lophn-agent/extensions#R3, lophn-agent/extensions#R10)
3. 외부 MCP는 사람이 server 이름·stdio 또는 Streamable HTTP·enabled·정확한 실행/목적지와 인증 방식을 정한다. 원문 credential은 보호 입력과 keychain에서만 처리한다. skill이나 응답에서 설정을 수입하지 않는다. (lophn-agent/extensions#R11, lophn-agent/extensions#R12, lophn-agent/extensions#R13, platform/secrets#R11)
4. agent editor의 Skills·MCP servers 칸은 그 자리에서 쓸 수 있는 것을 모두 켠 채로 이름과 함께 보인다. 사람은 이 agent가 쓰지 않을 skill·MCP server(그리고 MCP는 개별 tool)만 끈다. 새 agent는 처음에 모두 켜져 있고, 나중에 등록한 skill과 server도 끈 적 없는 agent에게는 따라온다. (shell/workspace#R43, lophn-agent/agents#R18, lophn-agent/extensions#R4, lophn-agent/extensions#R30, lophn-agent/extensions#R31)
5. 사람이 [Save]하면 확인 창 없이 끈 것만 정확한 이름(MCP는 server와 원래 tool 쌍)으로 정의에 저장한다. 생략이나 빈 목록은 끈 것이 없다는 뜻이다. 저장은 다음 run부터 적용되고 진행 중인 run은 시작할 때 고른 skill을 그대로 쓴다. 검사는 사람에게는 보이지 않는다. (shell/workspace#R38, lophn-agent/agents#R26, lophn-agent/extensions#R8, lophn-agent/extensions#R30, lophn-agent/extensions#R31)
6. 다음 run은 켜 둔 skill의 이름·설명과 개별 tool을 쓰고 skill 본문은 agent가 이름으로 읽을 때만 읽는다. 실제 tool 호출은 현재 역할 상한·자리의 권한·approval·제품 금지를 다시 검사한다. 사람은 결과·필요한 다음 행동만 본다. (lophn-agent/extensions#R5, lophn-agent/extensions#R6, lophn-agent/agents#R21, lophn-agent/agents#R23)
7. 사람이 agent 대화에서 `/`를 치면 Skills 묶음에 그 agent가 쓸 수 있는 skill이 전부 출처 구분 없이 보인다. 끈 skill은 보이지 않는다. (lophn-agent/commands#R7)

## 다른 갈래

- skill 본문·보조 자료·MCP server 응답은 tool 추가·권한·사람 결정의 근거가 아니다. 밖 symlink·실행 파일은 읽기/실행 허락으로 승격하지 않는다. (lophn-agent/extensions#R7, lophn-agent/extensions#R9, lophn-agent/agents#R23)
- 전역과 자리에 같은 이름의 MCP server를 등록하려 하면 거절한다. 같은 이름의 skill은 자리의 것이 쓰이고 전역의 것은 가려졌다고 알린다. (lophn-agent/extensions#R33)
- 선택 skill 누락·변경·server 연결 실패는 알려 주고 다른 skill/tool로 조용히 대신하지 않는다. 없어진 skill을 끈 기록이 있어도 저장은 막히지 않고 그 skill이 다시 나타나도 끈 채로 둔다. (lophn-agent/extensions#R8, lophn-agent/extensions#R30, lophn-agent/agents#R18)
- 되돌림을 모르는 외부 MCP tool은 external로 보고 묻는다. 사람이 agent 정의에서 그 tool 하나를 안전하다고 표시하면 묻지 않지만, 제품이 고정한 역할 금지·상한은 넓어지지 않는다. (lophn-agent/extensions#R28, lophn-agent/agents#R19)
- 인증 실패·keychain 잠김은 원문 파일 fallback 없이 해당 연결을 못 쓰는 상태로 남긴다. secret은 model에 보내지 않는다. (platform/secrets#R8, platform/secrets#R11)

## 끝

사람은 어떤 agent가 어떤 skill/MCP를 쓰는지와 현재 실패·필요한 행동을 안다. 확장을 넣어도 제품 금지·읽기 상한·approval은 넓어지지 않는다. (lophn-agent/agents#R23, lophn-agent/extensions#R31)
