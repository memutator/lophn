// MCP server 로직이다(architecture/coding-agent 5.1). initialize·tools/list는
// core에 닿지 않고 답한다(R1). tools/call은 registry의 route로만 dispatch한다.
// protocol 오류는 JSON parse -32700, request -32600, method -32601, tool·params
// -32602다. 알려진 tool의 실행·scope·입력 실패는 isError true다(R7).
import type { Toolset } from "../../contracts/coding-agent/mod.ts";
import {
  agentResultSchema,
  mcpToolResult,
  parseToolsets,
} from "../../contracts/coding-agent/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import { findTool, resolveRoute, toolEntries } from "./registry.ts";
import { effectUnknownResult, failureResult, successResult } from "./result.ts";

// MCP 초기화에 답하는 server 정보다. protocol 버전은 client가 보낸 것을 그대로 돌려준다.
const SERVER_INFO = { name: "lophn-mcp", version: "0.1.0" };

// 기동부터 tools/list까지의 측정 기준이다. Codex·OpenCode 기동 timeout 30초보다
// 넉넉히 2,000ms 안이다(R1).
export const STARTUP_BUDGET_MS = 2_000;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const PROTOCOL_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

// server가 소유한 상태다. label 순서의 마지막 항목이 여기에 남는다(connection#R3).
export type McpServer = {
  // enable한 toolset이다. discovery에 나올 tool을 정한다.
  toolsets: readonly Toolset[];
};

export type HandleDeps = {
  toolsets?: readonly Toolset[];
  // initialize clientInfo.name은 label 순서의 마지막으로만 쓰인다(connection#R3).
  onClientInfo?: (name: string | undefined) => void;
  // tools/call의 실행이다. registry route 하나로만 routing된다(R2).
  // isError는 실행 실패·거절을 model에 실패로 알린다(R7). 성공 결과는 생략한다.
  callTool: (toolName: string, args: unknown) => Promise<{
    summary: string;
    data: unknown;
    next: string[];
    isError?: boolean;
  }>;
};

// protocol 처리와 tool 실행을 나눈다. stdin 줄 하나가 여기로 들어온다.
export function createHandler(
  deps: HandleDeps,
): (line: string) => Promise<JsonRpcResponse | undefined> {
  const toolsets = deps.toolsets ?? parseToolsets(undefined);
  return async (line) => {
    const parsed = parseRequest(line);
    if (!parsed.ok) return errorResponse(parsed.id, parsed.error);
    const request = parsed.request;
    // notification(id 없는 요청)은 상태를 바꾸지 않으므로 응답도 없다.
    if (request.id === undefined) return undefined;
    switch (request.method) {
      case "initialize":
        return initializeResponse(request, deps.onClientInfo);
      case "tools/list":
        return okResponse(request.id, {
          tools: toolEntries(toolsets),
        });
      case "tools/call":
        return await callResponse(request, deps.callTool);
      default:
        return errorResponse(
          request.id,
          { code: PROTOCOL_ERRORS.methodNotFound, message: "없는 method다" },
        );
    }
  };
}

// notification(id 없는 요청)은 응답을 내지 않는다.
type ParsedRequest =
  | { ok: true; request: JsonRpcRequest }
  | {
    ok: false;
    id: JsonRpcId;
    error: { code: number; message: string };
  };

function parseRequest(line: string): ParsedRequest {
  let body: unknown;
  try {
    body = JSON.parse(line);
  } catch {
    return {
      ok: false,
      id: null,
      error: { code: PROTOCOL_ERRORS.parse, message: "JSON을 읽지 못했다" },
    };
  }
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      id: null,
      error: {
        code: PROTOCOL_ERRORS.invalidRequest,
        message: "요청 모양이 맞지 않다",
      },
    };
  }
  const checked = body as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  if (checked.jsonrpc !== "2.0" || typeof checked.method !== "string") {
    // id를 알 수 없으면 응답을 보낼 대상이 없다. null id로라도 알려준다.
    const id = typeof checked.id === "string" || typeof checked.id === "number"
      ? checked.id
      : null;
    return {
      ok: false,
      id,
      error: {
        code: PROTOCOL_ERRORS.invalidRequest,
        message: "요청 모양이 맞지 않다",
      },
    };
  }
  const id = typeof checked.id === "string" || typeof checked.id === "number"
    ? checked.id
    : undefined;
  return {
    ok: true,
    request: {
      jsonrpc: "2.0",
      id,
      method: checked.method,
      params: checked.params,
    },
  };
}

function initializeResponse(
  request: JsonRpcRequest,
  onClientInfo: ((name: string | undefined) => void) | undefined,
): JsonRpcResponse {
  const params = (request.params ?? {}) as {
    clientInfo?: { name?: unknown };
  };
  const name = typeof params.clientInfo?.name === "string" &&
      params.clientInfo.name !== ""
    ? params.clientInfo.name
    : undefined;
  // label 표시 순서의 마지막 항목이다. 권한은 credential로만 정해진다(connection#R3).
  onClientInfo?.(name);
  return okResponse(request.id ?? null, {
    protocolVersion: (request.params as { protocolVersion?: unknown })
      ?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
  });
}

async function callResponse(
  request: JsonRpcRequest,
  callTool: HandleDeps["callTool"],
): Promise<JsonRpcResponse> {
  const params = (request.params ?? {}) as {
    name?: unknown;
    arguments?: unknown;
  };
  if (typeof params.name !== "string" || params.name === "") {
    return errorResponse(
      request.id,
      {
        code: PROTOCOL_ERRORS.invalidParams,
        message: "tool 이름이 없다",
      },
    );
  }
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const resolved = resolveRoute(params.name, opOf(args));
  if (!findTool(params.name)) {
    return errorResponse(
      request.id,
      { code: PROTOCOL_ERRORS.invalidParams, message: "없는 tool이다" },
    );
  }
  if (!resolved) {
    // 표에 있고 op만 틀린 것은 실행 전 isError다(R6). 다른 동작으로 추측해
    // 실행하지 않는다.
    return okResponse(
      request.id,
      failureResult({
        code: "invalid_input",
        message: "tool 표에 없는 op다",
        details: { tool: params.name, op: opOf(args) },
      }),
    );
  }
  // tool 입력은 tool 표의 input(여러 op tool은 `op`를 고르는 union)으로 실행 전
  // 검사한다(R6). 소유 route의 입력은 `op`를 모르므로 route 입력으로는 검사할 수
  // 없고, route의 envelope·입력 검사는 core client가 보내기 전에 다시 한다.
  const input = resolved.tool.input.safeParse(args);
  if (!input.success) {
    const field = input.error.issues[0]?.path.join(".") ?? "";
    return okResponse(
      request.id,
      failureResult({
        code: "invalid_input",
        message: field === ""
          ? "tool 입력이 맞지 않다"
          : `${field}: 입력이 맞지 않다`,
        details: { tool: params.name, op: resolved.op ?? null },
      }),
    );
  }
  const ran = await callTool(params.name, input.data);
  return okResponse(
    request.id,
    mcpToolResult(
      { summary: ran.summary, data: ran.data, next: ran.next },
      ran.isError === true,
    ),
  );
}

// 단일 동작 tool은 arguments에 op가 없다. 여러 op tool은 arguments.op로 고른다.
function opOf(args: unknown): string | undefined {
  const params = (args ?? {}) as { op?: unknown };
  return typeof params.op === "string" ? params.op : undefined;
}

function okResponse(id: JsonRpcId | undefined | null, result: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    result,
  };
}

function errorResponse(
  id: JsonRpcId | undefined | null,
  error: { code: number; message: string; data?: unknown },
) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error,
  };
}

// tool 실행 결과를 domain 결과로 감싼다. 실패·effect_unknown은 isError다(R7).
export function wrapToolResult(
  value: { summary: string; data: unknown; next: string[] },
  failure: LophnError | undefined,
): unknown {
  if (!failure) {
    return successResult({
      summary: value.summary,
      data: value.data,
      next: value.next,
    });
  }
  return failure ? effectUnknownResult(failure) : failureResult(failure);
}

export { agentResultSchema };
