import { err, ok, type Result } from "../../../base/mod.ts";
import { type Id, idSchema } from "../../../protocol/base/ids.ts";
import { appRewindPlan, appRewinds } from "../../../protocol/apps/calls/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import type { AppRewind } from "../ports.ts";
import { appAccessDenied, authorizeAppId } from "../registration/mod.ts";
import { loadRewinds } from "./store.ts";

const PAGE = 50;

// 범위 밖 앱은 없는 앱과 같다.
function inScope(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  app: string,
): Result<void> {
  const access = authorizeAppId(snapshot.port, ctx, operation, app);
  return access.ok
    ? access
    : appAccessDenied(access)
    ? err({ code: "not_found", message: "app not found" })
    : access;
}

export function createRewindReads(deps: { rewind: AppRewind }): {
  plan: ReadDefinition<typeof appRewindPlan>;
  list: ReadDefinition<typeof appRewinds>;
} {
  return {
    plan: {
      route: appRewindPlan,
      handle(snapshot, ctx, input) {
        const access = inScope(snapshot, ctx, appRewindPlan.name, input.app);
        if (!access.ok) return access;
        const plan = deps.rewind.plan(
          input.app as Id<"app">,
          input.from_invocation as Id<"inv">,
        );
        if (!plan.ok) return plan;
        return ok({
          plan: plan.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: appRewinds,
      handle(snapshot, ctx, input) {
        const access = inScope(snapshot, ctx, appRewinds.name, input.app);
        if (!access.ok) return access;
        if (
          input.cursor !== undefined &&
          !idSchema("rwd").safeParse(input.cursor).success
        ) {
          return err({ code: "invalid_input", message: "invalid cursor" });
        }
        const limit = input.limit ?? PAGE;
        // 한 개 더 읽어 다음 page가 있는지 본다.
        const rewinds = loadRewinds(snapshot.sql, {
          app: input.app as Id<"app">,
          invocation: input.invocation as Id<"inv"> | undefined,
          after: input.cursor as Id<"rwd"> | undefined,
          limit: limit + 1,
        });
        if (!rewinds.ok) return rewinds;
        const page = rewinds.value.slice(0, limit);
        return ok({
          rewinds: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rewinds.value.length > limit
            ? page[page.length - 1].id
            : null,
        });
      },
    },
  };
}
