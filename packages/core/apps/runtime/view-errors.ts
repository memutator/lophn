// 앱 화면(shell main이 sender view에서 앱·release·mode를 정해 보낸다)의 처리되지 않은 오류를 앱 log 줄로
// 쓴다. log file을 쓰는 쪽은 supervisor 하나라 core는 control 통로로 넘기기만 한다.
import type { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import type { appLogViewError } from "../../../protocol/apps/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { appendLogOutputSchema, SUPERVISOR_OPS } from "./control-protocol.ts";
import type { SupervisorChannel } from "./supervisor-link.ts";

type AppLogViewErrorInput = z.infer<typeof appLogViewError.input>;

export function viewErrorText(
  input: Pick<AppLogViewErrorInput, "observation" | "name" | "message">,
): string {
  const head = `view_error ${input.observation} ${input.name}`;
  return input.message === null ? head : `${head}: ${input.message}`;
}

/** core가 스스로 쓰는 앱 log 줄(view 표의 호출 거절). 쓰지 못해도 부른 쪽 일은 그대로 간다. */
export function appLogWriter(deps: {
  request: SupervisorChannel["request"];
}): (app: string, text: string) => void {
  return (app, text) => {
    void deps
      .request(SUPERVISOR_OPS.appendLog, { app, invocation: null, text })
      .catch(() => {});
  };
}

export function viewErrorLogHandler(deps: {
  request: SupervisorChannel["request"];
}): MemoryHandler {
  return async (_ctx, value) => {
    const input = value as AppLogViewErrorInput;
    // preview 화면 오류는 아직 log에 쓰지 않는다.
    if (input.mode === "preview") return ok({ written: false });
    const answer = await deps.request(SUPERVISOR_OPS.appendLog, {
      app: input.app,
      invocation: null,
      text: viewErrorText(input),
    });
    if (!answer.ok) return answer;
    const parsed = appendLogOutputSchema.safeParse(answer.value);
    return parsed.success
      ? ok({ written: parsed.data.written })
      : err({
          code: "unavailable",
          message: "app supervisor answered badly",
        });
  };
}
