// lophn_sdk tool의 실행이다(T22, mcp#R22·R23). catalog·show·add는 소유 읽기
// route로만 보내는 흐름이 MCP와 CLI 공통이다(connection/sdk-ops, cli#R1, connection#R6).
// 개인 SDK는 현재 범위와 구별한다.
import type { Route } from "../../../contracts/platform/mod.ts";
import type { FlowClient } from "../../connection/mod.ts";
import { runSdkOp } from "../../connection/mod.ts";
import type { ToolOutput } from "./output.ts";

export type SdkToolDeps = {
  client: FlowClient;
};

export function createSdkTool(
  deps: SdkToolDeps,
): (
  toolName: string,
  route: Route,
  input: unknown,
) => Promise<ToolOutput> {
  return async function runSdkTool(_toolName, _route, rawInput) {
    return await runSdkOp(rawInput, {
      ...deps,
      surface: "mcp",
    });
  };
}
