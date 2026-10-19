import type { Result } from "../../base/mod.ts";
import type { McpTool } from "../../protocol/apps/blueprint/mod.ts";
import { RPC_JSON_MAX_BYTES } from "../../protocol/base/mod.ts";
import {
  CODING_MCP_SERVER_NAME,
  MCP_PROTOCOL_VERSION,
} from "../../protocol/coding-agent/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  BODY_TIMEOUT_MS,
  errorBody,
  failure,
  parseLimitedJson,
  readLimitedBody,
} from "./request.ts";

// MCP `tools/call`의 결과. 앱이 낸 실패도 isError로 agent에게 돌려준다(JSON-RPC 오류가 아니다).
export type McpCallResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

// server(바닥)는 apps를 모른다. tool 목록과 호출은 조립이 이 interface로 끼운다.
// 거절(Result 오류)은 HTTP 오류로 가고, null은 모르는 tool 이름이다(-32602).
export interface McpTools {
  list(ctx: AuthenticatedContext): Promise<Result<readonly McpTool[]>>;
  call(
    ctx: AuthenticatedContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Result<McpCallResult | null>>;
}

export interface McpEndpoint {
  handle(ctx: AuthenticatedContext, request: Request): Promise<Response>;
}

const INSTRUCTIONS =
  "These are the tools of this ticket's app. tools/call goes only to the running preview. Start one with `lophn app preview start`.";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type RpcId = string | number | null;

function rpcError(
  id: RpcId,
  code: number,
  message: string,
  status = 200,
): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, {
    status,
  });
}

function rpcResult(id: RpcId, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Streamable HTTP(2025-06-18)의 상태 없는 server다. POST만 받고 SSE도 세션도 없다.
export function createMcpEndpoint(tools: McpTools): McpEndpoint {
  async function handle(
    ctx: AuthenticatedContext,
    request: Request,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    const version = request.headers.get("mcp-protocol-version");
    if (version !== null && version !== MCP_PROTOCOL_VERSION) {
      return rpcError(
        null,
        INVALID_REQUEST,
        `unsupported MCP-Protocol-Version, use ${MCP_PROTOCOL_VERSION}`,
        400,
      );
    }
    const body = await readLimitedBody(request, {
      maxBytes: RPC_JSON_MAX_BYTES,
      timeoutMs: BODY_TIMEOUT_MS,
    });
    if (!body.ok) {
      return rpcError(null, INVALID_REQUEST, body.error.error.message, 400);
    }
    const parsed = parseLimitedJson(body.value);
    if (!parsed.ok) {
      return rpcError(null, PARSE_ERROR, parsed.error.error.message, 400);
    }
    const message = parsed.value;
    if (!isObject(message) || message.jsonrpc !== "2.0") {
      return rpcError(
        null,
        INVALID_REQUEST,
        "body must be one JSON-RPC 2.0 message",
        400,
      );
    }
    const id = message.id;
    const hasId = typeof id === "string" || typeof id === "number";
    if (typeof message.method !== "string") {
      // client가 보낸 response는 받기만 한다.
      return hasId && ("result" in message || "error" in message)
        ? new Response(null, { status: 202 })
        : rpcError(null, INVALID_REQUEST, "method required", 400);
    }
    // notification(id 없음)은 받기만 한다.
    if (!hasId) return new Response(null, { status: 202 });
    return await dispatch(ctx, id, message.method, message.params);
  }

  async function dispatch(
    ctx: AuthenticatedContext,
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<Response> {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: CODING_MCP_SERVER_NAME, version: "0" },
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return rpcResult(id, {});
      case "tools/list": {
        const listed = await tools.list(ctx);
        return listed.ok
          ? rpcResult(id, { tools: listed.value })
          : refused(listed.error);
      }
      case "tools/call": {
        if (
          !isObject(params) || typeof params.name !== "string" ||
          (params.arguments !== undefined && !isObject(params.arguments))
        ) {
          return rpcError(id, INVALID_PARAMS, "name and arguments required");
        }
        const called = await tools.call(
          ctx,
          params.name,
          (params.arguments ?? {}) as Record<string, unknown>,
        );
        if (!called.ok) return refused(called.error);
        return called.value === null
          ? rpcError(id, INVALID_PARAMS, `unknown tool: ${params.name}`)
          : rpcResult(id, called.value);
      }
      default:
        return rpcError(id, METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  return { handle };
}

// 거절은 다른 endpoint와 같은 오류 body와 status다.
function refused(error: Parameters<typeof failure>[0]): Response {
  const rejected = failure(error);
  return Response.json(errorBody(rejected.error), { status: rejected.status });
}
