// lophn_problem tool의 실행이다(T44, mcp#R24, R25). 문제·snapshot·고친 기록·수리 자료 읽기와
// record_fix·reproduction test 요청을 CLI `problem …`과 같은 한 흐름(connection/problem-ops)으로
// 보낸다: 같은 credential·입력의 결과와 거절이 같다(connection#R6, cli#R1). 읽기는 claim을 만들거나
// 갱신하지 않고, 쓰기(record_fix·test)는 지정 ticket의 현재 claim이 있어야 한다. 문제 직접 claim·별도 시도
// 단계·workflow·test result 입력·문제 닫힘 op는 표에 없다.
import type { Route } from "../../../protocol/base/mod.ts";
import { type ProblemOpDeps, runProblemOp } from "../../connection/mod.ts";
import type { ToolOutput } from "./output.ts";

export type ProblemToolDeps = Omit<ProblemOpDeps, "surface" | "progress">;

// tools/call마다 server가 주는 맥락이다. progressToken이 없는 호출은 progress를 보내지 않는다.
export type ProblemToolContext = {
  progress?: (message: string) => void | Promise<void>;
};

export function createProblemTool(
  deps: ProblemToolDeps,
): (
  toolName: string,
  route: Route,
  input: unknown,
  context?: ProblemToolContext,
) => Promise<ToolOutput> {
  return async function runProblemTool(_toolName, _route, rawInput, context) {
    return await runProblemOp(rawInput, {
      ...deps,
      surface: "mcp",
      progress: context?.progress,
    });
  };
}
