import { ok, type Result } from "../../packages/base/mod.ts";
import {
  type MessageLink,
  runBody,
  toolCallList,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { type CoreCall, readOf } from "./core-call.ts";

// 답 메시지의 결과 링크(lophn-agent/conversation#R4)다. 이 run이 실제로 저장한 문서 판만 싣는다:
// 문서 저장 tool의 call 중 성공했고 새 판이 확정된 결과(`status: saved`)뿐이다. 계획이나 같은 내용이라
// 새 판이 없는 호출, 실패·불명확한 호출은 링크가 아니다. 같은 문서를 여러 번 저장했으면 마지막 판이다.
const SAVE_TOOLS = new Set(["document.create", "document.save_version"]);

export async function savedDocumentLinks(
  machine: CoreCall,
  run: string,
): Promise<Result<MessageLink[]>> {
  const saved = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const listed = await readOf(machine, toolCallList, {
      run,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!listed.ok) return listed;
    for (const call of listed.value.tool_calls) {
      if (
        !SAVE_TOOLS.has(call.tool) || call.outcome?.kind !== "success" ||
        call.output === null
      ) continue;
      const body = await readOf(machine, runBody, {
        kind: "tool_call_output",
        id: call.id,
      });
      if (!body.ok) return body;
      const content = (body.value.value as {
        content?: {
          status?: unknown;
          version_confirmed?: unknown;
          document?: unknown;
          version?: unknown;
        } | null;
      }).content;
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
  return ok(
    [...saved].map(([document, version]) => ({
      kind: "version" as const,
      document,
      version,
    })),
  );
}
