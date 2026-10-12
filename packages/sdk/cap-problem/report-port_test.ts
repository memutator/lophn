import { assert, assertEquals } from "@std/assert";
import { formatAt } from "@lophn/base";
import type { ReportAcceptance } from "@lophn/protocol/problems/sdk-report";
import {
  installProblemReporter,
  REPORTER_PORT,
  reportProblem,
} from "./report-port.ts";
import { createProblemReporter } from "./reporter.ts";

const acceptance: ReportAcceptance = {
  report: "rpt_00000000000000000000000001",
  snapshot: "snp_00000000000000000000000001",
  problem: "prb_00000000000000000000000001",
  diagnostic_scope: null,
};

function clear() {
  delete (globalThis as Record<symbol, unknown>)[REPORTER_PORT];
}

Deno.test("problems/reporting#R1 apps/sdk#R26: reportProblem without an installed reporter fails as a value and never throws", async () => {
  clear();
  const result = reportProblem("store_unavailable");
  const completion = await result.completion;
  assertEquals(completion.status, "failed");
});

Deno.test("problems/reporting#R1 apps/sdk#R26: reportProblem sends through the reporter the entrypoint installed", async () => {
  clear();
  const sent: string[] = [];
  installProblemReporter(createProblemReporter({
    transport: (input) => {
      sent.push(input.code);
      return Promise.resolve({ ok: true, value: acceptance });
    },
    now: () => formatAt(Date.parse("2026-10-06T00:00:00.000Z")),
    newId: (prefix) => `${prefix}_00000000000000000000000001`,
    sleep: () => Promise.resolve(),
    currentInvocation: () => null,
  }));
  const result = reportProblem("store_unavailable", { command: "list_items" });
  assert(result.report_id.startsWith("rpt_"));
  assertEquals((await result.completion).status, "accepted");
  assertEquals(sent, ["store_unavailable"]);
  // 먼저 설치한 reporter를 나중 설치가 덮어쓰지 않는다.
  installProblemReporter(() => {
    throw new Error("second installer must not replace the first");
  });
  assertEquals(
    (await reportProblem("store_unavailable").completion).status,
    "accepted",
  );
  clear();
});
