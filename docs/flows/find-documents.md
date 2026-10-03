---
type: flow
concerns: [documents/outline-and-search, documents/versions, documents/formats, documents/addressing, documents/projects, platform/identity, platform/redaction, shell/desktop, shell/workspace, lophn-agent/harness/prompt-assemble, coding-agent/mcp-server, coding-agent/cli]
screens: [documents, document]
---
# 필요한 문서의 필요한 부분만 찾는다

사람이나 사람이 시킨 agent가 쌓인 자료에서 근거를 찾는다. 전체 본문부터 읽지 않고, 목적에 맞는 목록과 목차에서 필요한 부분으로 들어간다.

지키는 약속: documents#I4, documents#I2, coding-agent#I3, lophn-agent/harness#I3, shell#I1.

## 흐름

1. **[screen: documents]** 사람이 검색어를 입력하고 필요하면 프로젝트·앱·context·format 조건으로 좁힌다. 목록에는 문서 제목과 맞는 부분의 짧은 근거를 보고, 본문은 열기 전까지 읽지 않는다. 자리 없는 문서도 제목으로 찾는다. (shell/desktop#R1, shell/desktop#R28, documents/outline-and-search#R1, documents/outline-and-search#R12, documents/addressing#R3)
2. **[screen: documents]** 반복해서 찾는 조건이면 사람이 saved view로 이름 붙여 저장하거나 기존 saved view를 연다. lophn은 열 때마다 현재 허용된 문서를 저장 조건으로 다시 찾으며 옛 목록의 문서 사본을 만들지 않는다. (documents/outline-and-search#R23, documents/outline-and-search#R24, documents/outline-and-search#R25)
3. **[screen: document]** 사람이 찾은 문서를 열어 목차에서 필요한 section을 고르고, 부족할 때만 자식 section이나 다음 본문 범위로 이어 읽는다. 이어 읽는 동안 같은 고정 판을 유지하고 최신 판이 따로 있으면 구별한다. (documents/outline-and-search#R1, documents/outline-and-search#R7, documents/outline-and-search#R8, shell/workspace#R1)
4. **[screen: document]** 옛 참조나 지정한 판을 열었으면 당시 내용과 작성 주체·시각을 확인한다. 이름이나 자리가 바뀐 옛 참조는 같은 문서로 안내하고, 지정한 section이 없으면 비슷한 내용으로 대신 연결하지 않는다. (documents/versions#R6, documents/versions#R8, documents/addressing#R5, documents/addressing#R6, documents/addressing#R7)
5. agent가 같은 근거를 찾을 때 lophn은 제목·목차·검색·section·추가 읽기마다 현재 허용 범위를 검사하고 외부 반환과 model 입력 전에 redaction한다. 프로젝트의 실제 파일 경로나 원본 파일 통로를 근거 읽기 권한으로 넓히지 않는다. 사람에게는 보이지 않는다. (platform/identity#R8, platform/identity#R9, platform/redaction#R5, documents/projects#R9, coding-agent/mcp-server#R30)
6. coding agent는 MCP나 CLI로 목차·검색에서 고정 판의 section과 범위를 읽고, lophn agent의 model 입력은 목차·요약과 필요한 section으로 조립한다. 잘린 자료는 이어 읽기 위치와 함께 전달하고 전체를 읽었다고 하지 않는다. 사람에게는 보이지 않는다. (coding-agent/mcp-server#R8, coding-agent/mcp-server#R10, coding-agent/cli#R11, coding-agent/cli#R12, lophn-agent/harness/prompt-assemble#R4, lophn-agent/harness/prompt-assemble#R18, documents/outline-and-search#R7)
7. **[screen: documents]** 또는 **[screen: document]**에서 사람이 결과 판단에 영향을 주는 검색 지연·누락·잘린 범위를 확인하고, 이어 읽거나 선택한 판을 직접 연다. 원문은 읽을 수 있는데 검색에 아직 없다는 사실을 문서가 없다는 뜻으로 쓰지 않는다. (documents/outline-and-search#R5, documents/outline-and-search#R14, documents/outline-and-search#R15)

## 다른 갈래

- 검색이 비어 있으면 **[screen: documents]**에서 조건을 바꾸거나 보관 문서 포함 여부를 확인한다. 기본 검색의 보관 문서 제외와 색인 지연을 원본 부재로 결론 내리지 않는다. (documents/outline-and-search#R14, documents/outline-and-search#R17, documents/outline-and-search#R23)
- 선택한 section이 없는지, format이 section을 지원하지 않는지, 추출을 아직 확인하지 못했는지 구별한다. **[screen: document]**에서 가능한 원문 읽기와 실패 이유를 확인하며 유사 section으로 대신 가지 않는다. (documents/outline-and-search#R22, documents/formats#R20, documents/addressing#R5)
- 이어 읽기 기준을 유지할 수 없으면 충돌로 멈추고 새 조건으로 조회한다. 최신 판의 일부와 옛 판의 일부를 같은 근거처럼 이어 붙이지 않는다. (documents/outline-and-search#R8, documents/outline-and-search#R9)
- agent에게 허용되지 않은 자료는 제목·존재·개수까지 결과에서 제외한다. 다른 앱 범위 대상은 안전한 부재 응답으로 처리하고, 자격 없음과 금지 동작을 정해진 범위 안에서 구별한다. 사람에게는 보이지 않는다. (platform/identity#R8, platform/identity#R10, coding-agent/mcp-server#R30)
- redaction에 실패하면 원문 반환을 중단하고 빠진 범위와 안전한 이유만 전달한다. 부족한 근거를 성공한 읽기로 채우지 않는다. 사람에게는 보이지 않는다. (platform/redaction#R14)
- 연결이 끊기면 **[screen: documents]** 또는 **[screen: document]**에서 마지막 화면과 확인 시각을 유지하고 최신 결과를 확인하지 못했음을 알린다. 재연결하면 현재 기록을 다시 확인한다. (shell/desktop#R7)
- 사람이 더 읽지 않고 닫아도 saved view나 고정 판은 사라지지 않는다. 탭의 읽던 위치 복원과 문서 판 보존은 서로 다른 일이다. (shell/workspace#R6, documents/versions#R2)

## 끝

사람과 agent가 필요한 부분의 고정 근거에 닿고, 어느 판을 읽었고 무엇은 아직 읽지 못했는지 구별한다. 목록·목차·선택 section만으로 충분하면 전체 본문은 읽지 않는다. (documents/outline-and-search#R7, documents/outline-and-search#R8, documents/versions#R8)
