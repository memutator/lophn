// 앱 tray 값. 앱마다 마지막 값을 메모리에만 둔다(저장하지 않는다: lophn을 다시 켜면 앱이 시작할 때 다시 낸다).
// 보관된 앱의 값은 읽을 때 걸러 지운다(앱 보관 command가 이 module을 모르게 한다).
import { err, ok, type Clock } from "../../../base/mod.ts";
import {
  type AppTraySetInput,
  type TrayValue,
} from "../../../protocol/apps/tray.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";

export type TrayDeps = {
  clock: Clock;
  // 그 앱이 있고 active인가. null이면 없는 앱이다.
  appStatus(app: string): "active" | "archived" | null;
  // 값이 바뀌었다는 신호를 Bus로 낸다.
  changed(app: string, at: string): void;
};

export function createTray(deps: TrayDeps): {
  set: MemoryHandler;
  list: MemoryHandler;
} {
  const values = new Map<string, TrayValue>();
  return {
    set(ctx, input) {
      const actor = parseActor(ctx.actor);
      if (actor?.kind !== "app") {
        return err({
          code: "forbidden",
          message: "only an app sets its own tray",
        });
      }
      const status = deps.appStatus(actor.id);
      if (status === null) {
        return err({ code: "not_found", message: "app not found" });
      }
      if (status !== "active") {
        return err({ code: "conflict", message: "app is archived" });
      }
      const { text, tone } = input as AppTraySetInput;
      const at = deps.clock.now();
      if (text === null) values.delete(actor.id);
      else {
        values.set(actor.id, {
          app: actor.id as TrayValue["app"],
          text,
          tone: tone ?? "neutral",
          at: at as TrayValue["at"],
        });
      }
      deps.changed(actor.id, at);
      return ok({ set: true });
    },
    list() {
      for (const app of [...values.keys()]) {
        if (deps.appStatus(app) !== "active") values.delete(app);
      }
      return ok({ values: [...values.values()] });
    },
  };
}
