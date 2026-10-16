import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";

// MCP·CLI가 같은 사실을 내는 공통 출력(architecture 5.1). domain 결과 전체를 다시
// 정의하지 않는다. data는 소유 route 출력의 JSON이고 summary는 본문을 담지 않는다.
export const agentResultSchema = z.object({
  summary: z.string().min(1),
  data: z.unknown(),
  next: z.array(z.string().min(1)),
});

export type AgentResult = z.infer<typeof agentResultSchema>;

export const agentFailureSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type AgentFailure = z.infer<typeof agentFailureSchema>;

// 쓰기 응답을 잃으면 성공도 domain 실패도 아니다. 원래 key로 대상을 다시 읽는다.
export const effectUnknownSchema = agentFailureSchema.extend({
  code: z.literal("unavailable"),
  details: z.object({
    diagnosis: z.literal("effect_unknown"),
    idempotency_key: z.string().min(1),
    subject: z.string().min(1),
  }).catchall(z.unknown()),
});

export type EffectUnknown = z.infer<typeof effectUnknownSchema>;

// Codex는 structured만, Gemini CLI·OpenCode는 text만 model에 넣는다.
export const mcpToolResultSchema = z.object({
  structuredContent: agentResultSchema,
  content: z.array(z.object({
    type: z.literal("text"),
    text: z.string(),
  })).min(1),
  isError: z.boolean().optional(),
}).refine((value) => {
  const text = value.content.find((item) => item.type === "text");
  if (!text) return false;
  const parsed = agentResultSchema.safeParse(JSON.parse(text.text));
  return parsed.success &&
    JSON.stringify(parsed.data) === JSON.stringify(value.structuredContent);
}, { message: "text content must match structuredContent" });

export type McpToolResult = z.infer<typeof mcpToolResultSchema>;

export function mcpToolResult(
  result: AgentResult,
  isError = false,
): McpToolResult {
  return mcpToolResultSchema.parse({
    structuredContent: result,
    content: [{ type: "text", text: JSON.stringify(result) }],
    ...(isError ? { isError: true } : {}),
  });
}

// JSON parse, request 모양, 없는 method, 없는 tool·MCP params.
export const MCP_PROTOCOL_ERRORS = [-32700, -32600, -32601, -32602] as const;

export type McpProtocolError = (typeof MCP_PROTOCOL_ERRORS)[number];

export const mcpProtocolErrorSchema = z.object({
  code: z.union([
    z.literal(-32700),
    z.literal(-32600),
    z.literal(-32601),
    z.literal(-32602),
  ]),
  message: z.string().min(1),
});

// 목록·검색은 scope를 먼저 적용한다. app scope에서 못 읽으면 개수도 주지 않는다.
export const SCOPE_MARKS = ["S", "A", "G", "ALL"] as const;

export const scopeMarkSchema = z.enum(SCOPE_MARKS);

export type ScopeMark = z.infer<typeof scopeMarkSchema>;

export const TOOLSETS = ["core", "app"] as const;

export const REJECTED_TOOLSETS = ["ops", "catalog", "all"] as const;

export const toolsetSchema = z.enum(TOOLSETS);

export type Toolset = z.infer<typeof toolsetSchema>;

// core가 기본이다. app은 명시 옵션이나 환경 설정으로만 켠다.
export function parseToolsets(value: string | undefined): Toolset[] {
  if (value === undefined || value.trim() === "") return ["core"];
  const names = value.split(",").map((item) => item.trim()).filter((item) =>
    item !== ""
  );
  if (names.length === 0) return ["core"];
  const parsed = names.map((name) => toolsetSchema.safeParse(name));
  if (parsed.some((item) => !item.success)) {
    throw new Error("unknown toolset");
  }
  return [...new Set(parsed.map((item) => item.data!))];
}

// 내보낸 op가 모두 읽기인 tool만. validate·propose·저장을 가진 tool에는 붙이지 않는다.
export const READ_ONLY_TOOLS = [
  "lophn_session",
  "lophn_index",
  "lophn_project",
  "lophn_document",
  "lophn_read",
  "lophn_series",
  "lophn_question",
  "lophn_approval",
] as const;

export function readOnlyHint(tool: string): true | undefined {
  return (READ_ONLY_TOOLS as readonly string[]).includes(tool)
    ? true
    : undefined;
}
