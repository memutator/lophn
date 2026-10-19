import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { appCallTool } from "../../../packages/protocol/apps/mod.ts";
import type { JsonValue } from "../../../packages/protocol/base/mod.ts";
import type { SetupContext } from "../types.ts";
import { type Material, textOf } from "./manifest.ts";

type Call = { app: string; api: string; input?: JsonValue };

// 쓰기 호출만 담는 재료라 실패는 곧 앱이 달라진 것이다. 이미 한 호출은 되돌리지 않는다(trial 폴더는 버려진다).
export async function restoreAppData(
  ctx: SetupContext,
  material: Material,
): Promise<Result<void>> {
  const calls = JSON.parse(textOf(material, "calls.json")) as Call[];
  const apps = calls.map((call) => ctx.world.apps[call.app]);
  const missing = calls.findIndex((_, index) => apps[index] === undefined);
  if (missing >= 0) {
    return err({
      code: "invalid_input",
      message: `app data ${material.ref}: app ${
        calls[missing].app
      } not restored`,
    });
  }
  for (const [index, call] of calls.entries()) {
    const { outcome } = await ctx.core.call(appCallTool, {
      target: { mode: "live", app: apps[index]!, release: null },
      tool: call.api,
      ...(call.input === undefined ? {} : { input: call.input }),
      caller: { kind: "person", view_session: "eval" },
    });
    if (outcome.status !== "succeeded") {
      return err({
        code: "unavailable",
        message: `app data ${material.ref}: call ${index + 1} (${call.api}) ${
          JSON.stringify(outcome)
        }`,
      });
    }
  }
  return ok(undefined);
}
