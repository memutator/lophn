import { useMemo, useState } from "react";

import type { Area } from "../types.ts";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { fakeWorkspaceSource } from "../../../../packages/shell/renderer/workspace/fake-source.ts";
import { RightSidebar } from "../../../../packages/shell/renderer/shell/right-sidebar.tsx";
import { WorkflowPanel } from "../../../../packages/shell/renderer/workspace/sidebar/workflow-panel.tsx";
import { openProject } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  LeftSidebarPage,
  ExplorerHead,
  ExplorerMove,
  ExplorerNewExists,
  ExplorerNewFile,
  ExplorerRename,
  ExplorerRootMenu,
  FileConflict,
  FileConflictCompare,
  FileDeleteConfirm,
  FolderActionsMenu,
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
  TabKinds,
} from "./project-pages.tsx";
import {
  FloatMinimized,
  FloatOverApp,
  FloatStack,
  FloatTerminal,
} from "./project-float/pages.tsx";
import { DetachedTerminal } from "./project-detached/pages.tsx";
import { EditorTabMenu } from "./project-files/tab-menu.tsx";
import {
  BrowserAgentControl,
  BrowserAgentHeld,
  BrowserBlank,
  BrowserBookmarkMenu,
  BrowserBridgeOnePane,
  BrowserBridgePane,
  BrowserDevtoolsBottom,
  BrowserDevtoolsFloat,
  BrowserDevtoolsMenu,
  BrowserDevtoolsRight,
  BrowserNewTabBookmarks,
  BrowserOauthPopup,
  BrowserOverflowMenu,
  BrowserPaletteBookmark,
  BrowserPopupBlocked,
  BrowserPopupNewTab,
  BrowserStarEmpty,
  BrowserStarFilled,
  BrowserTabPage,
  NewTabMenuBrowser,
} from "./browser/pages.tsx";
import { ProjectApp } from "./project-app.tsx";
import { documentTab } from "../../mock/phroner-data.ts";
import {
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../mock/mock-desktop.tsx";

// WorkflowPanel은 workflow 변경 event를 듣는다. Workspace 밖에서 세우는 page는 provider를 직접 둔다.
function WithEvents({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createEventClient(createFakeSource()));
  return <EventsProvider client={client}>{children}</EventsProvider>;
}

/** sidebar · Workflows. fake source의 기본 목록이 줄이 된다: 도는 instance가 있는 workflow, 쉬는 workflow, 오류 workflow, flow. */
function SidebarWorkflows() {
  const tab = documentTab("eval/experiments/exp-008-query-tools.md");
  return (
    <WithEvents>
      <ProjectApp
        sidebar={{ mode: "workflow" }}
        panes={[{ tabs: [tab], selected: tab.key }]}
      />
    </WithEvents>
  );
}

/** workflow가 하나도 없는 project의 sidebar. */
function SidebarWorkflowsEmpty() {
  const source = useMemo(() => fakeWorkspaceSource({ workflows: [] }), []);
  const noop = () => {};
  return (
    <WithEvents>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background: "var(--color-surface-base)",
        }}
      >
        <div style={{ width: 320, padding: "var(--space-4)" }}>
          <RightSidebar title="Workflows" panel="workflow">
            <WorkflowPanel project="prj_empty" source={source} onOpen={noop} />
          </RightSidebar>
        </div>
      </div>
    </WithEvents>
  );
}

/** sidebar · Jobs. phroner에 걸린 job 넷만 줄이 되고 Grocery의 job은 보이지 않는다. */
function SidebarJobs({ empty = false }: { empty?: boolean }) {
  const tab = documentTab("eval/experiments/exp-008-query-tools.md");
  return (
    <ProjectApp
      sidebar={{ mode: "jobs", noJobs: empty }}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

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
const SETTINGS_TAB = {
  key: "project-settings",
  kind: "project_settings",
  title: "Project settings",
} as const;
const SETTINGS_PANES: readonly PaneSpec[] = [
  { tabs: [NOTES, SETTINGS_TAB], selected: SETTINGS_TAB.key },
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
  summary: "프로젝트 작업대. sidebar, 탭, 문서 편집, 파일 작업, 검색.",
  pages: [
    {
      id: "project-document",
      title: "Project workspace · document tab",
      description:
        "프로젝트 작업대의 문서 탭. 왼쪽 sidebar에서 문서를 고르고 live preview 편집기에서 읽고 고친다.",
      render: () => (
        <MockDesktop
          route={openProject(PROJECT_GROCERY)}
          panes={DOCUMENT_PANES}
        />
      ),
    },
    {
      id: "project-settings",
      title: "Project workspace · project settings tab",
      description:
        "Project settings 탭. 왼쪽 sidebar의 지금 project 줄 오른쪽 끝 톱니나 팔레트로 연다. General(이름·목적·폴더·아이콘), Quick launch(아래 빠른 실행 단추 순서), App panels(고정할 앱 panel)가 가운데 기둥에 쌓인다.",
      render: () => (
        <MockDesktop
          route={openProject(PROJECT_GROCERY)}
          panes={SETTINGS_PANES}
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
        "문서 두 탭이 docked된 칸 위에 terminal 하나가 패널로 떠 있다. 패널 머리의 단추는 접기, Dock, Detach, 닫기이고 머리를 끌어 옮기고 가장자리를 끌어 크기를 바꾼다.",
      render: () => <FloatTerminal />,
    },
    {
      id: "new-detached-terminal",
      title: "Project · detached terminal",
      description:
        "탭 하나가 OS 창을 채운다. 위 bar에 제목과 [Dock]이 있고 창 단추는 OS의 것이다. [Dock]이나 창 닫기(×)는 탭을 project 창으로 돌려보낸다. terminal 출력은 gallery의 가짜 통로가 준 것이다.",
      render: () => <DetachedTerminal />,
    },
    {
      id: "new-float-stack",
      title: "Project · stacked floats",
      description:
        "패널 둘이 위아래로 겹쳐 있다. 아래는 문서, 위는 terminal이고 위쪽만 active이다. 패널 머리의 단추는 접기, Dock, Detach, 닫기이다. 아래 패널을 누르면 올라온다.",
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
      id: "browser-tab",
      title: "Browser · tab",
      description:
        "https page를 연 browser 탭이다. 머리 줄 하나가 card 머리를 겸한다: 뒤로, 앞으로, 새로 고침, 주소 칸(경로 자리), 별, Bookmarks, Open in browser, ⋯이고 탭 이름은 page title, 아이콘은 site favicon이다. page는 `<webview>`라 gallery에서는 빈 자리로 그린다.",
      render: () => <BrowserTabPage />,
    },
    {
      id: "browser-blank",
      title: "Browser · blank tab",
      description:
        "새 탭 menu의 Browser로 연 빈 주소 칸이다. 주소 칸에 focus가 있고, bookmark가 없어 빈 상태 글이 보인다.",
      render: () => <BrowserBlank />,
    },
    {
      id: "browser-popup-blocked",
      title: "Browser · popup blocked",
      description:
        "page가 사용자 입력 없이 새 창을 열려다 거절되었다는 한 줄 안내다. 머리 줄 아래 toast로 뜬다.",
      render: () => <BrowserPopupBlocked />,
    },
    {
      id: "browser-oauth-popup",
      title: "Browser · sign-in popup",
      description:
        "로그인 page가 크기를 준 popup을 열어 작은 floated browser 탭(accounts.google.com)으로 떴다. 저장되지 않고, Dock하면 같은 주소의 보통 탭이 된다.",
      render: () => <BrowserOauthPopup />,
    },
    {
      id: "browser-popup-new-tab",
      title: "Browser · link opened in a new tab",
      description:
        "크기 없는 popup(target=_blank link)은 연 탭 바로 뒤에 새 browser 탭으로 열린다.",
      render: () => <BrowserPopupNewTab />,
    },
    {
      id: "browser-overflow-menu",
      title: "Browser · more menu",
      description:
        "머리 줄 끝의 ⋯ tab menu다. 맨 위 묶음이 DevTools라서 닫혀 있으면 Inspector 하나이고, 구분선 아래가 기본 tab 항목이다.",
      render: () => <BrowserOverflowMenu />,
    },
    {
      id: "browser-devtools-right",
      title: "Browser · DevTools on the right",
      description:
        "Inspector로 연 DevTools가 page 오른쪽에 붙었다. 가운데 경계를 끌어 크기를 바꾼다. DevTools는 native view라 gallery에서는 빈 자리다.",
      render: () => <BrowserDevtoolsRight />,
    },
    {
      id: "browser-devtools-bottom",
      title: "Browser · DevTools at the bottom",
      description: "DevTools를 page 아래에 붙였다.",
      render: () => <BrowserDevtoolsBottom />,
    },
    {
      id: "browser-devtools-float",
      title: "Browser · floating DevTools",
      description:
        "DevTools만 떼어 workspace 위 floated 패널로 띄웠다. 패널 bar의 단추로 다시 page 옆에 붙이거나 따로 창으로 옮긴다.",
      render: () => <BrowserDevtoolsFloat />,
    },
    {
      id: "browser-agent-control",
      title: "Browser · agent controlling",
      description:
        'agent가 연 탭의 머리. 머리에 "Agent is controlling this tab"과 [Take control]이 선다.',
      render: () => <BrowserAgentControl />,
    },
    {
      id: "browser-agent-held",
      title: "Browser · person took control",
      description:
        '[Take control]을 눌러 사람이 가져왔다. "You have control"과 [Hand back]이 서고 그동안 agent의 쓰기는 conflict다.',
      render: () => <BrowserAgentHeld />,
    },
    {
      id: "browser-devtools-menu",
      title: "Browser · DevTools menu",
      description:
        "DevTools가 열려 있을 때의 더 보기 menu다. 오른쪽, 아래, 띄우기, 따로 창, 닫기가 있고 지금 자리는 잠겨 있다.",
      render: () => <BrowserDevtoolsMenu />,
    },
    {
      id: "new-tab-menu-browser",
      title: "Browser · new tab menu",
      description:
        "탭 줄 끝의 + menu에 Browser가 있다. 고르면 빈 주소 칸의 browser 탭이 열린다.",
      render: () => <NewTabMenuBrowser />,
    },
    {
      id: "browser-star-empty",
      title: "Browser · bookmark star",
      description:
        "아직 bookmark가 아닌 page다. 주소 칸 끝의 별이 비어 있고 누르거나 Ctrl/Cmd+D를 누르면 bookmark가 된다.",
      render: () => <BrowserStarEmpty />,
    },
    {
      id: "browser-star-filled",
      title: "Browser · bookmark popover",
      description:
        "bookmark인 page의 채운 별을 눌러 popover가 열렸다. title을 고치고 [Remove]로 지운다.",
      render: () => <BrowserStarFilled />,
    },
    {
      id: "browser-bookmark-menu",
      title: "Browser · bookmarks menu",
      description:
        "머리 줄의 Bookmarks 단추 menu다. 더한 순서대로 favicon과 title이고, favicon이 없는 bookmark는 Globe다. 고르면 지금 탭에서 연다.",
      render: () => <BrowserBookmarkMenu />,
    },
    {
      id: "browser-new-tab-bookmarks",
      title: "Browser · new tab with bookmarks",
      description:
        "빈 주소 칸으로 연 새 탭이 page 자리에 bookmark 목록(favicon, title, host)을 보인다. 누르면 지금 탭에서, Ctrl/Cmd-click은 새 탭에서 연다.",
      render: () => <BrowserNewTabBookmarks />,
    },
    {
      id: "browser-palette-bookmark",
      title: "Browser · bookmarks in the palette",
      description:
        "Ctrl+K 팔레트에 글자를 치면 Bookmarks 묶음에 이름이 맞는 bookmark가 favicon과 함께 나온다. 고르면 새 browser 탭에서 열린다.",
      render: () => <BrowserPaletteBookmark />,
    },
    {
      id: "new-explorer-root",
      title: "Sidebar · Files",
      description:
        "오른쪽 sidebar의 Files panel이다. 루트는 작은 대문자 이름 한 줄 머리이고, 그 menu를 연 상태로 연결한 폴더 둘이 이름과 경로로 보인다. 각 행 오른쪽 끝의 x는 그 폴더를 project에서 빼고(디스크는 그대로), 맨 아래 Add folder는 폴더를 더한다. tree에는 차분한 파일 종류 아이콘이 붙는다.",
      render: () => <ExplorerRootMenu />,
    },
    {
      id: "new-agent-sidebar",
      title: "Sidebar · Left",
      description:
        "왼쪽 sidebar. 위에 New session(▾로 lophn agent와 coding agent 고르기), Inbox, Jobs가 있다. Workspaces 아래에 Home, project, 앱이 차례로 있고 workspace마다 열린 session이 agent 아이콘, 제목, 오른쪽 끝 상태 점으로 있다. 이 창이 보이는 phroner에는 사람 차례인 workflow와 터미널 coding agent도 섞여 있고, 열린 줄이 desk 둘(Main, weekly-review)과 탭 없이 도는 줄(No tab)에 걸쳐 있어 desk 이름 줄로 나뉜다. Recent는 workspace마다 접힌 줄 하나다. 맨 아래에 Settings가 있다.",
      render: () => <LeftSidebarPage />,
    },
    {
      id: "new-sidebar-workflows",
      title: "Sidebar · Workflows",
      description:
        "오른쪽 sidebar의 Workflows panel이다. workflow마다 아이콘, 이름, 아래 줄이 있고, 도는 instance가 있으면 아래 줄에 도는 수와 오른쪽 끝 점이 보인다. 선언이 틀린 workflow는 경고 아이콘과 빨간 글자이고 flow는 여기서 시작하지 못한다는 글이 보인다. 줄을 누르면 그 workflow의 탭이 열린다.",
      render: () => <SidebarWorkflows />,
    },
    {
      id: "new-sidebar-workflows-empty",
      title: "Sidebar · Workflows · empty",
      description:
        "workflow가 하나도 없는 project의 Workflows panel이다. 안내 글 한 줄만 있다.",
      render: () => <SidebarWorkflowsEmpty />,
    },
    {
      id: "project-window-jobs",
      title: "Sidebar · Jobs",
      description:
        "오른쪽 sidebar의 Jobs panel이다. 그 project에 걸린 job만 줄로 보이고(다른 project의 job은 보이지 않는다), 줄은 제목, 오른쪽 끝 고정 열의 switch, 아래 줄(주기 글과 상태 하나, 실패는 표시)이다. 줄이나 [Open all jobs]를 누르면 Jobs 탭이 열린다.",
      render: () => <SidebarJobs />,
    },
    {
      id: "project-window-jobs-empty",
      title: "Sidebar · Jobs · empty",
      description:
        "이 project에 걸린 job이 하나도 없을 때의 Jobs panel이다. 사람은 job을 만들지 못하고 agent에게 말하라는 안내와, 모든 job을 보는 Jobs 탭을 여는 단추가 있다.",
      render: () => <SidebarJobs empty />,
    },
    {
      id: "new-project-tabs",
      title: "Project · tab kinds",
      description:
        "한 칸에 md 문서, JSON 파일, project 키워드 검색, Terminal 탭이 같이 열려 있고 오른쪽 칸에 lophn Agent 탭이 있다. 탭마다 아이콘과 이름만 있다. 파일은 파일 종류 아이콘, agent는 profile 아이콘이다.",
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
        "탭을 오른쪽 클릭한 menu다. Close, Close Others, Close to the Right, Close Saved, Close All, Float, Detach, Copy Path, Copy Relative Path, Reveal in Explorer 순이고 preview 탭이면 Keep Open이 더 있다. Float는 탭을 줄에서 떼어 card 위에 띄우고, Detach는 탭을 OS 창으로 뗀다.",
      render: () => <EditorTabMenu />,
    },
    {
      id: "new-project-tab-menu",
      title: "Project · new tab menu",
      description:
        "탭 줄 끝의 + 메뉴를 펼친 상태다. Terminal 바로 뒤에 Browser가 있고, Agent 하위 메뉴에 lophn과 사람이 만든 agent 셋이 있고, 그 아래 Agents 항목이 이 workspace의 Agents(관리) 탭을 연다.",
      render: () => <NewTabMenu />,
    },
    {
      id: "new-explorer-head",
      title: "Files · header buttons",
      description:
        "Files 머리 줄에 마우스를 올리거나 focus하면 New File, New Folder, Refresh, Collapse All 아이콘 단추가 오른쪽에 나타난다. 들여쓰기 안내선은 tree에 마우스를 올렸을 때 보인다.",
      render: () => <ExplorerHead />,
    },
    {
      id: "new-explorer-new-file",
      title: "Files · new file",
      description:
        "폴더를 고르고 New File을 누르면 그 폴더 안에 이름 입력 줄이 생긴다. Enter로 만들고 고정 tab으로 열며, Esc나 focus를 잃으면 취소한다. a/b/c.md처럼 쓰면 중간 폴더도 만든다.",
      render: () => <ExplorerNewFile />,
    },
    {
      id: "new-explorer-name-exists",
      title: "Files · name already exists",
      description:
        "이미 있는 이름이나 쓸 수 없는 이름을 쓰면 입력 아래에 오류가 보이고 Enter로 만들어지지 않는다.",
      render: () => <ExplorerNewExists />,
    },
    {
      id: "new-explorer-rename",
      title: "Files · rename in place",
      description:
        "F2나 오른쪽 클릭 menu의 Rename은 dialog 없이 그 줄이 입력으로 바뀐다. 파일은 처음에 확장자 앞까지만 골라진다. 열려 있는 탭의 경로도 따라 바뀐다.",
      render: () => <ExplorerRename />,
    },
    {
      id: "new-explorer-move",
      title: "Files · drag to move",
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
      id: "new-organize-folder",
      title: "Project · folder actions",
      description:
        "폴더 행을 오른쪽 클릭한 메뉴다. Reveal in File Manager 아래에 Open in Terminal이 있고, 누르면 그 폴더에서 터미널이 열린다. 파일 행에는 이 항목이 없다. 빈 자리를 오른쪽 클릭하면 지금 보이는 루트에서 연다.",
      render: () => <FolderActionsMenu />,
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
        "project 밖 파일을 연 문서 탭이다. card 머리 줄에는 경로 대신 Outside project 표시가 있고 경로는 Info에 있다.",
      render: () => <OutsideFile />,
    },
    {
      id: "new-document-tab",
      title: "Document",
      description:
        "md 문서 탭이다. 탭 key는 파일 경로이고, 저장 상태, Info, …는 card 머리 줄의 오른쪽에 있다. 본문은 늘 live preview 편집기이고 Edit·Read 전환은 없다. Ctrl+F로 찾기 줄이, Ctrl+Alt+F로 바꾸기 줄이 편집기 위에 열린다. 판 번호, 판 hint, 형식 문제 표시는 없다.",
      render: () => <DocumentTabPage />,
    },
    {
      id: "new-document-editing",
      title: "Document · saving",
      description:
        "md를 고치는 중이고 card 머리 줄의 저장 상태가 Saving…이다. 저장 상태는 디스크 저장과 충돌만 있다.",
      render: () => <MarkdownEditing />,
    },
    {
      id: "new-document-tab-info",
      title: "Document · info panel",
      description:
        "문서 탭 오른쪽에 본문 위로 떠서 열리는 정보 panel이다. Info에 경로, 크기, 바뀐 시각, Outline이 있다. 본문 폭은 줄지 않는다.",
      render: () => <DocumentTabInfo />,
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
        "이미지와 pdf viewer다. 보기만 하고, 크기 같은 정보는 card 머리 줄에 있으며 바탕이 본문과 같다.",
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
        "Ctrl/Cmd+Shift+F나 왼쪽 sidebar의 검색이 여는 project 키워드 검색이다. 검색어, 폴더 고르기, 경로 순과 줄 순의 결과, 일치한 부분이 칠해진 snippet이 있다. 취소, 건너뛴 파일 안내, 더 보기는 없다.",
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
        "결과를 눌러 연 뒤다. 오른쪽 문서가 일치한 줄로 scroll해 칠해져 있고 card 머리 줄에 Line 16이 보인다. 왼쪽 검색 탭은 그대로 남는다.",
      render: () => <FileSearchOpened />,
    },
    {
      id: "browser-bridge-pane",
      title: "Browser · opened by a terminal link",
      description:
        "terminal에서 `vite`가 낸 주소를 Ctrl/Cmd-click하거나 `$BROWSER`가 불러서 terminal 탭 옆에 browser 탭이 split으로 붙어 열린 모양이다. terminal 쪽 반쪽은 그대로 남아 있다.",
      render: () => <BrowserBridgePane />,
    },
    {
      id: "browser-bridge-one-pane",
      title: "Browser · opened by a terminal link (one pane)",
      description:
        "split이 아니면 terminal 바로 뒤에 browser 탭을 열고 그 탭을 고른다.",
      render: () => <BrowserBridgeOnePane />,
    },
  ],
};
