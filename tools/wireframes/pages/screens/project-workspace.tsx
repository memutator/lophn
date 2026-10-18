import type { Area } from "../types.ts";
import { openProject } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  AgentsGroup,
  ContextSidebar,
  DocumentInfoContexts,
  ExplorerHead,
  ExplorerMove,
  ExplorerNewExists,
  ExplorerNewFile,
  ExplorerRename,
  ExplorerRootMenu,
  FileConflict,
  FileConflictCompare,
  FileDeleteConfirm,
  FileReloaded,
  FileSearchFolder,
  FileSearchOpened,
  FileSearchResults,
  InstructionsFile,
  MarkdownEditing,
  MediaFiles,
  OpenPathPalette,
  OutsideFile,
  TextFiles,
} from "./project-files/pages.tsx";
import {
  DocumentOrganize,
  DocumentTabInfo,
  DocumentTabPage,
  EditorTabs,
  NewTabMenu,
  SidebarCollapsed,
  TabKinds,
} from "./project-pages.tsx";
import {
  DeclaredSearchBoardPage,
  DeclaredSearchTablePage,
} from "./contexts/context-pages.tsx";
import {
  FloatMinimized,
  FloatOverApp,
  FloatStack,
  FloatTerminal,
} from "./project-float/pages.tsx";
import { EditorTabMenu } from "./project-files/tab-menu.tsx";
import {
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../mock/mock-desktop.tsx";

const NOTES = {
  key: "/home/mina/Documents/grocery/notes.md",
  kind: "document_editor",
  title: "notes.md",
} as const;
const PLAN = {
  key: "/home/mina/Documents/grocery/plan.md",
  kind: "document_editor",
  title: "plan.md",
} as const;

const DOCUMENT_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN], selected: NOTES.key },
];
const TERMINAL_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, PLAN], selected: NOTES.key },
  {
    tabs: [{ key: "term_1", kind: "terminal", title: "grocery" }],
    selected: "term_1",
  },
];

export const projectWorkspaceArea: Area = {
  id: "project-workspace",
  title: "Project workspace",
  summary: "프로젝트 작업대. sidebar, 탭, 문서 읽기·편집, 파일 작업, 검색.",
  pages: [
    {
      id: "project-document",
      title: "Project workspace · document tab",
      description:
        "프로젝트 작업대의 문서 탭. 왼쪽 sidebar에서 문서를 고르고 읽기·편집을 같은 기둥에서 한다.",
      render: () => (
        <MockDesktop
          route={openProject(PROJECT_GROCERY)}
          panes={DOCUMENT_PANES}
        />
      ),
    },
    {
      id: "project-terminal",
      title: "Project workspace · terminal tab",
      description:
        "프로젝트 작업대의 terminal 탭. 문서 옆 칸에 같은 폴더의 shell이 열린다. 여기 출력은 PTY 없이 gallery의 가짜 통로가 준 것이다.",
      render: () => (
        <MockDesktop
          route={openProject(PROJECT_GROCERY)}
          panes={TERMINAL_PANES}
          openTerminal="term_1"
        />
      ),
    },
    {
      id: "new-float-terminal",
      title: "Project · floated terminal",
      description:
        "문서 두 탭이 docked된 칸 위에 terminal 하나가 패널로 떠 있다. 패널 머리의 단추는 접기, Dock, 닫기이고 머리를 끌어 옮기고 가장자리를 끌어 크기를 바꾼다.",
      render: () => <FloatTerminal />,
    },
    {
      id: "new-float-stack",
      title: "Project · stacked floats",
      description:
        "패널 둘이 위아래로 겹쳐 있다. 아래는 문서, 위는 terminal이고 위쪽만 active이다. 아래 패널을 누르면 올라온다.",
      render: () => <FloatStack />,
    },
    {
      id: "new-float-minimized",
      title: "Project · minimized floats",
      description:
        "접은 탭이 상단 bar에 칸(span)으로 줄지어 있고 폭이 모자라 넘치는 것은 +N 하나로 묶인다. 칸을 누르면 패널이 다시 펼쳐지고, +N은 나머지 목록을 연다.",
      render: () => <FloatMinimized />,
    },
    {
      id: "new-float-over-app",
      title: "Project · float over an app panel",
      description:
        "docked 칸에 앱 패널 탭이 열려 있고 그 위에 terminal 패널이 떠 있다. 앱 view는 패널이 덮은 만큼 줄어들어 패널을 피한다.",
      render: () => <FloatOverApp />,
    },
    {
      id: "new-explorer-root",
      title: "Sidebar · Explorer",
      description:
        "sidebar 맨 위 밑줄 탭(Explorer, Context, Agent)에서 Explorer를 고른 모양이다. 루트는 작은 대문자 이름 한 줄 머리이고, 그 menu를 연 상태로 연결한 폴더 둘과 하위 폴더가 이름과 경로로 보인다. tree에는 차분한 파일 종류 아이콘이 붙는다.",
      render: () => <ExplorerRootMenu />,
    },
    {
      id: "new-sidebar-context",
      title: "Sidebar · Context",
      description:
        "sidebar 맨 위 밑줄 탭에서 Context를 고른 모양이다. contexts 목록과 saved views만 보이고 saved view 이름을 누르면 결과 탭이 열린다.",
      render: () => <ContextSidebar />,
    },
    {
      id: "new-agent-sidebar",
      title: "Sidebar · Agent",
      description:
        "sidebar 맨 위 밑줄 탭에서 Agent를 고른 모양이다. lophn, Project Manager, Operators마다 열린 session이 아래에 들여 쓰여 있고 맨 아래에 Recent가 있다. session을 누르면 그 탭이 열리고 묶음 머리의 Manage는 Agents 탭을 연다.",
      render: () => <AgentsGroup />,
    },
    {
      id: "new-sidebar-collapsed",
      title: "Sidebar · collapsed",
      description:
        "접은 sidebar는 바로 가기 rail이 된다. 위에서부터 펼치기, Terminal, Contexts, Saved views, Agent, Search이고 Search는 project 키워드 검색을 연다.",
      render: () => <SidebarCollapsed />,
    },
    {
      id: "new-project-tabs",
      title: "Project · tab kinds",
      description:
        "한 칸에 md 문서, JSON 파일, project 키워드 검색, Context, Terminal 탭이 같이 열려 있고 오른쪽 칸에 lophn Agent 탭이 있다. 탭 줄은 앱 공간 pane과 같은 component이고, 탭마다 아이콘과 이름만 있다. 파일은 파일 종류 아이콘, agent는 profile 아이콘이다.",
      render: () => <TabKinds />,
    },
    {
      id: "new-editor-tabs",
      title: "Project · editor tabs",
      description:
        "편집기 탭 줄이다. 고른 탭은 editor 바탕으로 이어지고 위에 얇은 강조선이 있다. italic 이름은 preview 탭, 닫기 자리의 ●는 저장 안 된 탭이고 hover하면 ×가 된다. 탭이 넘치면 가로 scroll하고 줄에 hover할 때만 얇은 scrollbar가 보인다.",
      render: () => <EditorTabs />,
    },
    {
      id: "new-editor-tab-menu",
      title: "Project · tab menu",
      description:
        "탭을 오른쪽 클릭한 menu다. Close, Close Others, Close to the Right, Close Saved, Close All, Float, Copy Path, Copy Relative Path, Reveal in Explorer 순이고 preview 탭이면 Keep Open이 더 있다. Float는 탭을 칸에서 떼어 위에 띄운다.",
      render: () => <EditorTabMenu />,
    },
    {
      id: "new-project-tab-menu",
      title: "Project · new tab menu",
      description:
        "탭 줄 끝의 + 메뉴를 펼친 상태다. Agent 하위 메뉴에 lophn, Project Manager, Operator가 있고 Agents(관리 탭)와 New context 항목은 없다.",
      render: () => <NewTabMenu />,
    },
    {
      id: "new-explorer-head",
      title: "Explorer · header buttons",
      description:
        "Explorer 머리 줄에 마우스를 올리거나 focus하면 New File, New Folder, Refresh, Collapse All 아이콘 단추가 오른쪽에 나타난다. 들여쓰기 안내선은 tree에 마우스를 올렸을 때 보인다.",
      render: () => <ExplorerHead />,
    },
    {
      id: "new-explorer-new-file",
      title: "Explorer · new file",
      description:
        "폴더를 고르고 New File을 누르면 그 폴더 안에 이름 입력 줄이 생긴다. Enter로 만들고 고정 tab으로 열며, Esc나 focus를 잃으면 취소한다. a/b/c.md처럼 쓰면 중간 폴더도 만든다.",
      render: () => <ExplorerNewFile />,
    },
    {
      id: "new-explorer-name-exists",
      title: "Explorer · name already exists",
      description:
        "이미 있는 이름이나 쓸 수 없는 이름을 쓰면 입력 아래에 오류가 보이고 Enter로 만들어지지 않는다.",
      render: () => <ExplorerNewExists />,
    },
    {
      id: "new-explorer-rename",
      title: "Explorer · rename in place",
      description:
        "F2나 오른쪽 클릭 menu의 Rename은 dialog 없이 그 줄이 입력으로 바뀐다. 파일은 처음에 확장자 앞까지만 골라진다. 열려 있는 탭의 경로도 따라 바뀐다.",
      render: () => <ExplorerRename />,
    },
    {
      id: "new-explorer-move",
      title: "Explorer · drag to move",
      description:
        "파일이나 폴더를 다른 폴더로 끌어 놓으면 옮기기 전에 한 번 묻는다. 같은 이름이 있는 폴더나 자기 안으로는 옮길 수 없다.",
      render: () => <ExplorerMove />,
    },
    {
      id: "new-organize",
      title: "Project · file actions",
      description:
        "파일 tree 행을 오른쪽 클릭한 메뉴다. VS Code 순서로 New File, New Folder, Reveal in File Manager, Copy Path, Copy Relative Path, Rename, Delete이고 묶음 사이에 구분선이 있다. 빈 자리를 오른쪽 클릭하면 루트 기준이라 Rename과 Delete가 빠진다.",
      render: () => <DocumentOrganize />,
    },
    {
      id: "new-file-delete",
      title: "Project · delete a file",
      description:
        "Delete를 누르면 화면 가운데 modal이 한 번 묻는다. 파일과 폴더는 OS 휴지통으로 가고 비어 있지 않은 폴더도 된다. 휴지통을 쓸 수 없으면 지우지 않고 실패로 알린다.",
      render: () => <FileDeleteConfirm />,
    },
    {
      id: "new-instructions-file",
      title: "Project · LOPHN.md as a plain file",
      description:
        "project 지침 LOPHN.md를 따로 둔 진입 없이 일반 문서 탭으로 연다.",
      render: () => <InstructionsFile />,
    },
    {
      id: "new-file-open-path",
      title: "Project · open a file by path",
      description:
        "팔레트에 절대 경로를 친 상태다. 그 경로를 여는 행에 Outside project가 적혀 있고, Open file…은 OS dialog로 연다.",
      render: () => <OpenPathPalette />,
    },
    {
      id: "new-file-outside",
      title: "Project · file outside the project",
      description:
        "project 밖 파일을 연 문서 탭이다. view bar에는 경로 대신 Outside project 표시가 있고 경로는 위쪽 경로와 Info에 있다.",
      render: () => <OutsideFile />,
    },
    {
      id: "new-document-tab",
      title: "Document · read",
      description:
        "md 문서 탭이다. 탭 key는 파일 경로이고 view bar는 한 줄로, 오른쪽에 저장 상태, Edit, Info, …가 있다. 판 번호, 판 hint, 형식 문제 표시는 없다.",
      render: () => <DocumentTabPage />,
    },
    {
      id: "new-document-editing",
      title: "Document · editing",
      description:
        "md를 고치는 중이고 저장 상태가 Saving…이다. 저장 상태는 디스크 저장과 충돌만 있다.",
      render: () => <MarkdownEditing />,
    },
    {
      id: "new-document-tab-info",
      title: "Document · info panel",
      description:
        "문서 탭 오른쪽에 본문 위로 떠서 열리는 정보 panel이다. 탭은 Info와 Contexts 둘이고 Info에 경로, 크기, 바뀐 시각, Outline이 있다. 본문 폭은 줄지 않는다.",
      render: () => <DocumentTabInfo />,
    },
    {
      id: "new-document-tab-contexts",
      title: "Document · info panel, Contexts",
      description:
        "같은 panel에서 Contexts 탭을 연 상태다. 이 문서를 다루는 context를 보인다.",
      render: () => <DocumentInfoContexts />,
    },
    {
      id: "new-viewer-text",
      title: "Document · text files",
      description:
        "확장자로 viewer를 고른다. 왼쪽은 JSON, 오른쪽은 YAML text 편집기이고 줄 번호와 지금 줄 표시가 있다.",
      render: () => <TextFiles />,
    },
    {
      id: "new-viewer-media",
      title: "Document · image and pdf",
      description:
        "이미지와 pdf viewer다. 보기만 하고, view bar는 한 줄이며 바탕이 탭 본문과 같다.",
      render: () => <MediaFiles />,
    },
    {
      id: "new-file-reloaded",
      title: "Document · changed outside, reloaded",
      description:
        "고치지 않은 파일이 밖(다른 편집기, git)에서 바뀌어 다시 읽었다는 알림이 탭 위쪽 toast로 뜬다.",
      render: () => <FileReloaded />,
    },
    {
      id: "new-file-conflict",
      title: "Document · conflict",
      description:
        "고치는 중에 디스크의 파일이 바뀌면 탭 위쪽 toast가 알린다. Compare, Use disk version, Keep my version 단추는 오른쪽 끝에 있다.",
      render: () => <FileConflict />,
    },
    {
      id: "new-file-conflict-compare",
      title: "Document · conflict, compare with disk",
      description:
        "디스크 쪽과 내가 고친 쪽을 나란히 보인다. 다른 줄은 +/− 기호와 배경으로 구별한다.",
      render: () => <FileConflictCompare />,
    },
    {
      id: "new-file-search",
      title: "Search · find in files",
      description:
        "rail의 Search가 여는 project 키워드 검색이다. 검색어, 폴더 고르기, 경로 순과 줄 순의 결과, 일치한 부분이 칠해진 snippet이 있다. 취소, 건너뛴 파일 안내, 더 보기는 없다.",
      render: () => <FileSearchResults />,
    },
    {
      id: "new-file-search-folder",
      title: "Search · narrowed to a folder",
      description: "폴더를 eval로 좁힌 검색이다.",
      render: () => <FileSearchFolder />,
    },
    {
      id: "new-file-search-opened",
      title: "Search · result opened at its line",
      description:
        "결과를 눌러 연 뒤다. 오른쪽 문서가 일치한 줄로 scroll해 칠해져 있고 view bar에 Line 16이 보인다. 왼쪽 검색 탭은 그대로 남는다.",
      render: () => <FileSearchOpened />,
    },
    {
      id: "new-search-table",
      title: "Search · declared (table)",
      description:
        "context 계약에 선언된 검색의 table 결과다. 입력 form, page 이동, 개체 링크가 있다. project 키워드 검색과는 다른 탭이다.",
      render: () => <DeclaredSearchTablePage />,
    },
    {
      id: "new-search-board",
      title: "Search · declared (board)",
      description:
        "선언된 검색의 board 결과(Experiments by status)다. 같은 탭에서 다른 검색을 고른 모양이다.",
      render: () => <DeclaredSearchBoardPage />,
    },
  ],
};
