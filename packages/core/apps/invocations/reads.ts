import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Invocation,
  INVOCATION_STATUSES,
  invocationsGet,
  invocationsList,
} from "../../../protocol/apps/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeAppId } from "../registration/mod.ts";
import { loadInvocation, loadInvocations } from "./store.ts";

const PAGE = 50;

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

function invalidCursor(): Result<never> {
  return err({
    code: "invalid_input",
    message: "invalid invocation list cursor",
  });
}

const cursorSchema = z.strictObject({
  offset: z.number().int().min(0),
  app: z.string().nullable(),
  status: z.enum(INVOCATION_STATUSES).nullable(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

// 목록 page는 같은 조건 안에서만 이어진다. app·status·limit이 다른 cursor는
// invalid_input이다. 같은 조건이면 새 snapshot의 위치 그대로 이어 본다.
export function nextInvocationCursor(
  offset: number,
  app: string | undefined,
  status: Invocation["status"] | undefined,
  limit: number,
): string {
  return btoa(JSON.stringify({
    offset,
    app: app ?? null,
    status: status ?? null,
    limit,
  }));
}

export function invocationPageOffset(
  cursor: string | undefined,
  app: string | undefined,
  status: Invocation["status"] | undefined,
  limit: number,
  head: number,
): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0)),
      ),
    );
    const parsed = cursorSchema.safeParse(decoded);
    if (!parsed.success) return invalidCursor();
    if (parsed.data.app !== (app ?? null)) return invalidCursor();
    if (parsed.data.status !== (status ?? null)) return invalidCursor();
    if (parsed.data.limit !== limit) return invalidCursor();
    if (parsed.data.offset >= head) return invalidCursor();
    return ok(parsed.data.offset);
  } catch {
    return invalidCursor();
  }
}

export function createInvocationsReads(): {
  list: ReadDefinition<typeof invocationsList>;
  get: ReadDefinition<typeof invocationsGet>;
} {
  return {
    list: {
      route: invocationsList,
      handle(snapshot, ctx, input) {
        const invocations = loadInvocations(snapshot.sql, {
          app: input.app,
          status: input.status,
        });
        if (!invocations.ok) return invocations;
        const inScope = scopeOf(snapshot, ctx, invocationsList.name);
        const visible: Invocation[] = [];
        for (const row of invocations.value) {
          const allowed = inScope(row.app);
          if (!allowed.ok) return allowed;
          if (allowed.value) visible.push(row);
        }
        const limit = input.limit ?? PAGE;
        const head = visible.length;
        const offset = invocationPageOffset(
          input.cursor,
          input.app,
          input.status,
          limit,
          head,
        );
        if (!offset.ok) return offset;
        const start = offset.value;
        const page = visible.slice(start, start + limit);
        const next = start + page.length;
        return ok({
          invocations: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: next < head
            ? nextInvocationCursor(next, input.app, input.status, limit)
            : null,
        });
      },
    },
    get: {
      route: invocationsGet,
      handle(snapshot, ctx, input) {
        const invocation = loadInvocation(snapshot.sql, input.invocation);
        if (!invocation.ok) return invocation;
        if (invocation.value !== null) {
          const allowed = scopeOf(snapshot, ctx, invocationsGet.name)(
            invocation.value.app,
          );
          if (!allowed.ok) return allowed;
          // 범위 밖 기록은 없는 기록과 같은 모양이다.
          if (!allowed.value) {
            return ok({
              invocation: null,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            });
          }
        }
        // 기록이 없으면 그 부재를 그대로 표시한다. denied-scope row는
        // 부재와 같은 모양이 아니다. 알려진 ID는 null로 표시하지 않는다.
        return ok({
          invocation: invocation.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
