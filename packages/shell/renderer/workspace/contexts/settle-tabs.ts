// 복원한 layout의 Context·Search 탭을 지금의 context 목록으로 고른다. 없어졌거나
// 보관된 context의 탭은 다른 없는 대상처럼 빠지고, 남는 탭은 이름을 얻는다. 나머지 탭의 순서와
// 선택은 그대로다.
import { t } from "@lophn/wording";

import { closeTab, type TabItem, type WorkspaceView } from "../model.ts";
import { contextOf } from "./tab-fields.ts";

type Titled = { readonly id: string; readonly title: string };

/** Search 탭 이름: "Search · eval". */
export function searchTabTitle(context: string | undefined): string {
  const kind = t("contexts.label.rail-search");
  return context === undefined ? kind : `${kind} · ${context}`;
}

function isContextTab(tab: TabItem): boolean {
  // context 없이 열린 키워드 검색 탭은 context 목록과 상관없다.
  return tab.kind === "context" ||
    (tab.kind === "search" && contextOf(tab) !== null);
}

export function settleContextTabs(
  view: WorkspaceView,
  contexts: readonly Titled[],
): WorkspaceView {
  const titles = new Map(contexts.map((item) => [item.id, item.title]));
  let next = view;
  for (const pane of view.panes) {
    for (const tab of pane.tabs) {
      if (!isContextTab(tab)) continue;
      const context = contextOf(tab);
      if (context === null || !titles.has(context)) {
        // closeTab은 비어 가는 칸을 접으므로 지금 배치에서 그 탭이 있는 칸을 다시 찾는다.
        const at = next.panes.findIndex((candidate) =>
          candidate.tabs.some((item) => item.key === tab.key)
        );
        if (at >= 0) next = closeTab(next, at, tab.key);
      }
    }
  }
  return {
    ...next,
    panes: next.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => {
        if (!isContextTab(tab)) return tab;
        const name = titles.get(contextOf(tab) ?? "");
        if (name === undefined) return tab;
        return {
          ...tab,
          title: tab.kind === "search" ? searchTabTitle(name) : name,
        };
      }),
    })),
  };
}
