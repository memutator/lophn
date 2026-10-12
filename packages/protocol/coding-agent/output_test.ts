import { assert, assertEquals, assertThrows } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  agentFailureSchema,
  agentResultSchema,
  CLI_EXIT_CODES,
  CLI_EXITS,
  cliExit,
  effectUnknownSchema,
  MCP_PROTOCOL_ERRORS,
  mcpProtocolErrorSchema,
  mcpToolResult,
  mcpToolResultSchema,
  parseToolsets,
  READ_ONLY_TOOLS,
  readOnlyHint,
  REJECTED_TOOLSETS,
  SCOPE_MARKS,
} from "./output.ts";

const result = {
  summary: "3 documents",
  data: { documents: ["notes/plan"], cursor: null },
  next: ["lophn document show notes/plan"],
};

Deno.test("coding-agent/mcp-server#R5, coding-agent/cli#R2: 성공은 summary·data·next이고 MCP는 structured와 같은 JSON text를 보낸다", () => {
  const parsed = agentResultSchema.parse(result);
  assertEquals(parsed.summary, "3 documents");
  const sent = mcpToolResult(parsed);
  assertEquals(sent.structuredContent, parsed);
  assertEquals(JSON.parse(sent.content[0].text), parsed);
  assert(mcpToolResultSchema.safeParse(sent).success);
  assertEquals(
    mcpToolResultSchema.safeParse({
      ...sent,
      content: [{ type: "text", text: JSON.stringify({ summary: "other" }) }],
    }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R6, coding-agent/mcp-server#R7: 실패 code는 공통 7종이고 protocol 오류와 isError를 구별한다", () => {
  for (const code of ERROR_CODES) {
    agentFailureSchema.parse({ code, message: "rejected" });
  }
  assertEquals(
    agentFailureSchema.safeParse({
      code: "renamed",
      message: "no",
    }).success,
    false,
  );
  const failed = mcpToolResult(result, true);
  assertEquals(failed.isError, true);
  assertEquals(MCP_PROTOCOL_ERRORS, [-32700, -32600, -32601, -32602]);
  for (const code of MCP_PROTOCOL_ERRORS) {
    mcpProtocolErrorSchema.parse({ code, message: "bad request" });
  }
  assertEquals(
    mcpProtocolErrorSchema.safeParse({ code: -32000, message: "no" }).success,
    false,
  );
});

Deno.test("coding-agent/cli#R2, coding-agent/cli#R5: exit는 0·1·2·3·4·5·6이고 effect_unknown은 6이다", () => {
  assertEquals(CLI_EXIT_CODES, [0, 1, 2, 3, 4, 5, 6]);
  assertEquals(cliExit(undefined), CLI_EXITS.success);
  assertEquals(
    cliExit({ code: "invalid_input", message: "missing" }),
    CLI_EXITS.invalid_input,
  );
  assertEquals(
    cliExit({ code: "forbidden", message: "scope" }),
    CLI_EXITS.unauthorized,
  );
  assertEquals(
    cliExit({ code: "conflict", message: "stale" }),
    CLI_EXITS.failed,
  );
  assertEquals(
    cliExit({ code: "unavailable", message: "down" }),
    CLI_EXITS.transport,
  );
  const unknown = effectUnknownSchema.parse({
    code: "unavailable",
    message: "response lost",
    details: {
      diagnosis: "effect_unknown",
      idempotency_key: "save-1",
      subject: "doc_01h455vb4pex5v6nkc6gd5fdw1",
    },
  });
  assertEquals(cliExit(unknown), CLI_EXITS.effect_unknown);
  assertEquals(
    effectUnknownSchema.safeParse({
      code: "unavailable",
      message: "down",
      details: { diagnosis: "timeout" },
    }).success,
    false,
  );
});

Deno.test("coding-agent/mcp-server#R3, coding-agent/mcp-server#R4: toolset은 core 기본이고 ops·catalog·all을 거절하며 readOnlyHint는 읽기 tool만 붙인다", () => {
  assertEquals(parseToolsets(undefined), ["core"]);
  assertEquals(parseToolsets("core,app"), ["core", "app"]);
  assertEquals(SCOPE_MARKS, ["S", "A", "G", "ALL"]);
  for (const name of REJECTED_TOOLSETS) {
    assertThrows(() => parseToolsets(name));
  }
  assertEquals(readOnlyHint("lophn_index"), true);
  assertEquals(readOnlyHint("lophn_save"), undefined);
  assertEquals(readOnlyHint("lophn_format"), undefined);
  assert((READ_ONLY_TOOLS as readonly string[]).includes("lophn_document"));
  assertEquals(
    (READ_ONLY_TOOLS as readonly string[]).includes("lophn_format"),
    false,
  );
});
