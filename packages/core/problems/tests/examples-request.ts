// 보고된 ticket의 examples check를 돌릴 test 요청을 core가 machine 자격으로 낸다. 요청의 `test` hash는
// 보고 release의 bundle 사본과 ticket의 예시로 runner와 같은 함수(deriveAppTest)가 구한다.
// 예시 자체는 요청에 싣지 않는다: 접수 준비가 ticket에서 다시 읽어 접수 기록에 싣는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { RequestTestInput } from "../../../protocol/problems/mod.ts";
import { appBundleCopy } from "../../../protocol/apps/mod.ts";
import { appProjectOf } from "../../apps/lookups.ts";
import { checkWorkSchema } from "../../apps/tickets/checker/mod.ts";
import { openConnection } from "../../storage/ledger/mod.ts";
import { deriveAppTest } from "./app-test/mod.ts";
import { canonicalHash } from "./canonical.ts";

type ExamplesRequestDeps = {
  dataRoot: string;
  // 앱의 project를 읽는 ledger. bundle 사본이 project 아래라 경로를 만들 때 쓴다.
  ledgerPath: string;
  // `ticket.check_work` read와 같은 모양이다(`TicketCheckClient.work`).
  work(input: { ticket: string; completion_seq: string }): Promise<
    Result<unknown>
  >;
  // machine 자격으로 RequestTest를 낸다.
  request(input: RequestTestInput): Promise<Result<unknown>>;
};

function projectOf(ledgerPath: string, app: string): string | null {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return null;
  try {
    return appProjectOf(opened.value.sql, app);
  } catch {
    return null;
  } finally {
    opened.value.close();
  }
}

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
    const project = projectOf(deps.ledgerPath, work.app);
    if (project === null) {
      return err({ code: "unavailable", message: "the app is unavailable" });
    }
    const derived = await deriveAppTest(
      appBundleCopy(deps.dataRoot, project, release.bundle_hash),
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
