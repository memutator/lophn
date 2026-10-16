import { ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import { fitted } from "../domain/result.ts";
import type { ToolContext } from "../tool-context.ts";

// 보낼 수 있는 열린 session과 줄에 서서 기다리는 coding 맡기기. grant가 deny인 상대는 Router가 이미 뺐다.
export async function listSendable(
  ctx: ToolContext,
): Promise<Result<ToolResult>> {
  const read = await ctx.router.sendable();
  if (!read.ok) return read;
  const { sessions, queued_coding } = read.value;
  return ok(fitted(
    `${sessions.length} sessions can be called`,
    { sessions, queued_coding },
    ["sessions", "queued_coding"],
  ));
}
