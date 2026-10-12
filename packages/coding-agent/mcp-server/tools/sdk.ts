// lophn_sdk tool의 실행이다(T22, mcp#R22·R23). catalog·show·add는 소유 읽기
// route로만 보내는 흐름이 MCP와 CLI 공통이다(connection/sdk-ops, cli#R1, connection#R6).
// MCP는 쓰기 권한 없이 뜨므로(launch.ts) source port를 주입하지 않으면 apply는 거절이다.
import type { Route } from "../../../protocol/server/mod.ts";
import { runSdkOp, type SdkOpDeps } from "../../connection/mod.ts";
import type { ToolOutput } from "./output.ts";

export type SdkToolDeps = Omit<SdkOpDeps, "surface">;

export function createSdkTool(
  deps: SdkToolDeps,
): (
  toolName: string,
  route: Route,
  input: unknown,
) => Promise<ToolOutput> {
  return async function runSdkTool(_toolName, _route, rawInput) {
    return await runSdkOp(rawInput, { ...deps, surface: "mcp" });
  };
}
