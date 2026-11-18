// broker `/_lophn/broker/apps/call`. 앱이 다른 앱의 command를 부르는 길이다. 부른 쪽은 자식 연결이
// 정하고 core가 target과 Gate를 판정한다. 요청의 `parent_invocation`은 core가 그 앱의 진행 중
// invocation인지 확인한다. 이 서비스는 요청 모양을 검사하고 core 호출 경로로 넘기기만 한다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  brokerAppCallInputSchema,
  brokerAppCallOutputSchema,
  type ToolCallInput,
  type ToolCallOutput,
} from "../../../../protocol/apps/calls/mod.ts";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// core의 `app.call_tool`를 그 자식의 app credential로 부르는 포트다. 조립이 잇는다.
export interface AppCallPort {
  call(
    child: BrokerChild,
    input: ToolCallInput,
  ): Promise<Result<ToolCallOutput>>;
}

export type AppsCallService = {
  call(child: BrokerChild, body: unknown): Promise<Result<ToolCallOutput>>;
};

export function createAppsCallService(deps: {
  core: AppCallPort;
}): AppsCallService {
  return {
    async call(child, body) {
      const parsed = brokerAppCallInputSchema.safeParse(body);
      if (!parsed.success) return invalid("apps call input is invalid");
      const input = parsed.data;
      // 다른 앱 호출은 운영 앱의 live 자식만 한다. preview 자식은 core 호출 경로로 가지 않는다.
      if (child.mode !== "live" || child.release === null) {
        return err({
          code: "forbidden",
          message: "only a live app process calls other apps",
        });
      }
      // `machine`이 있으면 다른 컴퓨터의 앱이다. 같은 id의 이 컴퓨터 앱을 부르면 안 되므로 remote target으로 core에 넘긴다.
      const target: ToolCallInput["target"] =
        input.machine === undefined
          ? { mode: "live", app: input.target_app, release: null }
          : { mode: "remote", machine: input.machine, app: input.target_app };
      const called = await deps.core.call(child, {
        target,
        kind: "command",
        name: input.command,
        ...(input.input === undefined ? {} : { input: input.input }),
        caller: {
          kind: "app",
          app: child.app,
          release: child.release,
          parent_invocation: input.parent_invocation,
        },
      });
      if (!called.ok) return called;
      const output = brokerAppCallOutputSchema.safeParse(called.value);
      return output.success
        ? ok(output.data)
        : err({
            code: "internal",
            message: "core answered the app call badly",
          });
    },
  };
}
