// tool registry다. 고정 adapter tool의 표가
// 권한 목록이며 목록 밖 op는 없다. op마다 소유 route 하나로만 routing하고
// 임의 core API를 부르는 passthrough는 없다.
import { z } from "zod";
import type { Toolset } from "../../protocol/coding-agent/mod.ts";
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
} from "../../protocol/coding-agent/mod.ts";
import type { Route } from "../../protocol/base/mod.ts";
import { APP_OP_ROUTES } from "../connection/mod.ts";

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
// 표 값은 소유 표 그대로다. lookup은 unknown을 거쳐서만 좁힌다.
const OWNER_ROUTES: Record<string, Record<string, unknown>> = {} as Record<
  string,
  Record<string, unknown>
>;
Object.assign(OWNER_ROUTES, MCP_SESSION_ROUTES);
Object.assign(OWNER_ROUTES, MCP_CORE_ROUTES);
Object.assign(OWNER_ROUTES, MCP_DECISION_ROUTES);
Object.assign(OWNER_ROUTES, MCP_APP_ROUTES);
// lophn_app은 op마다 소유 route가 다르다. 계약 표(MCP_APP_ROUTES)가 4개만 내므로 같은 소유
// route 표를 connection이 공유해 CLI와 같은 route를 쓴다.
OWNER_ROUTES.lophn_app = { ...APP_OP_ROUTES };
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
  // op를 표시하지 않은 tool은 단일 동작이다(architecture 5.2). 표 값이 input
  // schema라면 read route 입력 자체가 tool의 소유 입력이다.
  if (tool.ops.length === 0) {
    const route = OWNER_ROUTES[toolName];
    if (!route) return undefined;
    // Route 모양(kind·resource·method)은 그 값을 쓴다. 소유 표가 input schema만
    // 내는 tool(lophn_read·lophn_save)은 read route 입력으로 감싼다.
    const shaped = route as {
      kind?: unknown;
      resource?: unknown;
      method?: unknown;
      safeParse?: unknown;
    };
    const isRoute = typeof shaped.kind === "string" &&
      typeof shaped.resource === "string" &&
      typeof shaped.method === "string";
    const isSchema = typeof shaped.safeParse === "function";
    if (!isRoute && !isSchema) return undefined;
    const owned: Route = isRoute
      ? (route as unknown as Route)
      : ({ kind: "read", input: route as unknown as z.ZodType } as Route);
    return { tool, op: undefined, route: owned };
  }
  if (op === undefined) return undefined;
  const found = OWNER_ROUTES[toolName]?.[op];
  // Route가 아닌 값은 route 자리가 없다.
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

// MCP tools/list의 항목이다. toolset에 켠 것만 discovery에 나온다. readOnlyHint는
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

// discovery schema는 zod 4의 toJSONSchema(io "input")로 만들고 여기서 모델이 몰라도
// 되는 것을 걷어낸다. 본뜬 모양은 GitHub MCP server의 한 tool 여러 동작이다:
// discriminatedUnion(oneOf, op const)을 op enum + 합친 properties로 편다. tool·op 수는
// 그대로고 실행 입력 검사는 소유 route의 zod 입력을 그대로 쓴다. 걷어내는 것:
// - $schema(draft 선언), default(서버가 적용한다), additionalProperties(서버가 검사한다)
// - ID 충족 pattern과 minLength·maxLength·safe-integer min·max(서버가 같은 검사를
//   실행 전에 하고 이유를 돌려준다. model은 id를 이전 read에서 복사한다)
// 변환 실패는 발견 실패다(조용히 빈 schema로 덮지 않는다).
export function inputSchema(input: z.ZodType): Record<string, unknown> {
  try {
    return flattenUnion(z.toJSONSchema(input, { io: "input" })) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("tool input schema 변환 실패");
  }
}

function stripConstraints(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripConstraints);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "$schema" || key === "default" ||
      key === "additionalProperties" || key === "pattern" ||
      key === "minLength" || key === "maxLength"
    ) continue;
    if (
      (key === "minimum" || key === "maximum") &&
      typeof value === "number" && Math.abs(value) > 1e15
    ) continue;
    out[key] = stripConstraints(value);
  }
  return out;
}

// oneOf를 enum discriminator로 편다. 모든 member가 같은 const discriminator를 두는
// union만 편다(op·kind). member 사이에 같은 이름·모양인 property는 하나로 합치고,
// 모양이 다르면 anyOf로 남긴다. primitive는 그대로 두고 array는 map한다(string을
// Object.entries로 돌면 index 재귀가 되므로 object만 내려간다).
function flattenUnion(node: unknown): unknown {
  const stripped = stripConstraints(node);
  if (Array.isArray(stripped)) {
    return stripped.map((item) => flattenUnion(item));
  }
  if (typeof stripped !== "object" || stripped === null) return stripped;
  const obj = stripped as Record<string, unknown>;
  const members = (obj.oneOf ?? obj.anyOf) as unknown[] | undefined;
  if (Array.isArray(members)) {
    const disc = discriminatorOf(members);
    if (disc) return flattenMembers(members, disc);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = flattenUnion(value);
  }
  return out;
}

function discriminatorOf(members: unknown[]): string | undefined {
  const names = ["op", "kind"];
  for (const disc of names) {
    const ok = members.every((member) => hasDiscriminator(member, disc));
    if (ok && members.length > 0) return disc;
  }
  return undefined;
}

function hasDiscriminator(member: unknown, disc: string): boolean {
  if (typeof member !== "object" || member === null) return false;
  const properties = (member as Record<string, unknown>).properties as
    | Record<string, unknown>
    | undefined;
  const prop = properties?.[disc] as { const?: unknown } | undefined;
  return typeof prop?.const === "string";
}

function flattenMembers(
  members: unknown[],
  disc: string,
): Record<string, unknown> {
  const merged = new Map<string, Map<string, unknown>>();
  for (const member of members) {
    const { properties } = member as { properties?: Record<string, unknown> };
    for (const [key, value] of Object.entries(properties ?? {})) {
      if (key === disc) continue;
      if (!merged.has(key)) merged.set(key, new Map());
      const variants = merged.get(key)!;
      variants.set(JSON.stringify(value), value);
    }
  }
  const properties: Record<string, unknown> = {
    [disc]: {
      type: "string",
      // enum 항목은 literal이므로 const 값을 꺼내 literal 목록으로 쓴다.
      enum: members.map((member) =>
        ((member as { properties: Record<string, unknown> }).properties[
          disc
        ] as { const: string }).const
      ),
    },
  };
  for (const [key, variants] of merged) {
    const values = [...variants.values()];
    properties[key] = values.length === 1 ? values[0] : { anyOf: values };
  }
  return { type: "object", properties, required: [disc] };
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
