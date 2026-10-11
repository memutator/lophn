---
type: flow
concerns: [documents/outline-and-search, documents/contexts, documents/versions, documents/formats, documents/addressing, documents/projects, platform/identity, platform/redaction, shell/desktop, shell/workspace]
---
# 필요한 문서의 필요한 부분만 찾는다

사람이나 사람이 시킨 agent가 쌓인 자료에서 근거를 찾는다. 전체 본문부터 읽지 않고, 단어로 훑거나 context의 선언된 검색을 거쳐 목차에서 필요한 부분으로 들어간다.

지키는 약속: documents#I3, documents#I4, documents#I1, lophn-agent/harness#I3, shell#I1.

## 흐름

1. project 화면에서 사람이 상단 검색(돋보기·Ctrl+K)의 명령 팔레트에 검색어를 친다. lophn은 색인 없이 그때 project의 md 파일을 훑어 검색어가 본문이나 제목에 그대로 든 곳을 찾는다. 필요하면 폴더 하나로 좁힌다. 결과는 파일 경로·section·제목·일치한 부분의 짧은 snippet이고, 한 번에 50개씩 이어 본다. 본문은 열기 전까지 읽지 않는다. 별도 Documents 화면은 없다. (shell/desktop#R34, shell/desktop#R30, documents/outline-and-search#R12, documents/outline-and-search#R13, documents/outline-and-search#R14, documents/outline-and-search#R15, documents/outline-and-search#R16)
2. 찾는 것이 실험·시나리오처럼 계약이 정한 개체이면 사람이 Search 탭에서 context의 선언된 검색을 고르고 입력을 채운다. 반복해서 찾는 조건이면 결과에서 [Save as view]로 이름을 붙이고, 이후 Saved views에서 고르면 그 입력을 채운 Search 탭이 열려 결과를 다시 계산한다. 옛 결과의 사본은 만들지 않는다. 단어 검색과 선언된 검색은 서로 다른 입구다. (shell/workspace#R23, shell/workspace#R27, shell/desktop#R34, documents/contexts#R16, documents/contexts#R18)
3. 문서 탭에서 사람이 찾은 문서를 열어 목차에서 필요한 section을 고르고, 부족할 때만 자식 section이나 다음 본문 범위로 이어 읽는다. 목차는 파일을 읽을 때마다 계산하므로 방금 고친 내용이 바로 보이고, 이어 읽는 위치는 그 시점의 파일 내용에 묶인다. (documents/outline-and-search#R1, documents/outline-and-search#R7, documents/outline-and-search#R8, documents/outline-and-search#R10, shell/workspace#R1)
4. document 화면 옛 참조나 지정한 판을 열었으면 당시 내용과 작성 주체·시각을 확인한다. 이름이나 자리가 바뀐 옛 참조는 같은 문서로 안내하고, 지정한 section이 없으면 비슷한 내용으로 대신 연결하지 않는다. (documents/versions#R6, documents/versions#R8, documents/addressing#R5, documents/addressing#R6, documents/addressing#R7)
5. agent가 같은 근거를 찾을 때 lophn은 제목·목차·검색·section·추가 읽기마다 현재 허용 범위를 검사하고 외부 반환과 model 입력 전에 redaction한다. 프로젝트의 실제 파일 경로나 원본 파일 통로를 근거 읽기 권한으로 넓히지 않는다. 사람에게는 보이지 않는다. (platform/identity#R8, platform/identity#R9, platform/redaction#R5, documents/projects#R9, documents/outline-and-search#R19)
6. lophn agent는 목차·검색과 context의 선언된 검색으로 필요한 section과 범위만 읽는다. 한 번에 최대 12,000 codepoint까지 주고 잘린 자료는 이어 읽을 위치와 함께 전달하며 전체를 읽었다고 하지 않는다. coding agent는 문서·검색·context 읽기 tool을 받지 않는다. 사람에게는 보이지 않는다. (documents/outline-and-search#R7, documents/outline-and-search#R8, documents/contexts#R16, documents/contexts#R27, coding-agent/mcp-server#R38)
7. 단어 검색과 Search 탭에서 사람이 결과에 영향을 주는 건너뛴 파일과 잘린 범위를 확인하고, 이어 보거나 직접 파일을 연다. 읽을 수 없거나 형식이 맞지 않아 건너뛴 파일이 있으면 그 수와 이유가 결과와 함께 나오고, 빈 결과를 문서가 없다는 뜻으로 쓰지 않는다. (documents/outline-and-search#R15, documents/outline-and-search#R16, documents/outline-and-search#R18, documents/contexts#R17)

## 다른 갈래

- 단어 검색이 비어 있으면 검색어나 좁힌 폴더를 바꿔 본다. `.gitignore`가 제외한 경로와 숨은 폴더는 훑지 않으므로 거기 있는 파일은 나오지 않고, 건너뛴 파일의 수와 이유가 있으면 그것부터 본다. 검색은 md 파일만 훑고 부분 문자열 일치이며 대소문자를 구분하지 않는다. (documents/outline-and-search#R12, documents/outline-and-search#R13, documents/outline-and-search#R14, documents/outline-and-search#R18)
- 선택한 section이 없는지, 파일을 읽지 못하는지, 형식이 section을 지원하지 않는지를 서로 다르게 알린다. 비슷한 section으로 대신 가지 않는다. (documents/outline-and-search#R3, documents/outline-and-search#R9, documents/formats#R20)
- 이어 읽기 중 파일이 바뀌었거나 조건이 다르면 이어 읽기를 거절하고 다시 읽게 한다. 바뀐 파일의 일부와 옛 내용의 일부를 같은 근거처럼 이어 붙이지 않는다. (documents/outline-and-search#R10)
- 선언된 검색이 그릴 수 없는 입력 타입을 쓰면 Search 탭은 그 검색을 열지 않고 이유를 보인다(고치려면 sidebar의 Context Engineer를 연다). 결과는 같은 파일 상태와 입력이면 같고, 개체로 읽을 수 없는 파일이 있어도 나머지 개체의 검색은 그대로 된다. (shell/workspace#R24, documents/contexts#R17, documents/contexts#R24)
- 보관한 context의 선언된 검색은 목록에서 빠진다. 해제하면 이전 계약 그대로 돌아온다. (documents/contexts#R4)
- project 폴더 밖을 가리키는 경로나 symlink는 목차와 부분 읽기에서 거절한다. agent에게 허용되지 않은 자료는 제목·존재·개수까지 결과에서 제외하고, 다른 앱 범위 대상은 안전한 부재 응답으로 처리한다. 사람에게는 보이지 않는다. (documents/outline-and-search#R11, platform/identity#R8, platform/identity#R10)
- redaction에 실패하면 원문 반환을 중단하고 빠진 범위와 안전한 이유만 전달한다. 부족한 근거를 성공한 읽기로 채우지 않는다. 사람에게는 보이지 않는다. (platform/redaction#R14)
- 연결이 끊기면 project 화면과 Search 탭은 마지막 화면과 확인 시각을 유지하고 최신 결과를 확인하지 못했음을 알린다. 재연결하면 현재 기록을 다시 확인한다. (shell/desktop#R7)
- 사람이 더 읽지 않고 닫아도 saved view는 사라지지 않는다. 다시 열면 읽던 위치와 Search 탭의 선택한 검색과 채운 입력이 복원되지만 검색 결과는 저장하지 않고 다시 계산한다. (shell/workspace#R6, shell/workspace#R8, documents/contexts#R18)

## 끝

사람과 agent가 필요한 부분의 근거에 닿고, 무엇을 읽었고 무엇은 건너뛰었거나 아직 읽지 못했는지 구별한다. 목록·목차·선택 section만으로 충분하면 전체 본문은 읽지 않는다. (documents/outline-and-search#R8, documents/outline-and-search#R18)
