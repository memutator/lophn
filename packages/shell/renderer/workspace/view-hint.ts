// 작업대 화면이 main에 보내는 현재 보기 힌트. 제목·경로·본문·터미널 출력은
// 넣지 않는다. 탭마다 무엇을 보낼지는 kind의 선언이 정한다.
import type { WorkspaceView } from "./model.ts";
import type { HintContext, HintTab } from "./kinds/kind.ts";
import { tabKindOf } from "./kinds/registry.ts";

export type { HintTab };

export interface ViewHint {
  project: string;
  panes: { tabs: HintTab[]; selected: string | null }[];
  focused_pane: number;
  app_tab: string | null;
}

export function layoutHint(input: {
  project: string;
  view: WorkspaceView;
  /** 앱 패널 탭이 연 view의 session. 탭 key로 찾는다. */
  sessions?: Readonly<Record<string, string>>;
}): ViewHint {
  const ctx: HintContext = { sessions: input.sessions ?? {} };
  // 힌트는 kind의 선언이 만든다. 등록되지 않은 kind의 탭은 힌트에 넣지 않는다.
  const panes = input.view.panes.map((pane) => {
    const tabs: HintTab[] = [];
    for (const tab of pane.tabs) {
      const kind = tabKindOf(tab.kind);
      if (kind === undefined) continue;
      const hinted = kind.hint(tab, ctx);
      if (hinted !== null) tabs.push(hinted);
    }
    return { tabs, selected: pane.selected };
  });
  const focused = input.view.panes[input.view.focusedPane];
  const selected = focused?.tabs.find((tab) => tab.key === focused.selected);
  const appTab = selected !== undefined &&
      tabKindOf(selected.kind)?.hasAppView?.(selected) === true
    ? selected.key
    : null;
  return {
    project: input.project,
    panes,
    focused_pane: input.view.focusedPane,
    app_tab: appTab,
  };
}
