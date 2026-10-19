// 완료 보고를 받으면 check를 한 번 확인해 결과를 남기는 Reactor handler. `TicketCompletionReported`가
// 깨운다. examples check는 test 요청만 내고, 검증이 끝나 `VerificationRecorded`가 나면 다른 handler가
// 결과를 남긴다. 상태는 바꾸지 않고(판정은 App Engineer) 결과와 근거만 `ticket.record_checks`로 남긴다.
// 읽기와 쓰기는 core를 부르는 client로 주입받는다(machine 자격은 조립이 가진다).
import { ok, type Result } from "../../../../base/mod.ts";
import type { ReactorContext, ReactorHandler } from "../../../events/ports.ts";
import { checkOutcomeOf } from "./result.ts";
import { type CheckWork, checkWorkSchema } from "./work.ts";

type RecordChecksCall = {
  ticket: string;
  completion_seq: string;
  base_revision: string;
  result: "pass" | "fail" | "inconclusive";
  reason: string;
  verification?: string;
};

export type TicketCheckClient = {
  // examples check의 test 요청을 낸다. 같은 보고의 재전송은 request_key가 하나로 묶는다.
  requestExamples(
    input: { ticket: string; completion_seq: string },
    idempotencyKey: string,
  ): Promise<Result<unknown>>;
  work(input: { ticket: string; completion_seq: string }): Promise<
    Result<unknown>
  >;
  record(call: RecordChecksCall, idempotencyKey: string): Promise<
    Result<unknown>
  >;
};

const TICKET_CHECK_HANDLER = "ticket-check";
const EXAMPLES_CHECK_HANDLER = "ticket-check-examples";

type Coordinates = { ticket: string; completion_seq: string };

// 보고의 사실을 읽는다. 이미 새 보고가 났거나 ticket이 reported가 아니면 null이다.
async function readWork(
  client: TicketCheckClient,
  input: Coordinates,
): Promise<Result<CheckWork | null>> {
  const read = await client.work(input);
  if (!read.ok) return read;
  const parsed = checkWorkSchema.safeParse(
    (read.value as { work?: unknown } | null)?.work,
  );
  return ok(parsed.success ? parsed.data : null);
}

// 사실에서 결과를 정해 한 번 남긴다. 두 handler가 나눠 쓴다.
async function recordOutcome(
  client: TicketCheckClient,
  work: CheckWork,
  outcome: NonNullable<ReturnType<typeof checkOutcomeOf>>,
  context: ReactorContext,
): Promise<Result<void>> {
  const written = await client.record(
    {
      ticket: work.ticket,
      completion_seq: work.completion_seq,
      base_revision: work.revision,
      result: outcome.result,
      reason: outcome.reason,
      ...(outcome.verification === null
        ? {}
        : { verification: outcome.verification }),
    },
    await context.idempotencyKey("record_checks"),
  );
  // 읽은 뒤 ticket이 바뀌었으면(conflict) 새 보고나 확인이 이미 일어난 것이다.
  if (!written.ok && written.error.code === "conflict") {
    return ok(undefined);
  }
  return written.ok ? ok(undefined) : written;
}

export function createTicketCheckHandler(
  client: TicketCheckClient,
): ReactorHandler<"TicketCompletionReported"> {
  return {
    name: TICKET_CHECK_HANDLER,
    async handle(event, context) {
      const input = { ticket: event.subject, completion_seq: event.seq };
      const read = await readWork(client, input);
      if (!read.ok) return read;
      const work = read.value;
      if (work === null) return ok(undefined);
      // release가 없으면 요청할 것이 없다. 아래 규칙이 inconclusive로 남긴다.
      if (work.check.kind === "examples" && work.release !== null) {
        const requested = await client.requestExamples(
          input,
          await context.idempotencyKey("request_examples"),
        );
        if (requested.ok) return ok(undefined);
        // 다시 해도 바뀌지 않는 실패(예시를 test로 만들 수 없음)는 재시도하지 않고 fail로 남긴다. 아니면
        // ticket이 결과 없이 남아 verify할 수 없다.
        if (requested.error.code !== "invalid_input") return requested;
        return await recordOutcome(client, work, {
          result: "fail",
          reason:
            `the examples could not be prepared: ${requested.error.message}`,
          verification: null,
        }, context);
      }
      const outcome = checkOutcomeOf(work);
      if (outcome === null) return ok(undefined);
      return await recordOutcome(client, work, outcome, context);
    },
  };
}

// 검증이 끝난 examples check의 결과를 ticket에 남긴다.
export function createExamplesCheckHandler(
  client: TicketCheckClient,
): ReactorHandler<"VerificationRecorded"> {
  return {
    name: EXAMPLES_CHECK_HANDLER,
    async handle(event, context) {
      const { kind, ticket } = event.payload;
      if (kind !== "examples" || ticket === undefined) return ok(undefined);
      const read = await readWork(client, {
        ticket: ticket.ticket,
        completion_seq: ticket.completion_seq,
      });
      if (!read.ok) return read;
      const outcome = read.value === null ? null : checkOutcomeOf(read.value);
      return read.value === null || outcome === null
        ? ok(undefined)
        : await recordOutcome(client, read.value, outcome, context);
    },
  };
}
