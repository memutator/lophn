// broker `/_lophn/broker/problems/report`. 앱은 problem을 보고만 하고 닫는 통로는 없다.
// app·release·mode는 자식 연결의 신원에서 정하고
// 본문이 정하지 못한다. 보고 자체의 수집·묶음은 problems 팀의 collector가 맡는다.
import { err, type Result } from "../../../../base/mod.ts";
import {
  brokerProblemObserveInputSchema,
  brokerProblemReportInputSchema,
  type brokerProblemReportOutputSchema,
} from "../../../../protocol/apps/mod.ts";
import type { z } from "zod";
import { invalid } from "./access.ts";
import type { BrokerChild } from "./invocations.ts";

export type ProblemReportOutput = z.infer<
  typeof brokerProblemReportOutputSchema
>;

export type ProblemObserveInput = z.infer<
  typeof brokerProblemObserveInputSchema
>["observation"];

export type ProblemReportRequest = {
  app: string;
  release: string | null;
  mode: BrokerChild["mode"];
  processNonce: string;
  code: string;
  details?: unknown;
  trace?: string;
  // SDK가 전송 전에 고정한 값. 없으면 supervisor가 id·시각을 정한다.
  reportId?: string;
  observedAt?: string;
  invocation?: {
    id: string;
    record_missing_reason: { reason: string } | null;
  } | null;
};

// problems의 보고 contract(`/v1/problems/report`)를 감싼 포트다.
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
      const parsed = brokerProblemReportInputSchema.safeParse(body);
      if (!parsed.success) return invalid("problem report input is invalid");
      const input = parsed.data;
      return await deps.problems.report({
        app: child.app,
        release: child.release,
        mode: child.mode,
        processNonce: child.processNonce,
        code: input.code,
        ...(input.details === undefined ? {} : { details: input.details }),
        ...(input.trace === undefined ? {} : { trace: input.trace }),
        ...(input.report_id === undefined ? {} : { reportId: input.report_id }),
        ...(input.observed_at === undefined
          ? {}
          : { observedAt: input.observed_at }),
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
