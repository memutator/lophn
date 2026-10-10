// 작업대 화면이 main에 보내는 현재 보기 힌트. 제목·경로·본문·터미널 출력은
// 넣지 않는다. 문서 탭은 판을 알기 전에는 빼서, 읽는 중을 편집 탭으로 올리지
// 않는다(shell/workspace#R9, prompt-assemble#R25).
import type { TabItem, WorkspaceView } from "./model.ts";

/** 문서 탭이 지금 보이는 판과 읽기·편집. */
export interface TabPresentation {
  readonly editing: boolean;
  readonly version: string;
}

type HintTab =
  | { kind: "document_editor"; key: string; document: string }
  | { kind: "document_viewer"; key: string; document: string; version: string }
  | { kind: "terminal"; key: string; project_folder: string }
  | {
    kind: "app_panel";
    key: string;
    app: string;
    surface: string;
    view_session?: string;
  };

export interface ViewHint {
  project: string;
  panes: { tabs: HintTab[]; selected: string | null }[];
  focused_pane: number;
  app_tab: string | null;
  /** 판을 아직 모르는 문서 탭이 있다. main은 그 탭이 빠지기 전에 기다릴 수 있다. */
  pending: boolean;
}

/** 폴더 경로는 힌트에 넣지 않는다. 슬래시 없는 짧은 참조만 터미널 탭이 된다. */
function folderRef(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || value.length > 80) {
    return null;
  }
  if (value.includes("/") || value.includes("\\")) return null;
  return value;
}

function hintTab(
  tab: TabItem,
  presentation: Readonly<Record<string, TabPresentation>>,
  sessions: Readonly<Record<string, string>>,
): HintTab | null {
  if (tab.kind === "document_editor" || tab.kind === "document_viewer") {
    const shown = presentation[tab.key];
    if (shown === undefined || shown.version === "") return null;
    if (shown.editing) {
      return { kind: "document_editor", key: tab.key, document: tab.key };
    }
    return {
      kind: "document_viewer",
      key: tab.key,
      document: tab.key,
      version: shown.version,
    };
  }
  if (tab.kind === "terminal") {
    const folder = folderRef(tab.folder);
    if (folder === null) return null;
    return { kind: "terminal", key: tab.key, project_folder: folder };
  }
  if (tab.kind === "app_panel") {
    if (tab.app === undefined || tab.screen === undefined) return null;
    return {
      kind: "app_panel",
      key: tab.key,
      app: tab.app,
      surface: tab.screen,
      ...(sessions[tab.key] === undefined
        ? {}
        : { view_session: sessions[tab.key] }),
    };
  }
  return null;
}

export function layoutHint(input: {
  project: string;
  view: WorkspaceView;
  presentation: Readonly<Record<string, TabPresentation>>;
  /** 앱 패널 탭이 연 view의 session. 탭 key로 찾는다. */
  sessions?: Readonly<Record<string, string>>;
}): ViewHint {
  let pending = false;
  const panes = input.view.panes.map((pane) => {
    const tabs: HintTab[] = [];
    for (const tab of pane.tabs) {
      if (tab.kind === "document_editor" || tab.kind === "document_viewer") {
        const shown = input.presentation[tab.key];
        if (shown === undefined || shown.version === "") pending = true;
      }
      const hinted = hintTab(tab, input.presentation, input.sessions ?? {});
      if (hinted !== null) tabs.push(hinted);
    }
    return { tabs, selected: pane.selected };
  });
  const focused = input.view.panes[input.view.focusedPane];
  const selected = focused?.tabs.find((tab) => tab.key === focused.selected);
  const appTab = selected?.kind === "app_panel" &&
      selected.app !== undefined && selected.screen !== undefined
    ? selected.key
    : null;
  return {
    project: input.project,
    panes,
    focused_pane: input.view.focusedPane,
    app_tab: appTab,
    pending,
  };
}
