import { assert, assertEquals } from "@std/assert";
import { diagnosticRecordSchema } from "./diagnostics.ts";
import {
  DIAGNOSTICS_WRITE_MAX_PENDING_BYTES,
  DIAGNOSTICS_WRITE_MAX_RECORDS,
  diagnosticsWriteInputSchema,
  diagnosticsWriteOutputSchema,
} from "./write.ts";
import {
  DIAGNOSTIC_KINDS,
  diagnosticSchema,
} from "../supervision/supervision.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const observedAt = "2026-10-04T00:00:00.000Z";
const observation = { component: "platform/io", observed_at: observedAt };

// supervision의 고정 strict catalog 여섯 종류를 그대로 records 원소로 쓴다.
const fixedRecords = [
  {
    type: "diagnostic",
    kind: "lophn_internal",
    payload: {
      ...observation,
      error_class: "internal_exception",
      location: "supervisor.ready",
      count: 1,
    },
  },
  {
    type: "diagnostic",
    kind: "unattributed_observation",
    payload: { ...observation, count: 1 },
  },
  {
    type: "diagnostic",
    kind: "invalid_report",
    payload: { ...observation, report: `rpt_${suffix}`, count: 1 },
  },
  {
    type: "diagnostic",
    kind: "shell_view_lifetime",
    payload: {
      ...observation,
      view_id: "view",
      generation: 1,
      created: 1,
      hidden: 0,
      replaced: 0,
      disposed: 0,
      attached: 1,
    },
  },
  {
    type: "diagnostic",
    kind: "app_invocation_delivery_loss",
    payload: {
      ...observation,
      app: `app_${suffix}`,
      lost_messages: 1,
      lost_bytes: 1,
      first_lost_at: observedAt,
      reason: "memory_limit",
    },
  },
  {
    type: "diagnostic",
    kind: "app_log_line_loss",
    payload: {
      ...observation,
      app: `app_${suffix}`,
      invocation: `inv_${suffix}`,
      dropped_lines: 1,
      reason: "buffer_limit",
    },
  },
] as const;

function batch(count: number) {
  return Array.from(
    { length: count },
    (_, index) => fixedRecords[index % fixedRecords.length],
  );
}

const badCounts = [
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 2,
  "0",
];

// 이 테스트는 wire 모양만 본다. queue 적재·redaction·현재 인증은 여기서 일어나지 않는다.
Deno.test("platform/diagnostics#R2 platform/diagnostics#R7: 기록은 supervision의 고정 여섯 종류만 보낸다", () => {
  assertEquals(fixedRecords.map((entry) => entry.kind), [...DIAGNOSTIC_KINDS]);
  assertEquals(DIAGNOSTIC_KINDS.length, 6);
  for (const entry of fixedRecords) {
    assert(diagnosticSchema.safeParse(entry).success);
    assert(
      diagnosticsWriteInputSchema.safeParse({ records: [entry], dropped: 0 })
        .success,
    );
  }
  // 기록이 없는 batch와 개수만 보낸 batch도 보낸다.
  for (const dropped of [0, 4096]) {
    assert(
      diagnosticsWriteInputSchema.safeParse({ records: [], dropped }).success,
    );
  }
  assert(
    !diagnosticSchema.safeParse({
      type: "diagnostic",
      kind: "app_log_dropped",
      payload: { ...observation, count: 1 },
    }).success,
  );
  assert(
    !diagnosticsWriteInputSchema.safeParse({
      records: [{ ...fixedRecords[0], kind: "log" }],
      dropped: 0,
    }).success,
  );
});

Deno.test("platform/diagnostics#R3: batch 기록 수와 대기 byte 상한은 고정이야", () => {
  assertEquals(DIAGNOSTICS_WRITE_MAX_RECORDS, 256);
  assertEquals(DIAGNOSTICS_WRITE_MAX_PENDING_BYTES, 1024 * 1024);
  const full = batch(DIAGNOSTICS_WRITE_MAX_RECORDS);
  assertEquals(full.length, 256);
  assertEquals(
    diagnosticsWriteInputSchema.safeParse({ records: full, dropped: 0 })
      .success,
    true,
  );
  assert(
    !diagnosticsWriteInputSchema.safeParse({
      records: [...full, fixedRecords[0]],
      dropped: 0,
    }).success,
  );
});

Deno.test("platform/diagnostics#R3: 안전하지 않은 count는 거절한다", () => {
  for (const dropped of badCounts) {
    assert(
      !diagnosticsWriteInputSchema.safeParse({ records: [], dropped }).success,
    );
    assert(
      !diagnosticsWriteOutputSchema.safeParse({ accepted: 0, dropped }).success,
    );
  }
  for (const accepted of badCounts) {
    assert(
      !diagnosticsWriteOutputSchema.safeParse({ accepted, dropped: 0 }).success,
    );
  }
  assert(
    diagnosticsWriteInputSchema.safeParse({
      records: [],
      dropped: Number.MAX_SAFE_INTEGER,
    }).success,
  );
  assert(
    diagnosticsWriteOutputSchema.safeParse({
      accepted: DIAGNOSTICS_WRITE_MAX_RECORDS,
      dropped: Number.MAX_SAFE_INTEGER,
    }).success,
  );
  assert(
    !diagnosticsWriteOutputSchema.safeParse({
      accepted: DIAGNOSTICS_WRITE_MAX_RECORDS + 1,
      dropped: 0,
    }).success,
  );
  // 두 count field가 모두 있어야 한다. request 수와의 관계는 host가 검사한다.
  assert(!diagnosticsWriteOutputSchema.safeParse({ dropped: 0 }).success);
  assert(!diagnosticsWriteOutputSchema.safeParse({ accepted: 0 }).success);
  assert(
    !diagnosticsWriteOutputSchema.safeParse({
      accepted: 1,
      dropped: 0,
      durable: true,
    }).success,
  );
});

Deno.test("platform/diagnostics#R2 platform/diagnostics#R5: 원문 message·stack·fields는 root·nested 어디에도 없다", () => {
  const base = fixedRecords[0];
  const extras = [
    { message: "token=secret" },
    { stack: "raw" },
    { stdout: "raw" },
    { stderr: "raw" },
    { fields: { token: "secret" } },
    { error: { name: "TypeError", stack: "raw" } },
    { location: "/private/path" },
    { bytes: "YmFzZTY0" },
  ];
  for (const extra of extras) {
    // nested: 고정 payload 안의 모르는 field는 거절한다.
    assert(
      !diagnosticsWriteInputSchema.safeParse({
        records: [{ ...base, payload: { ...base.payload, ...extra } }],
        dropped: 0,
      }).success,
    );
    // root: record와 payload 위에 놓은 모르는 field는 거절한다.
    assert(
      !diagnosticsWriteInputSchema.safeParse({
        records: [{ ...base, payload: base.payload, ...extra }],
        dropped: 0,
      }).success,
    );
  }
  for (
    const extra of [{ stdout: "raw" }, { byte_stream: "AA" }, { blob: "hash" }]
  ) {
    assert(
      !diagnosticsWriteInputSchema.safeParse({
        records: [],
        dropped: 0,
        ...extra,
      }).success,
    );
  }
  // 공개 DiagnosticRecord는 모르는 field를 벗겨 내므로, 거기서 통과한 것을
  // 이 wire 입력의 통과로 착각하지 않는다.
  const kept = diagnosticRecordSchema.parse({
    at: observedAt,
    component: "ledger",
    kind: "log",
    code: "lophn_internal",
    error_type: null,
    location: null,
    message: null,
    redaction: {
      rule_revision: "redaction-1",
      status: "omitted",
      content: null,
      redacted_items: [],
      omissions: [{
        location: "message",
        reason: "redaction_failed",
        message: "raw text left in",
      }],
    },
    stdout: "secret",
  });
  assert(!("stdout" in kept));
  assert(
    !diagnosticsWriteInputSchema.safeParse({
      records: [{ ...base, payload: base.payload, stdout: "secret" }],
      dropped: 0,
    }).success,
  );
});
