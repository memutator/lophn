// broker `/_lophn/broker/problems/observe-exception`. 앱이 잡은 예외를 그 앱의 log 줄로 쓴다.
// app은 자식 연결의 신원에서 정하고 본문이 정하지 못한다. redaction과 자르기는 append(AppLogFile)가 한다.
import { ok, type Result } from "../../../../base/mod.ts";
import { brokerProblemObserveInputSchema } from "../../../../protocol/apps/mod.ts";
import type { StackFrame } from "../../runtime/observations/stack-frames.ts";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

// 조립이 연결한다: frame 풀이는 봉인된 bundle 사본을, append는 그 앱의 log file을 쓴다.
export type ExceptionLog = {
  frames(child: BrokerChild, stack: string | null): Promise<StackFrame[]>;
  append(app: string, entry: { invocation: string | null; text: string }): void;
};

export type ExceptionLogService = {
  observe(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<{ written: true }>>;
};

export function createExceptionLogService(deps: {
  log: ExceptionLog;
}): ExceptionLogService {
  return {
    async observe(child, body) {
      const parsed = brokerProblemObserveInputSchema.safeParse(body);
      if (!parsed.success) {
        return invalid("exception observation input is invalid");
      }
      const { observation } = parsed.data;
      const error = observation.error;
      const invocation = observation.invocation?.id ?? null;
      const name = error?.name ?? observation.observation;
      const head =
        error?.message == null
          ? `exception ${name}`
          : `exception ${name}: ${error.message}`;
      // 줄 사이에 await를 두지 않으려고 frame을 먼저 다 푼다(같은 시각에 찍히게).
      const frames = await deps.log.frames(child, error?.stack ?? null);
      deps.log.append(child.app, { invocation, text: head });
      for (const frame of frames) {
        deps.log.append(child.app, {
          invocation,
          text: `  at ${frame.path}:${frame.line}:${frame.column}`,
        });
      }
      return ok({ written: true });
    },
  };
}
