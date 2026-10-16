import type { ToolHandler } from "./mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import type { TurnSeat } from "../run-loop/core-ports.ts";

// 내장 tool은 정의가 handler를 들고 있다(ToolContext로 실행). 옛 run-loop에 넘길 handler는 없다.
export function createBuiltinToolkit(): {
  handlers(seat: TurnSeat, agent: CoreCall): ReadonlyMap<string, ToolHandler>;
} {
  return {
    handlers(_seat, _agent) {
      return new Map();
    },
  };
}
