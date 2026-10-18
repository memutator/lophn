// app_panel 탭 kind. 앱의 panel 화면 하나를 연다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { appId, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("app_panel"),
  key: tabKey,
  title: z.string().min(1).max(200).optional(),
  app: appId,
  surface: z.string().min(1).max(128),
});

type AppPanelLayout = z.infer<typeof layout>;
export const appPanelKind = defineTabKind<AppPanelLayout>({
  kind: "app_panel",
  layout,
  async restore(tab, targets) {
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
  },
});
