// collector work(queues, retry, invalid report diagnostic)의 테스트.
// 이름은 요구 번호로 시작한다(dev/tasks.md).
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import type { RecordReportInput } from "../../contracts/problems/mod.ts";
import { isRetryableReportError } from "../../contracts/problems/mod.ts";
import {
  preparedReport,
  reportingId as id,
} from "../../contracts/problems/reporting-fixtures.ts";
import { err, ok } from "../../base/mod.ts";
import {
  appFromCredential,
  bodyOverLimit,
  COLLECTOR_CAPS,
  contentHashOf,
  createCollectorQueue,
  deliverReport,
  invalidReportDiagnostic,
  invalidReportId,
  originFrom,
  queueRejection,
  utf8Length,
} from "./work.ts";

const APP = id("app");
const AT = "2026-10-04T12:00:00.000Z";
const HASH = "a".repeat(64);

const ctx = (patch: Partial<RequestContext> = {}): RequestContext => ({
  principal: "collector-1",
  actor: "machine",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "cred-1",
  ...patch,
});

Deno.test("problems/reporting#R1: credential이 아닌 actor와 principal이 다른 본문은 forbidden이다", () => {
  const report = {
    id: id("rpt"),
    app: APP,
    principal: "collector-1",
  } as RecordReportInput["report"];
  const appActor = originFrom(ctx({ actor: "app:x" }), report);
  assertFalse(appActor.ok);
  assertEquals(appActor.ok ? "" : appActor.error.code, "forbidden");
  const otherPrincipal = originFrom(ctx(), {
    ...report,
    principal: "someone-else",
  });
  assertFalse(otherPrincipal.ok);
  assertEquals(otherPrincipal.ok ? "" : otherPrincipal.error.code, "forbidden");
  assert(originFrom(ctx(), report).ok);
});

Deno.test("problems/reporting#R2: credential app과 다른 report.app 제출은 거절한다", () => {
  const report = {
    app: APP,
  } as RecordReportInput["report"];
  const refused = appFromCredential(report, "app_01arz3ndektsv4rrffq69aa");
  assertFalse(refused.ok);
  assertEquals(refused.ok ? "" : refused.error.code, "forbidden");
  assert(appFromCredential(report, APP).ok);
});

Deno.test("problems/reporting#R16: collector 대기 한도(128개·16,777,216 bytes)를 넘는 입력은 손실 이유다", () => {
  const queue = createCollectorQueue({
    pending_count: COLLECTOR_CAPS.pending_count,
    pending_bytes: COLLECTOR_CAPS.pending_bytes,
  });
  assertEquals(COLLECTOR_CAPS.pending_count, 128);
  assertEquals(COLLECTOR_CAPS.pending_bytes, 16_777_216);
  assertEquals(COLLECTOR_CAPS.concurrent_assembly, 4);
  assert(
    queue.admit(id("rpt"), { report: { id: id("rpt") } } as never) ===
      undefined,
  );
  assertEquals(queue.size, 1);
  // 개수 한도는 등록값이다: 작은 큐로 넘는 입력을 본다.
  const small = createCollectorQueue({
    pending_count: 1,
    pending_bytes: 65_536,
  });
  assert(
    small.admit(id("rpt"), { report: { id: id("rpt") } } as never) ===
      undefined,
  );
  const over = small.admit(`${id("rpt")}-b`, {
    report: { id: id("rpt") },
  } as never);
  // 개수 한도에 걸린다.
  assert(over !== undefined);
  assertEquals(over.code, "unavailable");
  assert(over.message.includes("full"));
  assertEquals(queue.size, 1);
  queue.release(id("rpt"));
  assertEquals(queue.size, 0);
  assertEquals(queue.bytes, 0);
});

Deno.test("problems/reporting#R16: 큐 실패는 unavailable 손실 이유고 자동 본문 상한(262,144 bytes)을 잰다", () => {
  const full = queueRejection(true);
  const overBytes = queueRejection(false);
  assertEquals(full.code, "unavailable");
  assertEquals(overBytes.code, "unavailable");
  assert(full.message.includes("full"));
  assert(overBytes.message.includes("byte limit"));
  // JSON stringifying는 두개의 따옴표를 더한다: 본문 상한은 encoded 길이를 잰다.
  assertEquals(utf8Length("x".repeat(262_142)), 262_144);
  assertFalse(bodyOverLimit("x".repeat(262_142), 262_144));
  assert(bodyOverLimit("x".repeat(262_143), 262_144));
  assert(bodyOverLimit("x".repeat(262_145), 262_144));
});

Deno.test("problems/reporting#R16: unavailable·response_lost만 다시 보내고 첫 attempt 뒤 3회, 250·1,000·3,000ms 간격이다", async () => {
  const delays: number[] = [];
  const sleep = (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
  let calls = 0;
  const accepted = await deliverReport(
    () => {
      calls += 1;
      return calls < 3
        ? Promise.resolve(err({ code: "unavailable", message: "down" }))
        : Promise.resolve(
          ok({ report: id("rpt"), snapshot: id("snp") } as never),
        );
    },
    { delays: [250, 1_000, 3_000] },
    sleep,
    "lost",
  );
  assertEquals(accepted.status, "accepted");
  assertEquals(calls, 3);
  assertEquals(delays, [250, 1_000]);

  delays.length = 0;
  calls = 0;
  const failed = await deliverReport(
    () => {
      calls += 1;
      return Promise.resolve(err({ code: "unavailable", message: "down" }));
    },
    { delays: [250, 1_000, 3_000] },
    sleep,
    "lost",
  );
  assertEquals(failed.status, "failed");
  assertEquals(calls, 4);
  assertEquals(delays, [250, 1_000, 3_000]);

  delays.length = 0;
  const lost = await deliverReport(
    () => {
      throw new Error("dropped");
    },
    { delays: [250, 1_000, 3_000] },
    sleep,
    "response lost",
  );
  assertEquals(lost.status, "failed");
  if (lost.status !== "failed") throw new Error("lost는 실패다");
  assertEquals(lost.reason.code, "response_lost");
  assertEquals(delays, [250, 1_000, 3_000]);

  delays.length = 0;
  const forbidden = await deliverReport(
    () => Promise.resolve(err({ code: "forbidden", message: "no" })),
    { delays: [250, 1_000, 3_000] },
    sleep,
    "lost",
  );
  assertEquals(forbidden.status, "failed");
  assertEquals(delays, []);
  assertFalse(isRetryableReportError({ code: "forbidden", message: "no" }));
  assert(isRetryableReportError({ code: "response_lost", message: "lost" }));
});

Deno.test("problems/reporting#R16: 재전송은 같은 고정 input을 쥐고 release 전에 새 조립이 없다", () => {
  const queue = createCollectorQueue({
    pending_count: 4,
    pending_bytes: 65_536,
  });
  const input = {
    report: { id: id("rpt") },
    snapshot: {},
  } as unknown as RecordReportInput;
  assert(queue.admit(id("rpt"), input) === undefined);
  const first = queue.held(id("rpt"));
  assert(first !== undefined);
  assert(queue.admit(`${id("rpt")}-x`, input) === undefined);
  assertEquals(queue.held(id("rpt")), first);
  queue.release(id("rpt"));
  assertEquals(queue.held(id("rpt")), undefined);
});

Deno.test("problems/reporting#R8: 잘못된 보고 진단 ID는 원래 ID에서 결정적으로 정하고 재전송해도 같다", async () => {
  const first = await invalidReportId(id("rpt"));
  const again = await invalidReportId(id("rpt"));
  assert(first !== undefined);
  assert(again !== undefined);
  assertEquals(first, again);
  assert(first.startsWith("rpt_"));
  assert(/^rpt_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(first));
  assert(first !== id("rpt"));
  const unknown = await invalidReportId("not-an-id");
  assertEquals(unknown, undefined);
});

Deno.test("problems/reporting#R8: 잘못된 보고 진단은 count 1의 별도 ID 진단값이다", async () => {
  const diagnostic = await invalidReportDiagnostic({
    reportId: id("rpt"),
    component: "problems/report-collector",
    observedAt: AT,
  });
  assert(diagnostic !== undefined);
  assertEquals(diagnostic.type, "diagnostic");
  assertEquals(diagnostic.kind, "_invalid_report");
  assertEquals(diagnostic.payload.count, 1);
  assertEquals(diagnostic.payload.report, await invalidReportId(id("rpt")));
  const none = await invalidReportDiagnostic({
    reportId: "not-an-id",
    component: "problems/report-collector",
    observedAt: AT,
  });
  assertEquals(none, undefined);
});

Deno.test("problems/reporting#R9: content hash는 불변 입력에서 결정적으로 정한다", () => {
  const base = preparedReport();
  const first = contentHashOf(base);
  assert(first !== undefined);
  assertEquals(first, contentHashOf({ ...base, blobs: [] } as typeof base));
  // blobs가 달라지면 hash가 달라진다.
  const changed = contentHashOf(
    {
      ...base,
      blobs: [
        {
          hash: HASH,
          purpose: "snapshot_stack",
        },
      ],
    } as unknown as typeof base,
  );
  assert(changed !== undefined);
  assert(changed !== first);
});
