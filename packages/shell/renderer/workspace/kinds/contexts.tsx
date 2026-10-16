// contexts 탭 kind. 이 프로젝트의 context를 카드로 나열한다. 대상 필드가
// 없고 탭은 프로젝트에 하나다.
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { ContextsTab } from "../contexts/contexts-tab.tsx";
import { TAB_KEY } from "../contexts/tab-fields.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import { openContext } from "./context.tsx";

export const CONTEXTS_TAB_KEY = "contexts";

/** Contexts 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openContexts(host: TabHost): void {
  host.openTab({
    key: CONTEXTS_TAB_KEY,
    kind: "contexts",
    title: t("contexts.label.rail-contexts"),
  });
}

export const contextsKind: TabKindDef = {
  kind: "contexts",
  labelKey: "contexts.label.rail-contexts",
  icon: workspaceIcons.context,
  fromStored(_stored, { key }) {
    return { key, kind: "contexts", title: t("contexts.label.rail-contexts") };
  },
  toStored(tab) {
    if (!TAB_KEY.test(tab.key)) return null;
    return { kind: "contexts", key: tab.key };
  },
  hint: (tab) => ({ kind: "contexts", key: tab.key }),
  render(tab, _active, host) {
    const contexts = host.contexts;
    if (contexts === null) return null;
    return (
      <ContextsTab
        key={tab.key}
        projectTitle={host.projectTitle ?? ""}
        project={host.projectId}
        source={contexts.source}
        onOpenContext={(context) => openContext(host, context)}
        onChanged={contexts.refresh}
      />
    );
  },
};
