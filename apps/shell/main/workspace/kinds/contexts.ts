// contexts 탭 kind. project의 context 목록 자체를 보이므로 대상 필드가 없다(shell/workspace#R16).
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("contexts"),
  key: tabKey,
});

export type ContextsLayout = z.infer<typeof layout>;
export type ContextsHint = { kind: "contexts"; key: string };
export type ContextsView = {
  kind: "contexts";
  key: string;
  selected: boolean;
};

export const contextsKind = defineTabKind<
  ContextsLayout,
  ContextsHint,
  ContextsView
>({
  kind: "contexts",
  layout,
  // 대상이 없으니 복원 때 검사할 것도 없다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
  hint: (_raw, key) => ({ kind: "contexts", key }),
  scope: () => {},
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key)) return null;
    return { kind: hint.kind, key: hint.key, selected };
  },
  describe: () => "list",
});
