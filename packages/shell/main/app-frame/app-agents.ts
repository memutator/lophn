// 앱 view의 agent 길 중 call과 명함, session 끝내기. 사람 자격(`coreInternal`. 다른 기계의 view는 그 기계가 보는 이 컴퓨터의 기기 자격)으로 core의 `app_calls.*`·`app_agents.list`·`app_sessions.end`에
// 가고, 어느 앱인지는 sender view에서 main이 정해 싣는다(page가 고르지 못한다). 입력 검사와 시야 판정은 core가 한다.
import { APP_AGENTS_OPS, type AppAgentsOp } from "../../ipc/app-agents.ts";
import type { CallOutcome } from "./app-call.ts";
import type { MachineCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

interface AppAgentsDeps {
  call: MachineCaller;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const ROUTE_OF: Record<AppAgentsOp, [resource: string, method: string]> = {
  "sessions.end": ["app_sessions", "end"],
  "calls.send": ["app_calls", "send"],
  "calls.read": ["app_calls", "read"],
  "calls.cancel": ["app_calls", "cancel"],
  "calls.list": ["app_calls", "list"],
  "agents.list": ["app_agents", "list"],
};

export function createAppAgents(deps: AppAgentsDeps) {
  return {
    async run(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const request = record(value);
      const op = request?.op;
      const input = request?.input === undefined ? {} : record(request.input);
      if (
        input === undefined ||
        typeof op !== "string" ||
        !(APP_AGENTS_OPS as readonly string[]).includes(op)
      ) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "input is invalid" },
        };
      }
      const [resource, method] = ROUTE_OF[op as AppAgentsOp];
      // 앱은 page가 못 고른다: main이 sender view의 앱으로 덮는다.
      const { app: _ignored, ...rest } = input;
      return await deps.call(view.machine)("memory", resource, method, {
        ...rest,
        app: view.target.app,
      });
    },
  };
}
