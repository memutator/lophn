import { assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_ROUTES } from "../mod.ts";
import { routePath } from "../base/route.ts";
import {
  getReport,
  getReportInputSchema,
  getSnapshot,
  getSnapshotInputSchema,
  getSnapshotLogs,
  getSnapshotLogsInputSchema,
  getSnapshotLogsOutputSchema,
  listReports,
  listReportsInputSchema,
  ROUTES,
} from "./mod.ts";

const id = (prefix: string) => `${prefix}_01arz3ndektsv4rrffq69g5fav`;

Deno.test("problems/closing#R13: report and snapshot reads match the architecture table", () => {
  const routes = [listReports, getReport, getSnapshot];
  assertEquals(
    routes.map((route) => [route.name, routePath(route), route.kind]),
    [
      ["ListReports", "/v1/problems/list-reports", "read"],
      ["GetReport", "/v1/problems/get-report", "read"],
      ["GetSnapshot", "/v1/problems/get-snapshot", "read"],
    ],
  );
  for (const route of routes) {
    assertEquals(ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(ALL_ROUTES.filter((entry) => entry === route).length, 1);
    assertEquals(
      route.errors.every((error) => ERROR_CODES.includes(error)),
      true,
    );
  }
});

Deno.test("problems/grouping#R4: report list is by problem or by diagnostic scope", () => {
  assertEquals(
    listReportsInputSchema.safeParse({ problem: id("prb") }).success,
    true,
  );
  assertEquals(
    listReportsInputSchema.safeParse({
      app: id("app"),
      diagnostic_scope: "preview-1",
    }).success,
    true,
  );
  assertEquals(
    listReportsInputSchema.safeParse({ app: id("app") }).success,
    false,
  );
  assertEquals(
    listReportsInputSchema.safeParse({ problem: id("prb"), stack: "raw" })
      .success,
    false,
  );
  assertEquals(
    getReportInputSchema.safeParse({ report: id("snp") }).success,
    false,
  );
});

Deno.test("problems/grouping#R2: snapshot read rejects an unknown item and a wrong id prefix", () => {
  assertEquals(
    getSnapshotInputSchema.safeParse({ snapshot: id("snp"), item: "error" })
      .success,
    true,
  );
  assertEquals(
    getSnapshotInputSchema.safeParse({ snapshot: id("snp"), item: "stack" })
      .success,
    false,
  );
  assertEquals(
    getSnapshotInputSchema.safeParse({ snapshot: id("rpt"), item: "logs" })
      .success,
    false,
  );
});

Deno.test("problems/snapshots#R13 R16: snapshot log read is user-only, registered once, and carries no rate or total", () => {
  assertEquals(
    [getSnapshotLogs.name, routePath(getSnapshotLogs), getSnapshotLogs.kind],
    ["GetSnapshotLogs", "/v1/problems/get-snapshot-logs", "read"],
  );
  assertEquals(getSnapshotLogs.actors, ["user"]);
  assertEquals(ROUTES.filter((entry) => entry === getSnapshotLogs).length, 1);
  assertEquals(
    ALL_ROUTES.filter((entry) => entry === getSnapshotLogs).length,
    1,
  );
  assertEquals(
    getSnapshotLogs.errors.every((error) => ERROR_CODES.includes(error)),
    true,
  );
  assertEquals(
    getSnapshotLogsInputSchema.safeParse({ snapshot: id("snp") }).success,
    true,
  );
  assertEquals(
    getSnapshotLogsInputSchema.safeParse({ snapshot: id("rpt") }).success,
    false,
  );
  const meta = { as_of_seq: "1", next_cursor: null };
  const at = "2026-10-04T12:00:00.000Z";
  const fragment = {
    kind: "fragment",
    lines: ["a", "b"],
    line_count: 2,
    truncated: true,
    scope: "app log fragment",
    from_at: null,
    to_at: null,
    collected_at: at,
    observation: "truncated fragment",
  };
  assertEquals(
    getSnapshotLogsOutputSchema.safeParse({ ...meta, fragment }).success,
    true,
  );
  // 비율·합계 같은 값은 읽기 응답에 실을 수 없다.
  assertEquals(
    getSnapshotLogsOutputSchema.safeParse({
      ...meta,
      fragment: { ...fragment, failure_rate: 0.5 },
    }).success,
    false,
  );
  for (
    const other of [
      { kind: "absent", reason: "collection off" },
      {
        kind: "unavailable",
        reason: "pruned",
        scope: "app log fragment",
        collected_at: at,
        truncated: false,
      },
    ]
  ) {
    assertEquals(
      getSnapshotLogsOutputSchema.safeParse({ ...meta, fragment: other })
        .success,
      true,
    );
  }
  assertEquals(
    getSnapshotLogsOutputSchema.safeParse({
      ...meta,
      fragment: { kind: "absent", reason: " " },
    }).success,
    false,
  );
});
