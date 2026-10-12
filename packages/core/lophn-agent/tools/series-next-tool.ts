// context series kind의 다음 이름 읽기 tool(lophn-agent/harness/tools#R24)이다. 옛 series 가족 읽기 통로
// (`series.next`, documents/series#R9)를 대체한다. 문서를 만들거나 series를 등록·변경하지 않고 이름만
// 돌려준다. 문서를 저장하는 일은 각 역할의 문서 저장 범위를 따르는 다른 tool의 몫이다.
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import {
  contractTypeNameSchema,
  ctxIdSchema,
} from "../../../protocol/projects/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import {
  type ContractCall,
  defineBuiltin,
  READ,
  success,
} from "./bundles/common.ts";
import {
  CONTEXT_SERIES_NEXT_CONTRACT,
  type SeriesNextRead,
} from "./context-route-shapes.ts";
import type { ToolDefinition } from "./registry.ts";
import type { RunCredential, ToolHandler } from "./work.ts";

export const SERIES_NEXT_TOOL = "series.next_name";
export const SERIES_NEXT_TOOL_REVISION = "series-next-1";

// route(`context.series_next`)와 결과 모양은 `context-route-shapes.ts`에 있다.
export const SERIES_NEXT_CONTRACT = CONTEXT_SERIES_NEXT_CONTRACT;
export type { SeriesNextRead };

// model은 context와 type 이름만 준다. pattern을 넘겨 series를 만들 수 없다.
const input = z.strictObject({
  context: ctxIdSchema,
  type: contractTypeNameSchema,
});

// harness/tools의 `BUILTIN_TOOLS`가 더하고 역할 상한 이름 표가 모든 역할에게 연다.
export const SERIES_NEXT_TOOLS: readonly ToolDefinition[] = [
  {
    ...defineBuiltin(
      SERIES_NEXT_TOOL_REVISION,
      SERIES_NEXT_TOOL,
      "Read the next document name of a series type of a context: the series pattern and the next name " +
        "{key, path, from, complete, taken}. It creates no document and changes no series. " +
        "A name with taken=true exists already: do not overwrite it. A name with a * left is not complete: " +
        "settle the * part yourself",
      input,
      SERIES_NEXT_CONTRACT,
      { ...READ, scopeCheck: "contexts the preset selection allows" },
    ),
    inputSchema: {
      type: "object",
      properties: {
        context: {
          type: "string",
          description: "the id of a context you may read",
        },
        type: {
          type: "string",
          description: "the name of a series kind type of that context",
        },
      },
      required: ["context", "type"],
      additionalProperties: false,
    },
  },
];

function describe(read: SeriesNextRead): string {
  const { next } = read;
  if (next.path === null) {
    return `${read.type}: no next name can be computed (no member yet)`;
  }
  const notes = [
    ...(next.taken ? ["already taken: do not overwrite"] : []),
    ...(next.complete ? [] : ["not complete: settle the * part"]),
  ];
  return `${read.type}: next name ${next.path}${
    notes.length === 0 ? "" : ` (${notes.join("; ")})`
  }`.slice(0, 400);
}

// `contexts`는 이 run의 preset 선택이 닿는 context id다(개체 읽기와 같다). 그 밖의 context는 core를 부르기 전에
// 없는 대상과 같은 not_found다. 선택이 비면 어느 context도 읽지 못한다.
export function createSeriesNextToolHandlers(
  ports: ContractCall,
  contexts: readonly string[],
): ReadonlyMap<string, ToolHandler> {
  const reach = new Set(contexts);
  const handler: ToolHandler = async (raw, credential: RunCredential) => {
    const request = raw as { context: string; type: string };
    if (!reach.has(request.context)) {
      return err({ code: "not_found", message: "no such series" });
    }
    const got = await ports.call(
      SERIES_NEXT_CONTRACT,
      { context: request.context, type: request.type },
      credential.run,
    );
    if (!got.ok) return got;
    const read = got.value as SeriesNextRead & { complete?: boolean };
    const content = {
      context: read.context,
      type: read.type,
      pattern: read.pattern,
      next: read.next,
    };
    const result: ToolResult = {
      ...success(describe(read), content),
      pending: [
        ...(read.next.taken ? ["next_name_taken"] : []),
        ...(read.next.path !== null && !read.next.complete
          ? ["next_name_incomplete"]
          : []),
      ],
    };
    return ok(result);
  };
  return new Map([[SERIES_NEXT_TOOL, handler]]);
}
