import { err, ok, type Result } from "../../../base/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import {
  type AppInvocation,
  appInvocation,
  appInvocations,
} from "../../../protocol/apps/calls/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeAppId } from "../registration/mod.ts";
import { listInvocations, loadInvocation } from "./store.ts";

const PAGE = 50;
// 열람 범위 밖 행을 건너뛰며 읽는 한 번의 크기.
const BATCH = 200;

// 호출 기록은 그 앱의 범위 안에서만 보인다. 범위 밖 앱의 기록은 없는 기록과 같다. 판정 의존이
// 없으면(unavailable) 열어 주지 않고 오류로 낸다.
function scopeOf(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
): (app: string) => Result<boolean> {
  const seen = new Map<string, Result<boolean>>();
  return (app) => {
    const known = seen.get(app);
    if (known !== undefined) return known;
    const access = authorizeAppId(snapshot.port, ctx, operation, app);
    const verdict: Result<boolean> = access.ok
      ? ok(true)
      : appAccessDenied(access)
        ? ok(false)
        : access;
    seen.set(app, verdict);
    return verdict;
  };
}

export function createInvocationsReads(): {
  list: ReadDefinition<typeof appInvocations>;
  get: ReadDefinition<typeof appInvocation>;
} {
  return {
    list: {
      route: appInvocations,
      handle(snapshot, ctx, input) {
        const { cursor, limit: asked, ...filter } = input;
        if (
          cursor !== undefined &&
          !idSchema("inv").safeParse(cursor).success
        ) {
          return err({ code: "invalid_input", message: "invalid cursor" });
        }
        const limit = asked ?? PAGE;
        const inScope = scopeOf(snapshot, ctx, appInvocations.name);
        // 한 개 더 모아 다음 page가 있는지 본다.
        const visible: AppInvocation[] = [];
        let after = cursor;
        while (visible.length <= limit) {
          const batch = listInvocations(snapshot.sql, filter, {
            after,
            limit: BATCH,
          });
          if (!batch.ok) return batch;
          for (const row of batch.value) {
            const allowed = inScope(row.app);
            if (!allowed.ok) return allowed;
            if (allowed.value) visible.push(row);
          }
          if (batch.value.length < BATCH) break;
          after = batch.value[batch.value.length - 1].id;
        }
        const page = visible.slice(0, limit);
        return ok({
          invocations: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: visible.length > limit ? page[page.length - 1].id : null,
        });
      },
    },
    get: {
      route: appInvocation,
      handle(snapshot, ctx, input) {
        const found = loadInvocation(snapshot.sql, input.invocation);
        if (!found.ok) return found;
        let invocation = found.value;
        if (invocation !== null) {
          const allowed = scopeOf(
            snapshot,
            ctx,
            appInvocation.name,
          )(invocation.app);
          if (!allowed.ok) return allowed;
          // 범위 밖 기록은 없는 기록과 같은 모양이다.
          if (!allowed.value) invocation = null;
        }
        return ok({
          invocation,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
