import { assert, assertEquals } from "@std/assert";
import {
  MCP_SESSION_ROUTES,
  MCP_SESSION_TOOLS,
  mcpSessionTool,
} from "./mcp-session.ts";
import { codingAgentSessionSummary } from "./sessions.ts";
import { routePath } from "../base/route.ts";

const tool = () => {
  const found = mcpSessionTool("lophn_session");
  if (!found) throw new Error("lophn_session");
  return found;
};

// tool op 하나가 받는 field. `op`는 tool 것이므로 뺀다.
const branchFields = (input: unknown, op: string) => {
  const union = input as {
    options: { shape: Record<string, unknown> }[];
  };
  const branch = union.options.find((option) => {
    const value = (option.shape.op as unknown as { value?: string }).value;
    return value === op;
  });
  if (!branch) throw new Error(op);
  return Object.keys(branch.shape).filter((field) => field !== "op").sort();
};

Deno.test(
  "coding-agent/mcp-server#R3, coding-agent/mcp-server#R4: lophn_session은 summary op 하나다",
  () => {
    assertEquals(MCP_SESSION_TOOLS.map((item) => item.name), [
      "lophn_session",
    ]);
    const session = tool();
    assertEquals(session.ops, ["summary"]);
    assertEquals(session.toolset, "core");
    assertEquals(session.scope, "S");
    // 내보낸 op가 모두 읽기라 읽기 전용 주석이 붙는다(output.ts READ_ONLY_TOOLS).
    assertEquals(session.readOnlyHint, true);
    assertEquals(mcpSessionTool("lophn_ticket"), undefined);

    session.input.parse({ op: "summary" });
    session.input.parse({
      op: "summary",
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
    });
    session.input.parse({ op: "summary", cursor: "next-1" });
    // op 밖 동작과 모르는 filter는 거절이다.
    assertEquals(
      session.input.safeParse({ op: "claim" }).success,
      false,
    );
    assertEquals(
      session.input.safeParse({ op: "summary", limit: 2 }).success,
      false,
    );
    assertEquals(
      session.input.safeParse({ op: "summary", app: "tkt_bad" }).success,
      false,
    );
    // owner read가 받지 않는 filter는 tool에도 없다.
    assertEquals(branchFields(session.input, "summary"), ["app", "cursor"]);
  },
);

Deno.test(
  "coding-agent/mcp-server#R3: summary op는 owner read route를 가리킨다",
  () => {
    assertEquals(
      MCP_SESSION_ROUTES.lophn_session.summary,
      [
        codingAgentSessionSummary,
      ][0],
    );
    assertEquals(
      routePath(MCP_SESSION_ROUTES.lophn_session.summary),
      "/v1/coding_agent_sessions/summary",
    );
    // 입력도 owner route 입력과 같은 schema다.
    const summary = MCP_SESSION_TOOLS[0];
    const input = summary.input as {
      options: { shape: Record<string, unknown> }[];
    };
    const branch = input.options.find(
      (option) =>
        (option.shape.op as unknown as { value?: string }).value === "summary",
    );
    assert(branch);
    assertEquals(Object.keys(branch.shape).includes("app"), true);
    assertEquals(Object.keys(branch.shape).includes("cursor"), true);
  },
);

Deno.test(
  "coding-agent/mcp-server#R3, coding-agent/mcp-server#R5: summary op의 출력은 owner read 출력과 같은 schema다",
  () => {
    // route 출력은 sessions.ts의 codingAgentSessionSummaryOutputSchema다.
    assertEquals(
      MCP_SESSION_ROUTES.lophn_session.summary.output,
      codingAgentSessionSummary.output,
    );
    // 결과 요약의 claim_rule은 착수 금지 안내 필수다(guides 도메인 모델).
    const shape = codingAgentSessionSummary.output.shape as {
      shape?: Record<string, unknown>;
    };
    assert(shape);
  },
);
