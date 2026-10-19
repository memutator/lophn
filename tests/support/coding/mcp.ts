import {
  CODING_MCP_PATH,
  MCP_PROTOCOL_VERSION,
} from "../../../packages/protocol/coding-agent/mod.ts";
import type { Core } from "../core/mod.ts";

// coding agent가 쓰는 길 그대로다: coding token을 Bearer로 싣고 core의 `/mcp`에 JSON-RPC 한 건을 POST한다.
// 앱 실패와 preview 없음은 `body.result.isError`, 모르는 tool은 `body.error`, token 범위 거절은 HTTP 오류 body다.
export async function mcpRequest(
  core: Core,
  token: string,
  method: string,
  params?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${core.baseUrl}${CODING_MCP_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? undefined : JSON.parse(text),
  };
}
