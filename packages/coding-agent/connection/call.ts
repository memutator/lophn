// route 하나를 부르는 공통 흐름이다. command는 envelope(key, compare)로, 나머지는 입력 그대로 보낸다.
// 호출자는 `run.ts`·`workflow.ts`이고 `protocol/runs`·`protocol/workflows`의 route를 넘긴다.
import type { LophnError, Result } from "../../base/mod.ts";
import type { Route } from "../../protocol/base/mod.ts";
import type { CoreClient } from "./client/core.ts";

type RouteCall = {
  route: Route;
  input: Record<string, unknown>;
  // 없으면 새로 만든다. 같은 key로 다시 부르면 같은 효과다.
  idempotencyKey?: string;
  // route의 compare 칸 값이다. 없으면 입력에서 compare 칸 이름으로 고른다.
  compare?: Record<string, unknown>;
  prepared?: readonly string[];
};

function compareOf(call: RouteCall): Record<string, unknown> {
  if (call.compare !== undefined) return call.compare;
  const shape = (call.route.compare as { shape?: Record<string, unknown> })
    ?.shape;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(shape ?? {})) {
    if (call.input[key] !== undefined) picked[key] = call.input[key];
  }
  return picked;
}

export function callRoute(
  client: CoreClient,
  call: RouteCall,
): Promise<Result<unknown, LophnError>> {
  if (call.route.kind === "command") {
    return client.command(call.route, {
      input: call.input,
      idempotency_key: call.idempotencyKey ?? crypto.randomUUID(),
      compare: compareOf(call),
      ...(call.prepared === undefined ? {} : { prepared: call.prepared }),
    });
  }
  return client.read(call.route, call.input);
}
