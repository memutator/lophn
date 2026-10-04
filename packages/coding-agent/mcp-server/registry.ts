// tool registry다(architecture/coding-agent 5.2). 고정 adapter tool의 표가
// 권한 목록이며 목록 밖 op는 없다. R2대로 op마다 소유 route 하나로만 routing하고
// 임의 core API를 부르는 passthrough는 없다.
import { z } from "zod";
import type { Toolset } from "../../contracts/coding-agent/mod.ts";
import {
  MCP_APP_ROUTES,
  MCP_APP_TOOLS,
  MCP_CORE_ROUTES,
  MCP_CORE_TOOLS,
  MCP_DECISION_ROUTES,
  MCP_DECISION_TOOLS,
  MCP_PROBLEM_ROUTES,
  MCP_PROBLEM_TOOLS,
  MCP_SESSION_ROUTES,
  MCP_SESSION_TOOLS,
  mcpAppTool,
  type McpAppToolName,
  mcpCoreTool,
  type McpCoreToolName,
  mcpDecisionTool,
  type McpDecisionToolName,
  mcpProblemTool,
  type McpProblemToolName,
  mcpSessionTool,
  type McpSessionToolName,
  readOnlyHint,
} from "../../contracts/coding-agent/mod.ts";
import type { Route } from "../../contracts/platform/mod.ts";

type StaticTool = {
  name: string;
  toolset: Toolset;
  scope: string;
  input: z.ZodType;
  ops: readonly string[];
};

// 고정 adapter tool 표를 하나로 모은다. 행의 순서는 architecture 표다.
export const STATIC_TOOLS: readonly StaticTool[] = [
  ...MCP_SESSION_TOOLS,
  ...MCP_CORE_TOOLS,
  ...MCP_DECISION_TOOLS,
  ...MCP_APP_TOOLS,
  ...MCP_PROBLEM_TOOLS,
];

// tool마다 op마다 소유 route 하나다. route가 없는 op는 실행 전 거절이다.
// propose는 owner command가 아니라 변경안 문서 필드라 Route가 아니다(mcp-decisions).
// 표 값은 소유 표 그대로다. lookup은 unknown을 거쳐서만 좁힌다.
const OWNER_ROUTES: Record<string, Record<string, unknown>> = {} as Record<
  string,
  Record<string, unknown>
>;
Object.assign(OWNER_ROUTES, MCP_SESSION_ROUTES);
Object.assign(OWNER_ROUTES, MCP_CORE_ROUTES);
Object.assign(OWNER_ROUTES, MCP_DECISION_ROUTES);
Object.assign(OWNER_ROUTES, MCP_APP_ROUTES);
Object.assign(OWNER_ROUTES, MCP_PROBLEM_ROUTES);

export type ResolvedRoute = {
  tool: StaticTool;
  op: string | undefined;
  route: Route;
};

// route는 tool 표의 op에만 연결된다. 표 밖 op·tool은 undefined다.
export function resolveRoute(
  toolName: string,
  op: string | undefined,
): ResolvedRoute | undefined {
  const tool = findTool(toolName);
  if (!tool) return undefined;
  // op를 표시하지 않은 tool은 단일 동작이다(architecture 5.2).
  if (tool.ops.length === 0) {
    const route = OWNER_ROUTES[toolName];
    if (!route) return undefined;
    return { tool, op: undefined, route: route as unknown as Route };
  }
  if (op === undefined) return undefined;
  const found = OWNER_ROUTES[toolName]?.[op];
  // Route가 아닌 값(propose 필드)은 route 자리가 없다.
  if (
    !found || typeof found !== "object" || !("kind" in found) ||
    !("resource" in found) || !("method" in found)
  ) return undefined;
  return { tool, op, route: found as Route };
}
export type ToolEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: true;
};

// MCP tools/list의 항목이다. toolset에 켠 것만 discovery에 나온다(R3). readOnlyHint는
// 모든 op가 읽기인 tool에만 붙는다(client는 이것으로 승인을 건너뛰지 않는다).
export function toolEntries(enabled: readonly Toolset[]): ToolEntry[] {
  const entries: ToolEntry[] = [];
  for (const tool of STATIC_TOOLS) {
    if (!enabled.includes(tool.toolset)) continue;
    entries.push({
      name: tool.name,
      description: describeTool(tool),
      inputSchema: inputSchema(tool.input),
      readOnlyHint: readOnlyHint(tool.name),
    });
  }
  return entries;
}

function describeTool(tool: StaticTool): string {
  if (tool.ops.length === 0) return `${tool.name}: 단일 동작`;
  return `${tool.name}: ${tool.ops.join(", ")}`;
}

// discovery schema는 zod 4의 toJSONSchema로 만든다. minified UTF-8 JSON으로
// token 수를 재기 때문에 space가 없다. 변환 실패는 발견 실패다(조용히 빈 schema로
// 덮지 않는다).
export function inputSchema(input: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(input) as Record<string, unknown>;
  } catch {
    throw new Error("tool input schema 변환 실패");
  }
}

export type McpToolName =
  | McpSessionToolName
  | McpCoreToolName
  | McpDecisionToolName
  | McpAppToolName
  | McpProblemToolName;

export function findTool(name: string): StaticTool | undefined {
  return STATIC_TOOLS.find((item) => item.name === name);
}

export {
  mcpAppTool,
  mcpCoreTool,
  mcpDecisionTool,
  mcpProblemTool,
  mcpSessionTool,
};
