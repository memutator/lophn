// 앱 자격 route(`app_sessions.*`, `app_calls.*`, `app_agents.*`)의 공통 입구. 앱 자격(앱 process의 app credential)이면 app은 자격이
// 정하고 입력에 있으면 같아야 한다. 사람 자격(이 컴퓨터의 shell main이 앱 화면을 대신한다)이면 입력의 app을 쓴다. 기기(principal
// `device:<id>`, 다른 컴퓨터의 shell이 그 컴퓨터에 띄운 이 기계의 앱 화면을 대신한다)는 자기가 연 앱 화면의 view를 줘야 하고 app은
// 그 view의 앱이다: 기기가 view 없이 아무 앱이나 대신하지 못하게 한다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { AppViews } from "../../../apps/views/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";

/** 기기 principal인가. 기기 자격은 actor user에 principal `device:<id>`다(core/remote/call.ts). */
export const isDevicePrincipal = (who: AuthenticatedContext) =>
  who.principal.startsWith("device:");

export function appOf(
  who: AuthenticatedContext,
  input: { app?: string; view?: string },
  views: Pick<AppViews, "viewApp">,
): Result<string> {
  const actor = parseActor(who.actor);
  if (actor?.kind === "app") {
    return input.app === undefined || input.app === actor.id
      ? ok(actor.id)
      : err({ code: "forbidden", message: "an app acts as itself" });
  }
  if (isDevicePrincipal(who)) {
    if (input.view === undefined) {
      return err({
        code: "forbidden",
        message: "a device acts only through an app screen it opened",
      });
    }
    const bound = views.viewApp(who.principal, input.view);
    if (bound === null) {
      return err({ code: "not_found", message: "view is not open" });
    }
    if (!bound.usable) {
      return err({ code: "forbidden", message: "the view is not bound" });
    }
    return input.app === undefined || input.app === bound.app
      ? ok(bound.app)
      : err({ code: "forbidden", message: "the view is of another app" });
  }
  return input.app === undefined
    ? err({ code: "invalid_input", message: "app is required" })
    : ok(input.app);
}

/** 이 입구를 거치는 handler를 짓는다. view 표는 늦게 생기는 칸이라 부를 때 읽는다. */
export function appHandlerFor(views: () => Pick<AppViews, "viewApp">) {
  return function appHandler<T extends { app?: string; view?: string }>(
    run: (
      app: string,
      input: T,
      who: AuthenticatedContext,
    ) => Promise<Result<unknown>> | Result<unknown>,
  ): MemoryHandler {
    return async (who, body) => {
      const input = body as T;
      const app = appOf(who, input, views());
      if (!app.ok) return app;
      // view는 앱을 정하는 데만 쓴다. 뒤의 command 입력에 넘기지 않는다.
      const { view: _view, ...rest } = input;
      return await run(app.value, rest as T, who);
    };
  };
}

export const routeKey = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;
