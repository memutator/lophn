// 복원은 현재 대상과 권한을 다시 읽는다. 저장된 참조를 그대로
// 믿지 않는다. 없거나 못 쓰는 대상은 이유를 가진 placeholder로 남기고 terminal은
// 종료된 placeholder다(PTY를 만들지 않는다). 파일 탭은 파일이 없어도 지키고, 탭이 열릴 때 안내한다.
import { tabKindOf } from "./kinds/registry.ts";
import type { RestoredTab, RestoreTargets } from "./kinds/kind.ts";
import type { LayoutPane, LayoutTab } from "./schema.ts";

export type {
  PlaceholderReason,
  RestoredTab,
  RestoreTargets,
} from "./kinds/kind.ts";

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

/**
 * 저장된 탭을 지금의 대상·권한으로 검사한다. 대상 검사는 kind의 선언이 한다.
 * registry에 없는 kind는 null이다 — placeholder 없이 건너뛴다.
 */
export function restoreTab(
  tab: LayoutTab,
  targets: RestoreTargets,
): Promise<RestoredTab | null> {
  const kind = tabKindOf(tab.kind);
  return kind === undefined
    ? Promise.resolve(null)
    : kind.restore(tab, targets);
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
    const restored = await restoreTab(tab, targets);
    if (restored !== null) tabs.push(restored);
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
