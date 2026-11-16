// 앱 위젯 값. (앱, key)마다 마지막 값을 메모리에만 둔다(저장하지 않는다: lophn을 다시 켜면 앱이 시작할 때 다시 낸다).
// 보관된 앱과 선언에서 빠진 key의 값은 읽을 때 걸러 지운다(앱 보관 command가 이 module을 모르게 한다. tray와 같다).
import { err, ok, type Clock, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { WidgetDeclaration } from "../../../protocol/apps/declaration/mod.ts";
import type {
  AppWidget,
  AppWidgetSetInput,
  WidgetValue,
} from "../../../protocol/apps/widget.ts";
import type { MemoryHandler } from "../../server/mod.ts";

export type DeclaredWidgets = { name: string; widgets: WidgetDeclaration[] };

export type WidgetsDeps = {
  clock: Clock;
  // 그 앱이 있고 active인가. null이면 없는 앱이다.
  appStatus(app: string): "active" | "archived" | null;
  // active release가 선언한 위젯과 앱 이름. active release가 없으면 null이다.
  declaredWidgets(app: string): Result<DeclaredWidgets | null>;
  // active 앱마다 declaredWidgets와 같은 것. active release가 없는 앱은 뺀다.
  appsWithWidgets(): Result<({ app: string } & DeclaredWidgets)[]>;
};

type Stored = { value: WidgetValue; at: string };

export function createWidgets(deps: WidgetsDeps): {
  set: MemoryHandler;
  list: MemoryHandler;
} {
  const values = new Map<string, Map<string, Stored>>();
  return {
    set(ctx, input) {
      const actor = parseActor(ctx.actor);
      if (actor?.kind !== "app") {
        return err({
          code: "forbidden",
          message: "only an app sets its own widget",
        });
      }
      const status = deps.appStatus(actor.id);
      if (status === null) {
        return err({ code: "not_found", message: "app not found" });
      }
      if (status !== "active") {
        return err({ code: "conflict", message: "app is archived" });
      }
      const declared = deps.declaredWidgets(actor.id);
      if (!declared.ok) return declared;
      const { key, value } = input as AppWidgetSetInput;
      if (!declared.value?.widgets.some((widget) => widget.key === key)) {
        return err({
          code: "invalid_input",
          message: `widget "${key}" is not declared`,
        });
      }
      const mine = values.get(actor.id) ?? new Map<string, Stored>();
      if (value === null) mine.delete(key);
      else mine.set(key, { value, at: deps.clock.now() });
      if (mine.size === 0) values.delete(actor.id);
      else values.set(actor.id, mine);
      return ok({ set: true });
    },
    list() {
      const apps = deps.appsWithWidgets();
      if (!apps.ok) return apps;
      const widgets: AppWidget[] = [];
      const live = new Map<string, Set<string>>();
      for (const { app, name, widgets: declared } of apps.value) {
        live.set(app, new Set(declared.map((widget) => widget.key)));
        for (const widget of declared) {
          const stored = values.get(app)?.get(widget.key);
          widgets.push({
            app: app as AppWidget["app"],
            app_name: name,
            key: widget.key,
            label: widget.label,
            screen: widget.screen ?? null,
            value: stored?.value ?? null,
            at: (stored?.at ?? null) as AppWidget["at"],
          });
        }
      }
      for (const [app, mine] of [...values]) {
        const keys = live.get(app);
        for (const key of [...mine.keys()]) {
          if (!keys?.has(key)) mine.delete(key);
        }
        if (mine.size === 0) values.delete(app);
      }
      return ok({ widgets });
    },
  };
}
