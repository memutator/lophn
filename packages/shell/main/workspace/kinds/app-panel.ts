// app_panel 탭 kind. 앱의 panel 화면 하나를 연다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { appId, idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("app_panel"),
  key: tabKey,
  app: appId,
  surface: z.string().min(1).max(128),
});

export type AppPanelLayout = z.infer<typeof layout>;
export type AppPanelHint = {
  kind: "app_panel";
  key: string;
  app: string;
  surface: string;
  // 렌더러가 그 탭의 패널 view에서 얻은 식별자다. registry에 있는 view의 것일 때만 쓴다.
  view_session?: string;
};
export type AppPanelView = {
  kind: "app_panel";
  key: string;
  app: string;
  surface: string;
  view_session?: string;
  selected: boolean;
};

export const appPanelKind = defineTabKind<
  AppPanelLayout,
  AppPanelHint,
  AppPanelView
>({
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
  hint(raw, key) {
    const app = idOf("app", raw.app);
    if (
      app === null || typeof raw.surface !== "string" ||
      raw.surface.length === 0 || raw.surface.length > 80
    ) return null;
    const session = typeof raw.view_session === "string" &&
        raw.view_session.length > 0 && raw.view_session.length <= 80
      ? raw.view_session
      : undefined;
    return {
      kind: "app_panel",
      key,
      app,
      surface: raw.surface,
      ...(session === undefined ? {} : { view_session: session }),
    };
  },
  scope(hint, reads) {
    reads.allow("app", hint.app, "apps", { app: hint.app });
  },
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key) || !ctx.refOk(hint.app)) return null;
    if (!ctx.refOk(hint.surface)) return null;
    if (!ctx.scope.allows("app", hint.app)) return null;
    return {
      kind: hint.kind,
      key: hint.key,
      app: hint.app,
      surface: ctx.truncate(hint.surface),
      ...(typeof hint.view_session === "string" &&
          ctx.registry.panelSession?.(
              hint.app,
              hint.surface,
              hint.view_session,
            ) === true
        ? { view_session: hint.view_session }
        : {}),
      selected,
    };
  },
  describe: (view) => `${view.app}@${view.surface}`,
  appView(hint, registry) {
    const live = registry.appView(hint.app, hint.surface);
    if (!live) return null;
    return { app: hint.app, surface: hint.surface, ...live };
  },
});
