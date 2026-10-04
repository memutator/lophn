// MCP server의 public entry다. 조립이 쓰는 것만 내보낸다.
export type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from "./server.ts";
export { createHandler, STARTUP_BUDGET_MS, wrapToolResult } from "./server.ts";
export {
  createMessageSink,
  MAX_LINE_BYTES,
  startLineReader,
  type StdioStreams,
} from "./stdio.ts";
export type { ToolEntry } from "./registry.ts";
export {
  findTool,
  inputSchema,
  resolveRoute,
  STATIC_TOOLS,
  toolEntries,
} from "./registry.ts";
export { effectUnknownResult, failureResult, successResult } from "./result.ts";

// 실행 argv 생성이다(architecture/coding-agent 2.2). shell 문자열로 합치지 않고
// 분리 argv로 돌려준다.
export { mcpLaunchArgv } from "./launch.ts";
export type { McpLaunchInputs } from "./launch.ts";
