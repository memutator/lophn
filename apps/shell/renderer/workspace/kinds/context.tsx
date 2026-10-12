// context 탭 kind. context 하나와 그 하위 탭을 연다(shell/workspace#R17). 여는 길은 모두
// openContext 하나를 부른다(R31).
import { workspaceIcons } from "@lophn/design/components";

import { ContextTabBody } from "../contexts/context-tab-body.tsx";
import type { SubTab } from "../contexts/shared.ts";
import {
  CONTEXT_ID,
  contextOf,
  isSubTab,
  subTabOf,
  TAB_KEY,
} from "../contexts/tab-fields.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

/** 한 context의 탭 key. 같은 context는 한 탭으로 열려 다시 열면 고르기만 한다. */
export function contextTabKey(context: string): string {
  return `context:${context}`;
}

/**
 * Context 탭을 연다. sub를 주면 이미 열린 탭도 그 하위 탭으로 옮긴다(위반 toast의 [View]).
 * 제목은 아는 이름이 있으면 쓰고 없으면 읽은 뒤 채운다.
 */
export function openContext(
  host: TabHost,
  context: string,
  sub?: SubTab,
  title?: string,
): void {
  const key = contextTabKey(context);
  const known = title ?? host.contexts?.titleOf(context) ?? context;
  const current = host.view.panes.flatMap((pane) => pane.tabs).find((tab) =>
    tab.key === key
  );
  host.openTab({
    key,
    kind: "context",
    title: known,
    fields: { context, sub_tab: sub ?? "overview" },
  });
  if (current !== undefined && sub !== undefined) {
    host.patchTab(key, (tab) => ({
      fields: { ...tab.fields, sub_tab: sub },
    }));
  }
}

export const contextKind: TabKindDef = {
  kind: "context",
  labelKey: "contexts.label.frame-chip",
  icon: workspaceIcons.context,
  fromStored(stored, { key }) {
    const { context, sub_tab } = stored;
    if (typeof context !== "string" || !CONTEXT_ID.test(context)) return null;
    return {
      key,
      kind: "context",
      title: "",
      fields: { context, sub_tab: isSubTab(sub_tab) ? sub_tab : "overview" },
    };
  },
  toStored(tab) {
    const context = contextOf(tab);
    if (context === null || !TAB_KEY.test(tab.key)) return null;
    return {
      kind: "context",
      key: tab.key,
      context,
      sub_tab: subTabOf(tab),
    };
  },
  hint(tab) {
    const context = contextOf(tab);
    if (context === null) return null;
    return {
      kind: "context",
      key: tab.key,
      context,
      sub_tab: subTabOf(tab),
    };
  },
  render(tab, _active, host) {
    const contexts = host.contexts;
    const context = contextOf(tab);
    if (contexts === null || context === null) return null;
    return (
      <ContextTabBody
        key={tab.key}
        source={contexts.source}
        context={context}
        sub={subTabOf(tab)}
        onSub={(sub) =>
          host.patchTab(tab.key, (current) => ({
            fields: { ...current.fields, sub_tab: sub },
          }))}
        onOpenDocument={contexts.openPath}
        onOpenSearch={contexts.openSearch}
        onAsk={contexts.askContextEngineer}
        stamp={contexts.stampOf(context)}
      />
    );
  },
  // `+` › Context: 이 프로젝트의 context 목록에서 하나를 골라 그 탭을 연다(R15).
  launcher: {
    labelKey: "contexts.label.frame-chip",
    available: (host) => host.contexts !== null,
    choices: (host) =>
      host.contexts?.list.map((item) => ({ id: item.id, label: item.title })) ??
        [],
    open: (host, choice) => {
      if (choice !== undefined) openContext(host, choice);
    },
  },
};
