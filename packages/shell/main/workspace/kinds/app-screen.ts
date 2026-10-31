// app_screen 탭 kind. 앱 place의 현재 release 화면(entry screen)을 연다. 앱 place마다 하나다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { appId, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("app_screen"),
  key: tabKey,
  app: appId,
});

type AppScreenLayout = z.infer<typeof layout>;
export const appScreenKind = defineTabKind<AppScreenLayout>({
  kind: "app_screen",
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
