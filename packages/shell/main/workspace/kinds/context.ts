// context 탭 kind. context 하나와 그 하위 탭을 연다. drafting 중인 context도
// 같은 값을 쓴다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { CONTEXT_SUB_TABS, contextId, idOf, tabKey } from "./values.ts";

const subTab = z.enum(CONTEXT_SUB_TABS);

const layout = z.strictObject({
  kind: z.literal("context"),
  key: tabKey,
  context: contextId,
  sub_tab: subTab.default("overview"),
});

export type ContextLayout = z.infer<typeof layout>;
export type ContextHint = {
  kind: "context";
  key: string;
  context: string;
  sub_tab: (typeof CONTEXT_SUB_TABS)[number];
};
export type ContextView = {
  kind: "context";
  key: string;
  context: string;
  sub_tab: (typeof CONTEXT_SUB_TABS)[number];
  selected: boolean;
};

export const contextKind = defineTabKind<
  ContextLayout,
  ContextHint,
  ContextView
>({
  kind: "context",
  layout,
  // 없어졌거나 보관된 context는 이유를 가진 자리표시다.
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
  hint(raw, key) {
    const context = idOf("ctx", raw.context);
    if (context === null) return null;
    const sub = subTab.safeParse(raw.sub_tab);
    return {
      kind: "context",
      key,
      context,
      sub_tab: sub.success ? sub.data : "overview",
    };
  },
  scope(hint, reads) {
    reads.allow("context", hint.context, "contexts", {
      context: hint.context,
    });
  },
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key) || !ctx.refOk(hint.context)) return null;
    if (!ctx.scope.allows("context", hint.context)) return null;
    return {
      kind: hint.kind,
      key: hint.key,
      context: hint.context,
      sub_tab: hint.sub_tab,
      selected,
    };
  },
  describe: (view) => `${view.context} ${view.sub_tab}`,
});
