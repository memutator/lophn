// 복원은 현재 대상과 권한을 다시 읽는다(shell/workspace#R7). 저장된 참조를 그대로
// 믿지 않는다. 없거나 못 쓰는 대상은 이유를 가진 자리표시로 남기고 terminal은
// 종료된 자리표시다(PTY를 만들지 않는다).
import type { LayoutPane, LayoutTab } from "./schema.ts";

export type PlaceholderReason =
  | "document_missing"
  | "version_missing"
  | "app_unavailable"
  | "no_permission";

export type RestoredTab =
  | { kind: "tab"; tab: LayoutTab }
  | {
    kind: "placeholder";
    key: string;
    origin: LayoutTab["kind"];
    title: string;
    reason: PlaceholderReason;
  };

/** 탭 대상을 지금 기준으로 검사하는 통로. 테스트가 가짜를 끼운다. */
export interface RestoreTargets {
  /** 문서가 살아 있고 이 판이 있는지. */
  document(document: string, version: string): Promise<boolean>;
  /** 문서가 살아 있는지(viewer가 아닌 editor용). */
  documentExists(document: string): Promise<boolean>;
  /** 앱이 살아 있고 실행 가능한지. */
  app(app: string): Promise<boolean>;
  /** 사람의 읽기 권한이 있는지. */
  canRead(document: string): Promise<boolean>;
}

export type RestoredPane = {
  pane: number;
  selected_tab: string | null;
  tabs: RestoredTab[];
};

export type RestoreOutcome = {
  panes: RestoredPane[];
  focused_pane: number;
  split_ratio: number;
  placeholders: number;
};

/** terminal은 종료된 자리표시다. 사람이 새로 시작하기 전까지 PTY를 만들지 않는다. */
function terminalPlaceholder(tab: LayoutTab): RestoredTab {
  return tab.kind === "terminal"
    ? {
      kind: "placeholder",
      key: tab.key,
      origin: "terminal",
      title: tab.project_folder,
      reason: "app_unavailable",
    }
    : {
      kind: "placeholder",
      key: tab.key,
      origin: tab.kind,
      title: tab.kind,
      reason: "app_unavailable",
    };
}

/**
 * 저장된 탭을 지금의 대상·권한으로 검사한다. terminal은 항상 종료 placeholder다.
 * 문서·viewer·app_panel은 통로의 현재 응답으로 판단한다.
 */
export async function restoreTab(
  tab: LayoutTab,
  targets: RestoreTargets,
): Promise<RestoredTab> {
  if (tab.kind === "terminal") return terminalPlaceholder(tab);
  if (tab.kind === "document_editor") {
    if (!(await targets.canRead(tab.document))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.document,
        reason: "no_permission",
      };
    }
    if (!(await targets.documentExists(tab.document))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.document,
        reason: "document_missing",
      };
    }
    return { kind: "tab", tab };
  }
  if (tab.kind === "document_viewer") {
    if (!(await targets.canRead(tab.document))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.document,
        reason: "no_permission",
      };
    }
    if (!(await targets.document(tab.document, tab.version))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.document,
        reason: "version_missing",
      };
    }
    return { kind: "tab", tab };
  }
  // app_panel
  if (!(await targets.app(tab.app))) {
    return {
      kind: "placeholder",
      key: tab.key,
      origin: tab.kind,
      title: tab.app,
      reason: "app_unavailable",
    };
  }
  return { kind: "tab", tab };
}

/**
 * 한 판을 복원한다. 선택 탭이 placeholder가 되면 첫 살아 있는 탭으로 옮기고,
 * 칸이 비면 선택은 null이다.
 */
export async function restorePane(
  pane: LayoutPane,
  index: number,
  targets: RestoreTargets,
): Promise<RestoredPane> {
  const tabs: RestoredTab[] = [];
  for (const tab of pane.tabs) {
    tabs.push(await restoreTab(tab, targets));
  }
  const selected = pane.selected_tab;
  const firstAlive = tabs.find((restored) => restored.kind === "tab");
  const selectedRestored = selected === null
    ? null
    : tabs.some((restored) =>
        restored.kind === "tab" && restored.tab.key === selected
      )
    ? selected
    : firstAlive
    ? firstAlive.tab.key
    : null;
  return { pane: index, selected_tab: selectedRestored, tabs };
}

/** 저장된 panes 전체를 지금 기준으로 복원한다. */
export async function restoreLayout(
  panes: readonly LayoutPane[],
  splitRatio: number,
  focusedPane: number,
  targets: RestoreTargets,
): Promise<RestoreOutcome> {
  const restored: RestoredPane[] = [];
  for (let index = 0; index < panes.length; index++) {
    restored.push(await restorePane(panes[index]!, index, targets));
  }
  const focused = focusedPane < restored.length ? focusedPane : 0;
  const placeholders = restored.reduce(
    (count, pane) =>
      count + pane.tabs.filter((tab) => tab.kind === "placeholder").length,
    0,
  );
  return {
    panes: restored,
    focused_pane: focused,
    split_ratio: splitRatio,
    placeholders,
  };
}
