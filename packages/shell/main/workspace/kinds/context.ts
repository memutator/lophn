// context 탭 kind. context 하나와 그 하위 탭을 연다. drafting 중인 context도
// 같은 값을 쓴다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { CONTEXT_SUB_TABS, contextId, tabKey } from "./values.ts";

const subTab = z.enum(CONTEXT_SUB_TABS);

const layout = z.strictObject({
  kind: z.literal("context"),
  key: tabKey,
  context: contextId,
  sub_tab: subTab.default("overview"),
});

type ContextLayout = z.infer<typeof layout>;
export const contextKind = defineTabKind<ContextLayout>({
  kind: "context",
  layout,
  // 없어졌거나 보관된 context는 이유를 가진 placeholder다.
  async restore(tab, targets) {
    if (!(await targets.context(tab.context))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.context,
        reason: "context_missing",
      };
    }
    return { kind: "tab", tab };
  },
});
