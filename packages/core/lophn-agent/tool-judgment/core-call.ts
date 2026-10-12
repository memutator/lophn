import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";

// core 읽기와 command는 주입한 호출로만 한다. machine 자격의 loopback이 보통이다.
export type CoreCall = (
  path: string,
  body: unknown,
) => Promise<Result<unknown>>;

export async function post<O extends z.ZodType>(
  call: CoreCall,
  route: { resource: string; method: string; output: O },
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
