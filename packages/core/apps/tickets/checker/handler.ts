// 완료 보고를 받으면 check를 한 번 확인해 결과를 남기는 Reactor handler. `TicketCompletionReported`가
// 깨운다. 상태는 바꾸지 않고(판정은 App Engineer) 결과와 근거만 `ticket.record_checks`로 남긴다.
// 읽기와 쓰기는 core를 부르는 client로 주입받는다(machine 자격은 조립이 가진다).
import { ok, type Result } from "../../../../base/mod.ts";
import type { ReactorHandler } from "../../../events/ports.ts";
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
  work(input: { ticket: string; completion_seq: string }): Promise<
    Result<unknown>
  >;
  record(call: RecordChecksCall, idempotencyKey: string): Promise<
    Result<unknown>
  >;
};

const TICKET_CHECK_HANDLER = "ticket-check";

export function createTicketCheckHandler(
  client: TicketCheckClient,
): ReactorHandler<"TicketCompletionReported"> {
  return {
    name: TICKET_CHECK_HANDLER,
    async handle(event, context) {
      const read = await client.work({
        ticket: event.subject,
        completion_seq: event.seq,
      });
      if (!read.ok) return read;
      const body = (read.value as { work?: unknown } | null)?.work;
      // 이미 새 보고가 났거나 ticket이 reported가 아니면 할 일이 없다.
      if (body === null || body === undefined) return ok(undefined);
      const parsed = checkWorkSchema.safeParse(body);
      if (!parsed.success) return ok(undefined);
      const work: CheckWork = parsed.data;
      const outcome = checkOutcomeOf(work);
      if (outcome === null) return ok(undefined);
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
    },
  };
}
