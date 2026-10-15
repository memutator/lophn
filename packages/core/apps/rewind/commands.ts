import { err, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { appRewind, type Rewind } from "../../../protocol/apps/calls/mod.ts";
import type {
  Input,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import type { AppRewind } from "../ports.ts";
import { appAccessDenied, authorizeAppId } from "../registration/mod.ts";

// rewind는 호출 중에 앱 process를 기다리므로 writer transaction 안의 CommandDefinition으로 둘 수 없다.
// 그래서 (ctx, input)을 받는 async handler다. 조립이 writer 앞에서 `app.rewind`를 이 handler로 돌린다.
export type AppRewindCommand = {
  route: typeof appRewind;
  handle(
    ctx: RequestContext,
    input: Input<typeof appRewind>,
  ): Promise<Result<Rewind>>;
};

export function createAppRewindCommand(
  deps: { rewind: AppRewind; port: ReadSnapshot["port"] },
): AppRewindCommand {
  return {
    route: appRewind,
    async handle(ctx, input) {
      // 범위 밖 앱은 없는 앱과 같다.
      const access = authorizeAppId(deps.port, ctx, appRewind.name, input.app);
      if (!access.ok) {
        return appAccessDenied(access)
          ? err({ code: "not_found", message: "app not found" })
          : access;
      }
      return await deps.rewind.apply(
        input.app as Id<"app">,
        input.from_invocation as Id<"inv">,
        ctx.actor,
      );
    },
  };
}
