// 앱 화면의 view binding(`app_views/*`)과 `AppViewEvent`. shell main과 폰 host가 같은 표를 쓴다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  appViewsCall,
  appViewsClose,
  appViewsOpen,
  type AppViewsOpenInput,
} from "../../../protocol/apps/views.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { callView } from "./call.ts";
import { deliverAppEvent, type PublishedAppEvent } from "./events.ts";
import type { AppViewsPorts } from "./ports.ts";
import { createViewTable } from "./table.ts";

export type { AppViewsPorts, ReleaseView } from "./ports.ts";
export type { PublishedAppEvent } from "./events.ts";
export { VIEWS_PER_OWNER } from "./table.ts";

export function createAppViews(ports: AppViewsPorts) {
  const table = createViewTable(ports);
  return {
    open: (owner: string, input: AppViewsOpenInput) => table.open(owner, input),
    async call(
      owner: string,
      input: { view: string; operation: string; input: unknown },
    ): Promise<Result<unknown>> {
      const entry = table.get(owner, input.view);
      if (entry === undefined) {
        return err({ code: "not_found", message: "view is not open" });
      }
      table.touch(entry);
      return callView(ports, entry, input.operation, input.input);
    },
    close: (owner: string, view: string) =>
      ok({ closed: table.close(owner, view) }),
    /** 폰 연결이 닫혔다(끊기, 기기 끊기, core 내려감). 그 기기의 view를 지운다. */
    closeOwner: (owner: string) => table.closeOwner(owner),
    /** Bus의 `AppViewChanged`. */
    changed: (app: string) => table.rebind(app),
    /** Bus의 `AppEventPublished`. */
    published: (event: PublishedAppEvent) =>
      deliverAppEvent(table, ports, event),
  };
}

export type AppViews = ReturnType<typeof createAppViews>;

/** memory route handler 셋. owner는 요청 credential의 principal이다. */
export function appViewHandlers(
  views: AppViews,
): (readonly [string, MemoryHandler])[] {
  return [
    [
      `${appViewsOpen.resource}/${appViewsOpen.method}`,
      (ctx, body) => views.open(ctx.principal, body as AppViewsOpenInput),
    ],
    [
      `${appViewsCall.resource}/${appViewsCall.method}`,
      (ctx, body) =>
        views.call(
          ctx.principal,
          body as { view: string; operation: string; input: unknown },
        ),
    ],
    [
      `${appViewsClose.resource}/${appViewsClose.method}`,
      (ctx, body) =>
        views.close(ctx.principal, (body as { view: string }).view),
    ],
  ];
}
