// 앱 자격 route(`app_sessions.*`, `app_calls.*`, `app_agents.*`)의 공통 입구. 앱 자격(앱 process의 app credential)이면 app은 자격이
// 정하고 입력에 있으면 같아야 한다. 사람 자격(shell main이 앱 화면을 대신한다)이면 입력의 app을 쓴다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";

export function appOf(
  who: AuthenticatedContext,
  input: { app?: string },
): Result<string> {
  const actor = parseActor(who.actor);
  if (actor?.kind === "app") {
    return input.app === undefined || input.app === actor.id
      ? ok(actor.id)
      : err({ code: "forbidden", message: "an app acts as itself" });
  }
  return input.app === undefined
    ? err({ code: "invalid_input", message: "app is required" })
    : ok(input.app);
}

export function appHandler<T extends { app?: string }>(
  run: (
    app: string,
    input: T,
    who: AuthenticatedContext,
  ) => Promise<Result<unknown>> | Result<unknown>,
): MemoryHandler {
  return async (who, body) => {
    const input = body as T;
    const app = appOf(who, input);
    if (!app.ok) return app;
    return await run(app.value, input, who);
  };
}

export const routeKey = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;
