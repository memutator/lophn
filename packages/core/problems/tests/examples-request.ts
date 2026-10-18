// 보고된 ticket의 examples check를 돌릴 test 요청을 core가 machine 자격으로 낸다. 요청의 `test` hash는
// 보고 release의 bundle 사본과 ticket의 예시로 runner와 같은 함수(deriveAppTest)가 구한다.
// 예시 자체는 요청에 싣지 않는다: 접수 준비가 ticket에서 다시 읽어 접수 기록에 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { RequestTestInput } from "../../../protocol/problems/mod.ts";
import { checkWorkSchema } from "../../apps/tickets/checker/mod.ts";
import { deriveAppTest } from "./app-test/mod.ts";
import { canonicalHash } from "./canonical.ts";

type ExamplesRequestDeps = {
  dataRoot: string;
  // `ticket.check_work` read와 같은 모양이다(`TicketCheckClient.work`).
  work(input: { ticket: string; completion_seq: string }): Promise<
    Result<unknown>
  >;
  // machine 자격으로 RequestTest를 낸다.
  request(input: RequestTestInput): Promise<Result<unknown>>;
};

export function requestExamples(
  deps: ExamplesRequestDeps,
): (
  input: { ticket: string; completion_seq: string },
) => Promise<Result<{ request_key: string }>> {
  return async (input) => {
    const read = await deps.work(input);
    if (!read.ok) return read;
    const parsed = checkWorkSchema.safeParse(
      (read.value as { work?: unknown } | null)?.work,
    );
    // 이미 새 보고가 났거나 reported가 아니면 낼 요청이 없다.
    if (!parsed.success) {
      return err({ code: "conflict", message: "the report is not current" });
    }
    const work = parsed.data;
    const { check, release } = work;
    if (check.kind !== "examples" || release === null) {
      return err({
        code: "conflict",
        message: "the ticket has no examples check or no reported release",
      });
    }
    const derived = await deriveAppTest(
      `${deps.dataRoot}/apps/${work.app}/bundles/${release.bundle_hash}`,
      release.bundle_hash,
      { examples: check.steps },
    );
    // 봉인된 bundle 사본이 읽히지 않는 것은 다시 해도 바뀌지 않는다. 재시도하지 않게 invalid_input이다.
    if (!derived.ok) {
      return err({ code: "invalid_input", message: derived.reason });
    }
    const request_key = `examples:${work.ticket}:${work.completion_seq}`;
    const sent = await deps.request({
      request_key,
      kind: "examples",
      app: work.app,
      target: { bundle_hash: release.bundle_hash, release: release.id },
      ticket: {
        ticket: work.ticket,
        check_index: 0,
        check_hash: canonicalHash(check),
        completion_seq: work.completion_seq,
      },
      test: derived.value.test_hash,
    });
    return sent.ok ? ok({ request_key }) : sent;
  };
}
