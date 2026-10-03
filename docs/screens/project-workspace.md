---
type: screen
concerns: [shell/workspace, shell/desktop, documents/projects]
---
# project-workspace

프로젝트를 열면 보는 화면이다. 사람이 문서·터미널·앱을 같은 탭 줄에서 열고 오가며, 떠나도 배치를 이어서 쓴다.

## 보이는 것

1. **머리.** 프로젝트 이름과 한 줄 목적. 폴더·추적 설정과 문서 수는 "Project settings"에서 펼친다(documents/projects#R8).
2. **왼쪽 탐색.**
   - Documents: 추적 중인 문서 이름과 수정 시각. 아직 검색에 반영되지 않은 문서에는 "Not yet searchable"만 작게 붙는다(documents/outline-and-search#R14).
   - Folders: 등록 폴더가 둘 이상일 때만 보인다.
   - Focus: 이 프로젝트에 연결된 context 목록(shell/desktop#R28).
3. **탭 줄.** 문서 편집기·뷰어, 터미널, 앱 패널 탭을 종류 아이콘·대상 이름·닫기와 함께 보인다. 왼쪽 또는 오른쪽 최대 두 칸으로 나눠 나란히 놓을 수 있다(shell/workspace#R1, R3).
4. **New tab(주 행동).** Document, Terminal, App panel 중 골라 연다.
5. **Conversation 도크 토글.** 오른쪽 위에 두고, 닫아도 탐색과 탭은 그대로다(shell/desktop#R2, R29).
6. **이 프로젝트의 대기 안내.** 이 프로젝트와 관련한 결정 대기와 daemon 장애만 색 없는 pill로 보인다(shell/desktop#R27, R10).

## 숨긴 것

- 탭을 다시 열 때 각 대상의 존재·권한을 다시 검사하는 과정은 보이지 않는다. 복원 안 되는 탭만 이유 있는 자리표시로 남는다(shell/workspace#R7).
- agent에게 보내는 "지금 보는 화면" 요약(열린 탭 종류, 선택 범위, 관측 시각)은 만들어지는 과정도 내용도 이 화면에 보이지 않는다. 결과는 Conversation 도크의 답으로만 나타난다(shell/workspace#R9, R10).
- 문서의 scan·검색 반영 지연 처리는 보이지 않고 "Not yet searchable" 결과만 보인다.
- 탭 배치 자체를 저장하는 과정은 보이지 않는다. 문서 본문·편집 초안·터미널 출력은 이 배치에 함께 저장되지 않는다(shell/workspace#R8).

## 행동

- 주 행동: **New tab**(Document / Terminal / App panel).
- 보조: 탭을 드래그하거나 키보드로 다른 칸으로 옮기기, 두 칸으로 나누거나 한 칸으로 합치기, Conversation 도크 열기/닫기, Project settings 펼치기.

## 상태

- **비었음.** 연 탭이 없으면 New tab 행동만 보인다.
- **불러오는 중.** 프로젝트를 다시 열 때 탭 복원까지 300ms 전에는 아무것도 보이지 않고 이후 skeleton을 보인다(shell/design-system#R1).
- **복원 안 됨.** 삭제·보관됐거나 권한을 잃은 대상은 이유와 닫기만 있는 자리표시로 남는다. 터미널은 "Ended" 자리표시로만 복원되고, 사람이 Start again을 눌러야 새로 시작한다(shell/workspace#R7).
- **좁은 창.** 두 칸의 폭이 480px 아래로 줄면 분할 상태를 기억한 한 칸 보기로 바뀌고, 다시 넓히면 돌아온다(shell/workspace#R4).
- **연결 끊김.** 마지막으로 확인한 내용과 시각을 유지하고, provider가 필요한 작업만 연결 안 됨으로 표시한다. 문서 편집·터미널은 막히지 않는다(shell/desktop#R7).

## 문구

| key | en |
|---|---|
| project-workspace.header.settings | Project settings |
| project-workspace.tabs.new | New tab |
| project-workspace.tabs.new.document | Document |
| project-workspace.tabs.new.terminal | Terminal |
| project-workspace.tabs.new.app_panel | App panel |
| project-workspace.sidebar.documents | Documents |
| project-workspace.sidebar.documents.pending_index | Not yet searchable |
| project-workspace.sidebar.folders | Folders |
| project-workspace.sidebar.focus | Focus |
| project-workspace.tab.restored_missing.title | Can't reopen this |
| project-workspace.tab.restored_terminal.ended | Ended |
| project-workspace.tab.restored_terminal.restart | Start again |
| project-workspace.pending.label | {count, plural, one {# waiting} other {# waiting}} |
| project-workspace.offline.banner | Some features need a connection. Your documents and terminal still work. |

## 크기와 접근성

- 탭 줄 높이 36px, 좌우 칸 최소 폭 480px, 경계 1px(shell/workspace#R2, R4).
- 탭 전환·칸 이동은 Tab·좌우 화살표·Enter로 하고, screen reader는 탭 종류와 대상 이름을 읽는다(shell/workspace#R1).
- 좁은 창에서는 왼쪽 탐색이 접히고, 상단 바에서 다시 펼친다(shell/design-system#R24).
