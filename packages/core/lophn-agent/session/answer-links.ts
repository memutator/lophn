import { ok, type Result } from "../../../base/mod.ts";
import {
  type MessageLink,
  messageLinkSchema,
  runBody,
  toolCallList,
} from "../../../protocol/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";

// 답 메시지의 결과 링크다. 이 run이 다룬 context만 싣는다: 이 run이 `context.create`로 만든 context와 `context.read_contract`로
// 계약을 읽은 context다. 결과에서 context ID를 읽는 자리는 tool마다 다르다. 목록·검색 결과의 context는
// 이 run이 다룬 것이 아니라 링크가 아니다.
const CONTEXT_FIELD: Readonly<Record<string, string>> = {
  "context.create": "id",
  "context.read_contract": "context",
};

export async function resultLinks(
  machine: CoreCall,
  run: string,
): Promise<Result<MessageLink[]>> {
  const contexts = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const listed = await readOf(machine, toolCallList, {
      run,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const call of listed.value.tool_calls) {
      const contextField = CONTEXT_FIELD[call.tool];
      if (
        contextField === undefined ||
        call.outcome?.kind !== "success" || call.output === null
      ) continue;
      const body = await readOf(machine, runBody, {
        kind: "tool_call_output",
        id: call.id,
      });
      if (!body.ok) return body;
      const found = (body.value.value as { content?: unknown }).content;
      const context = (found as Record<string, unknown> | null)
        ?.[contextField];
      if (
        messageLinkSchema.safeParse({ kind: "context", context }).success
      ) contexts.add(context as string);
    }
    if (listed.value.next_cursor == null) break;
    cursor = listed.value.next_cursor;
  }
  return ok([
    ...[...contexts].map((context) => ({ kind: "context" as const, context })),
  ]);
}
