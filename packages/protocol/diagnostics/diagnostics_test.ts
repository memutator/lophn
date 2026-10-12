import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  DIAGNOSTIC_ROUTES,
  diagnosticRecordSchema,
  diagnosticsCheck,
  diagnosticsList,
} from "./diagnostics.ts";
import { routePath } from "../base/route.ts";

const at = "2026-10-04T00:00:00.000Z";
const meta = { as_of_seq: "9", next_cursor: null };

const redaction = {
  rule_revision: "redaction-1",
  status: "passed",
  content: { kind: "inline", value: "writer stopped" },
  redacted_items: [],
  omissions: [],
};

const record = {
  at,
  component: "ledger",
  kind: "log",
  code: "lophn_internal",
  error_type: "disk_full",
  location: "platform/ledger",
  message: "writer stopped",
  redaction,
};

Deno.test("platform/diagnostics#R1, platform/diagnostics#R8: diagnostics read 이름은 architecture 5.1과 같다", () => {
  assertEquals(DIAGNOSTIC_ROUTES.map(routePath), [
    "/v1/diagnostics/list",
    "/v1/diagnostics/check",
  ]);
  for (const route of DIAGNOSTIC_ROUTES) {
    assertEquals(route.kind, "read");
    assert(route.errors.includes("unauthorized"));
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("platform/diagnostics#R2, platform/diagnostics#R9, platform/diagnostics#R10: 진단 항목과 doctor 관측이 통과한다", () => {
  assert(
    diagnosticsList.output.safeParse({ ...meta, records: [record] }).success,
  );
  assert(
    diagnosticsCheck.output.safeParse({
      ...meta,
      observed_at: at,
      results: [{
        check: "sdk_hash",
        observed_at: at,
        finding: { ...record, kind: "health", error_type: null },
      }, {
        check: "raw_key_pattern",
        observed_at: at,
        finding: null,
      }],
    }).success,
  );
});

Deno.test("platform/diagnostics#R2, platform/diagnostics#R5: 모르는 field·원문 없는 생략·틀린 검사를 거절한다", () => {
  assert(!diagnosticsList.input.safeParse({ token: "raw" }).success);
  assert(
    !diagnosticsCheck.input.safeParse({ checks: ["memory_dump"] }).success,
  );
  const kept = diagnosticRecordSchema.parse({ ...record, stdout: "secret" });
  assert(!("stdout" in kept));
  assert(
    !diagnosticRecordSchema.safeParse({
      ...record,
      redaction: {
        ...redaction,
        status: "omitted",
        content: { kind: "inline", value: "left in" },
      },
    }).success,
  );
});
