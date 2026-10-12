import { z } from "zod";
import { readOnlyHint, type ScopeMark, type Toolset } from "./output.ts";
import { codingAgentSessionSummary } from "./sessions.ts";

// lophn_session은 op 하나다. tool 입력은 owner read route 입력을 다시 적지 않고
// 고른다(질문·approval tool과 같다). summary가 받는 app·cursor가 전부다.
const sessionInput = z.discriminatedUnion("op", [
  codingAgentSessionSummary.input.extend({ op: z.literal("summary") }),
]);

export const MCP_SESSION_TOOLS = [
  {
    name: "lophn_session",
    toolset: "core",
    scope: "S",
    input: sessionInput,
    ops: ["summary"],
  },
] as const satisfies readonly {
  name: string;
  toolset: Toolset;
  scope: ScopeMark;
  input: z.ZodType;
  ops: readonly string[];
}[];

export type McpSessionToolName = (typeof MCP_SESSION_TOOLS)[number]["name"];

// op는 owner read route를 가리킨다.
export const MCP_SESSION_ROUTES = {
  lophn_session: {
    summary: codingAgentSessionSummary,
  },
} as const;

export function mcpSessionTool(name: string) {
  const tool = MCP_SESSION_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  return { ...tool, readOnlyHint: readOnlyHint(tool.name) };
}
