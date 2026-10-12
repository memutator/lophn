// lophn_app tool의 실행이다. op마다 소유 route로만 보내는
// 흐름은 CLI와 같은 한 곳(connection/app-ops)이다: 같은 credential·입력의 결과와 거절이 같다.
// 이 tool은 tool 입력 검사 뒤의 실행만 맡고, 오래 걸리는 일은 접수와
// 다음 read로 나눠 돌려주며 기다리는 동안 progress를 알린다.
import type { Route } from "../../../protocol/base/mod.ts";
import { type AppOpDeps, runAppOp } from "../../connection/mod.ts";
import type { ToolOutput } from "./output.ts";

export type AppToolDeps = Omit<AppOpDeps, "surface" | "progress">;

// tools/call마다 server가 주는 맥락이다. progressToken이 없는 호출은 progress를 보내지 않는다.
export type AppToolContext = {
  progress?: (message: string) => void | Promise<void>;
};

export function createAppTool(
  deps: AppToolDeps,
): (
  toolName: string,
  route: Route,
  input: unknown,
  context?: AppToolContext,
) => Promise<ToolOutput> {
  return async function runAppTool(_toolName, _route, rawInput, context) {
    return await runAppOp(rawInput, {
      ...deps,
      surface: "mcp",
      progress: context?.progress,
    });
  };
}
