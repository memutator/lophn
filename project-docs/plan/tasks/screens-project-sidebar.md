# screens-project-sidebar

project 창의 sidebar를 새로 옮긴다. 머리 아래의 밑줄 글자 탭 Explorer / Context / Agent(한 번에 하나만 보임), Explorer의 연결 폴더·하위 폴더 고르는 menu와 종류 아이콘이 붙은 파일 tree, Agent의 agent별 열린 session과 Recent, 접힌 sidebar의 바로 가기 rail이다. Context 모양의 본문은 screens-contexts가 만든 component를 slot으로 받는다. 이 task는 sidebar component와 그 데이터 통로(`workspace/source.ts`)까지 하고, `workspace.tsx`에 꽂는 일과 gallery는 `screens-project-window`가 한다.

- 단위: screens-project (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/` (새 file을 만든다. 옛 `sidebar.tsx`, `agents-section.tsx`와 그 css는 window task가 부르는 쪽을 바꾼 뒤 지운다)
  - `packages/shell/renderer/workspace/source.ts`, `core-source.ts`, `fake-source.ts`(새로)
  - `packages/shell/renderer/desktop/dev-seed.ts` (추가 소유, lead 승인 2026-10-16: `desktop/`은 screens-workspace 소유다. 이 file만 project 단위가 가진다. 시드 작업대가 새 `WorkspaceSource`를 쓰게 고친다)
  - `packages/design/wording/catalog/project.ts`와 생성물 `catalog/project.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S8 2장(role과 place, Agent 묶음은 lophn·Project Manager·Operators) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `U2.3#4`(접힌 sidebar rail), `U2.3#5`(sidebar의 문서 목록 → 등록 폴더의 디스크 파일 tree), `U6.4#2`, `U6.4#4`, `U6.1#1`
  - inventory(다른 단위에서 넘어온 줄): `U6.4#1`(sidebar 맨 위 탭 Explorer / Context / Agent. screens-contexts 줄이지만 sidebar 틀이라 이 task가 맡는다)
  - 결정: `../README.md` 3장 #57(`project_manager`), #93(편집기의 파일 읽고 쓰기는 shell main이 직접)
  - 지금 코드(고칠 곳): `workspace/sidebar/{sidebar.tsx(301줄), agents-section.tsx(133줄)}`, `workspace/source.ts`(`ProjectView`, `DocumentRow`, `FileRow`, `WorkspaceSource`), `workspace/core-source.ts`(`FILE_DOCUMENT_LIMIT`), `workspace/agents/sidebar-agents.ts`(`useSidebarAgents`는 screens-agents 소유. 읽기만 한다), `workspace/contexts/shortcut-rail.tsx`(옛 rail. screens-contexts가 지운다)
  - 본보기(화면): `tools/wireframes/frames/compositions/project-window.tsx`(`ProjectSidebar` 258줄~, `RAIL`, `SidebarSpec`), `project-files/explorer.tsx`(148줄: `ModeToggle`, `FileTree`, `RootPicker`), `project-files/agent-panel.tsx`(191줄: `AgentsPanel`), `project-files/menu-icons.tsx`, `project-files/file-tree-data.ts`, `project-files/file-data.ts`(`ROOTS`), `project-files/files.module.css`, `workspace/sidebar/sidebar.module.css`
- 계약:
  - 쓰는 것:
    - `packages/shell/ipc/files.ts`와 `preload/files-api.ts`(contract-shell)의 `FilesApi.list({ path })`: 폴더 한 단계(이름순, `{ name, kind: "file" | "folder" }`). Explorer tree는 main이 디스크에서 직접 읽는 이 목록으로 그린다. 폴더를 펼칠 때 그 폴더만 읽는다.
    - `packages/protocol/projects`(contract-calls-places)의 project 읽기: 연결 폴더와 하위 폴더(`parent`), 폴더별 "찾을 수 없음" 상태. route 이름은 고정된 파일을 따른다.
    - `useSessions()` (screens-data-events): Agent 모양의 열린 session과 Recent, 상태 점(사람을 기다림·일하는 중)
    - `AgentsSource.list` (`workspace/agents/source.ts`, screens-agents가 가진 interface): agent 목록. 이 interface를 이 task는 읽기만 한다.
    - `@lophn/design/components`의 `Tree`(행 아이콘을 받는지 확인한다. 못 받으면 wireframe처럼 renderer 쪽 행 component를 둔다), `Menu`, `Tooltip`, `IconButton`, `Avatar`, `FileIcon`·`MenuIcon`(ui-chrome)
  - 내놓는 것:
    - `workspace/sidebar/project-sidebar.tsx`: `ProjectSidebar`. props: `mode`(open·collapsed), `width`, `project`, `contextPanel`(ReactNode, Context 모양의 본문), `onOpenFile(path)`, `onRail(action: RailAction)`, `onAgent(agent)`, `onSession(session)`, `onManage()`, `onToggle()`, `onLauncher()`, `onResizeStart`
    - `workspace/sidebar/rail.tsx`: `RailAction = "terminal" | "contexts" | "saved" | "agent" | "search"`와 접힌 rail
    - `WorkspaceSource`의 새 칸: 연결 폴더별 파일 tree 읽기(폴더 하나를 열 때 한 단계씩), 하위 폴더 포함 `ProjectView.folders`
    - `workspace/fake-source.ts`: wireframe의 `ROOTS`·`PHRONER_TREE`·`NOTES_TREE`를 옮긴 fake `WorkspaceSource`

## 할 일

0. 공통 규칙. 옛 `sidebar/sidebar.tsx`와 `WorkspaceSource.documents`·`DocumentRow`는 `workspace.tsx`(screens-project-window가 이 task 뒤에 고친다)가 아직 쓴다. 옛 export를 지우지 않고 새 file·새 칸을 옆에 더한다. `WorkspaceSource`에서 문서 목록 칸을 빼면 `workspace.tsx`가 깨지므로 그 칸은 `documents()`가 빈 목록을 돌려주는 모양으로 남기고 window task가 지운다. 어느 경우에도 `deno task check`가 통과해야 한다.
1. 틀과 Explorer를 옮긴다.
   - `ProjectSidebar`: 머리(launcher 단추, project 이름, 접기 단추)와 같은 높이로 위쪽 바와 경계선이 한 줄로 이어진다(머리 높이는 ui-chrome의 `--window-top-bar` token 36px). 그 아래 `ModeToggle`(밑줄 글자 탭 Explorer / Context / Agent). 근거: `U6.4#1`.
   - Explorer: 루트는 한 줄 머리(`▾ PHRONER`)이고, 누르면 `RootPicker` menu가 연결 폴더와 하위 폴더(`parent`)를 보여 고른다. tree 행에 파일·폴더 종류 아이콘(`FileIcon`)을 붙인다. 행 오른쪽 클릭 menu는 Open·Rename·Delete(보관·이동·폴더 연결 해제는 없다)이고 항목마다 design `MenuIcon`(ui-chrome)으로 아이콘을 붙인다. Rename·Delete의 실제 실행과 지우기 확인 modal은 `screens-project-editor`·`screens-project-main` 몫이다. 이 task는 `onFileAction(action, path)` callback만 낸다. 근거: `U6.4#2`, `U2.3#5`.
   - 옛 "Folders" 묶음 아래 "문서로 잡힌 파일"과 따로 둔 "Documents" 묶음(`documents.list` 기반, `DocumentRow`, `FileRow.document`, `FILE_DOCUMENT_LIMIT`)은 없앤다. 등록 폴더의 디스크 파일 tree 하나만 둔다.
   - 폴더를 찾을 수 없으면(연결 폴더가 디스크에서 사라짐) 루트 머리에 "찾을 수 없음"을 보인다(고치는 길은 Workspace의 Projects 화면이다).
2. `SidebarAgent`·`SidebarAgentRole` type을 새 `sidebar/sidebar-agent.ts`로 옮기고(칸은 그대로, role 이름만 `context_engineer` → `project_manager`) 옛 `agents-section.tsx`는 그 type을 다시 내보내게만 줄인다. `workspace/agents/sidebar-agents.ts`(screens-agents 소유)가 이 type을 옛 경로에서 import하므로 경로를 지금 끊지 않는다. 그 import를 새 경로로 바꾸는 일과 `agents-section.tsx` 지우기는 cleanup이 한다.
3. Agent 모양을 옮긴다(`agent-panel.tsx`). agent마다 열린 session을 들여 써 보이고(lophn·Project Manager·Operators 순서, App Engineer는 앱 공간 agent라 없음), 맨 아래에 Recent session 몇 개를 둔다. session 줄 앞 점은 사람을 기다림·일하는 중이다(`useSessions`). agent 줄을 누르면 `onAgent`, hover의 +는 새 session, session 줄은 `onSession`, 머리의 [Manage]는 `onManage`다. `sidebar/use-agent-panel.ts`가 `AgentsSource.list`와 `useSessions`를 합친다. 근거: `U6.4#4`.
4. 접힌 sidebar rail(`rail.tsx`)을 옮긴다. 위에서부터 펼치기 · Terminal · Contexts · Saved views · Agent · Search이고 Search는 tooltip이 보인다. 단추가 `onRail`을 부른다. Search는 project 파일 검색을, Agent는 lophn을 연다(어느 탭을 여는지는 window가 정한다). 근거: `U2.3#4`.
5. `workspace/source.ts`와 `core-source.ts`를 고친다. 폴더 한 단계 읽기(`list(path)`: `FilesApi.list`를 부른다)와 하위 폴더 포함 `ProjectView`를 더한다. 문서 목록 쪽(`documents()`, `DocumentRow`, `files()`, `FileRow.document`, `FILE_DOCUMENT_LIMIT`)은 옛 sidebar와 `workspace.tsx`가 쓰므로 0번 규칙대로 그대로 두고 window task가 지운다. 레이아웃 읽기·저장(`readLayout`, `saveLayout`)과 `contextsSource`·`agentsSource` 칸은 그대로 둔다. `workspace/fake-source.ts`를 만들고 `desktop/dev-seed.ts`의 시드 작업대가 이것을 쓰게 고친다.
6. 문구를 wording key로 바꾼다(영역 `project-workspace`: sidebar 머리, 탭 이름 Explorer·Context·Agent, rail tooltip, "찾을 수 없음" 줄). `project-workspace.heading.folders`·`documents`, `project-workspace.empty.no-documents`·`no-folder-documents`는 쓰는 곳이 없어지면 지운다. key는 `catalog/project.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/project.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
7. `sidebar.module.css`에서 새 component가 쓰는 규칙을 정리한다. wireframe의 `files.module.css`·`compose.module.css`는 고치지 않고 필요한 규칙을 복사한다.
8. gallery(`tools/wireframes`)는 이 task가 고치지 않는다. `ProjectSidebar` look-alike를 renderer component로 갈아타는 일은 `screens-project-window`가 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면과 읽기 통로)
- 남지 않음: 없음 (옛 문서 목록 칸과 옛 sidebar는 `screens-project-window`가 지운다)
- (화면) gallery는 `screens-project-window`가 한꺼번에 바꾼다. 이 task의 component는 그때 `new-explorer-root`, `new-sidebar-collapsed`, `new-agent-sidebar`, `new-sidebar-context`로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: `desktop/dev-mock/mod.ts`가 `seedWorkbench`의 새 시드를 쓰는지 lead가 확인. 영역 `project-workspace`의 새 key와 지운 key.
- 안 쓰게 된 export: 옛 `sidebar/sidebar.tsx`의 `Sidebar`·`SidebarProps`, `sidebar/agents-section.tsx`, `WorkspaceSource.documents`, `DocumentRow`(window task가 부르는 쪽을 바꾼 뒤 지운다)
- 정한 것: 연결 폴더 밖 목록을 막는 규칙을 어디서 거는지(main handler가 연결 폴더를 알아야 한다는 contract-shell의 걱정), `onFileAction`의 모양
- 계약 바꾸기 요청(wave 3): project 읽기에 하위 폴더 `parent`나 폴더별 "찾을 수 없음" 상태가 없으면 여기 적는다
