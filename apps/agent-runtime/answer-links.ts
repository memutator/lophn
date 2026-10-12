import { ok, type Result } from "../../packages/base/mod.ts";
import {
  type MessageLink,
  messageLinkSchema,
  runBody,
  toolCallList,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 답 메시지의 결과 링크(lophn-agent/conversation#R4)다. 이 run이 실제로 저장한 문서 판과 다룬 context만 싣는다.
// 문서 판은 문서 저장 tool의 call 중 성공했고 새 판이 확정된 결과(`status: saved`)뿐이다. 계획이나 같은 내용이라
// 새 판이 없는 호출, 실패·불명확한 호출은 링크가 아니다. 같은 문서를 여러 번 저장했으면 마지막 판이다.
const SAVE_TOOLS = new Set(["document.create", "document.save_version"]);
// context 링크도 같은 결과 링크다: 이 run이 `context.create`로 만든 context와 `context.read_contract`로
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
  const saved = new Map<string, string>();
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
        (!SAVE_TOOLS.has(call.tool) && contextField === undefined) ||
        call.outcome?.kind !== "success" || call.output === null
      ) continue;
      const body = await readOf(machine, runBody, {
        kind: "tool_call_output",
        id: call.id,
      });
      if (!body.ok) return body;
      const found = (body.value.value as { content?: unknown }).content;
      if (contextField !== undefined) {
        const context = (found as Record<string, unknown> | null)
          ?.[contextField];
        if (
          messageLinkSchema.safeParse({ kind: "context", context }).success
        ) contexts.add(context as string);
        continue;
      }
      const content = found as {
        status?: unknown;
        version_confirmed?: unknown;
        document?: unknown;
        version?: unknown;
      } | null;
      if (
        content?.status === "saved" && content.version_confirmed === true &&
        typeof content.document === "string" &&
        typeof content.version === "string"
      ) {
        saved.set(content.document, content.version);
      }
    }
    if (listed.value.next_cursor == null) break;
    cursor = listed.value.next_cursor;
  }
  return ok([
    ...[...saved].map(([document, version]) => ({
      kind: "version" as const,
      document,
      version,
    })),
    ...[...contexts].map((context) => ({ kind: "context" as const, context })),
  ]);
}
