import type { z } from "zod";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { routePath } from "../../packages/protocol/platform/mod.ts";

// runtime이 core loopback을 부르는 얇은 호출이다. 응답은 route의 output schema로 다시 검사한다.

export type CoreCall = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

type Route<O extends z.ZodType> = {
  resource: string;
  method: string;
  output: O;
};

export async function readOf<O extends z.ZodType>(
  call: CoreCall,
  route: Route<O>,
  body: unknown,
): Promise<Result<z.output<O>>> {
  const reply = await call(routePath(route), body);
  if (!reply.ok) return reply;
  const parsed = route.output.safeParse(reply.value);
  if (!parsed.success) {
    return err({ code: "unavailable", message: "unexpected core reply" });
  }
  return ok(parsed.data);
}

// command 요청은 입력·비교 기준·idempotency key를 한 봉투에 싣는다. blob 준비 참조는 없다.
export function commandOf<O extends z.ZodType>(
  call: CoreCall,
  route: Route<O>,
  input: unknown,
  compare: unknown,
  key: string,
): Promise<Result<z.output<O>>> {
  return readOf(call, route, {
    input,
    idempotency_key: key,
    compare,
    prepared: [],
  });
}
