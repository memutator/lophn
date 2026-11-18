// 앱 view의 session 목록·상태·멈추기 main service. 사람 자격(`coreInternal`. 다른 기계의 view는 그 기계가 보는 이 컴퓨터의 기기 자격)으로 core의 `app_sessions.*`에 가고, 어느 앱인지는 sender view에서
// main이 정해 싣는다(page가 고르지 못한다). 어느 session이 보이는지는 core가 판정한다.
import type { CallOutcome } from "./app-call.ts";
import type { MachineCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

interface AppSessionsDeps {
  call: MachineCaller;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const invalid = (): CallOutcome<never> => ({
  ok: false,
  error: { code: "invalid_input", message: "input is invalid" },
});

export function createAppSessions(deps: AppSessionsDeps) {
  const run = (
    view: BoundView,
    method: "list" | "status" | "stop",
    input: Record<string, unknown>,
  ): Promise<CallOutcome<unknown>> =>
    deps.call(view.machine)("memory", "app_sessions", method, {
      ...input,
      app: view.target.app,
    });
  return {
    async list(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const filter = value === null || value === undefined ? {} : record(value);
      if (filter === undefined) return invalid();
      // route가 입력 검사를 한다. 앱이 고를 수 있는 것은 거르기뿐이다(app은 main이 덮는다).
      const { app: _ignored, ...rest } = filter;
      return await run(view, "list", rest);
    },
    async status(
      view: BoundView,
      value: unknown,
    ): Promise<CallOutcome<unknown>> {
      const session = record(value)?.session;
      return typeof session === "string"
        ? await run(view, "status", { session })
        : invalid();
    },
    async stop(view: BoundView, value: unknown): Promise<CallOutcome<unknown>> {
      const session = record(value)?.session;
      return typeof session === "string"
        ? await run(view, "stop", { session })
        : invalid();
    },
  };
}
