import type { ToolHandler } from "./mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import type { Toolkit } from "../run-loop/prepare.ts";
import type { TurnSeat } from "../run-loop/core-ports.ts";

// 내장 tool 묶음 하나. 내장 tool은 정의가 handler를 들고 있다(ToolContext로 실행).
export function createBuiltinToolkit(): Toolkit {
  return {
    handlers(
      _seat: TurnSeat,
      _agent: CoreCall,
    ): ReadonlyMap<string, ToolHandler> {
      return new Map();
    },
  };
}
