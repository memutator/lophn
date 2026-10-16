// broker `/_lophn/broker/problems/report`. 앱은 problem을 보고만 하고 닫는 통로는 없다.
// app·release·mode는 자식 연결의 신원에서 정하고
// 본문이 정하지 못한다. 보고 자체의 수집·묶음은 problems 팀의 collector가 맡는다.
import { err, type Result } from "../../../../base/mod.ts";
import {
  brokerProblemObserveInputSchema,
  type brokerProblemReportOutputSchema,
} from "../../../../protocol/apps/mod.ts";
import { brokerReportProblemInputSchema } from "../../../../protocol/apps/calls/mod.ts";
import type { z } from "zod";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

type ProblemReportOutput = z.infer<
  typeof brokerProblemReportOutputSchema
>;

type ProblemObserveInput = z.infer<
  typeof brokerProblemObserveInputSchema
>["observation"];

type ProblemReportRequest = {
  app: string;
  release: string | null;
  mode: BrokerChild["mode"];
  processNonce: string;
  // 앱이 정한 problem 이름과 message다.
  name: string;
  message: string;
  details?: unknown;
  // SDK가 전송 전에 고정한 값이다.
  reportId: string;
  observedAt: string;
  invocation?: {
    id: string;
    record_missing_reason: { reason: string } | null;
  } | null;
};

// problems의 보고 contract(`/problems/report`)를 감싼 포트다.
export interface ProblemsReport {
  report(request: ProblemReportRequest): Promise<Result<ProblemReportOutput>>;
  // 잡은 예외. 연결이 없으면 경로를 없애지 않고 unavailable이다.
  observe?(
    observation: ProblemObserveInput,
  ): Promise<Result<ProblemReportOutput>>;
}

export type ProblemReportService = {
  report(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<ProblemReportOutput>>;
  observe?(
    child: BrokerChild,
    body: unknown,
  ): Promise<Result<ProblemReportOutput>>;
};

export function createProblemReportService(deps: {
  problems: ProblemsReport;
}): ProblemReportService {
  return {
    async report(child, body) {
      const parsed = brokerReportProblemInputSchema.safeParse(body);
      if (!parsed.success) return invalid("problem report input is invalid");
      const input = parsed.data;
      return await deps.problems.report({
        app: child.app,
        release: child.release,
        mode: child.mode,
        processNonce: child.processNonce,
        name: input.name,
        message: input.message,
        ...(input.details === undefined ? {} : { details: input.details }),
        reportId: input.report_id,
        observedAt: input.observed_at,
        ...(input.invocation === undefined
          ? {}
          : { invocation: input.invocation }),
      });
    },
    async observe(_child, body) {
      const parsed = brokerProblemObserveInputSchema.safeParse(body);
      if (!parsed.success) {
        return invalid("exception observation input is invalid");
      }
      if (deps.problems.observe === undefined) {
        return err({
          code: "unavailable",
          message: "exception observation is not connected",
        });
      }
      return await deps.problems.observe(parsed.data.observation);
    },
  };
}
