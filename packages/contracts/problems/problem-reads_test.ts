import { assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_ROUTES } from "../mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  getReport,
  getReportInputSchema,
  getSnapshot,
  getSnapshotInputSchema,
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
