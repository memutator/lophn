import { assert, assertEquals } from "@std/assert";
import { commandRequestSchema } from "../base/envelope.ts";
import { routePath } from "../base/route.ts";
import { APP, AT, HASH, PRB, TKT } from "./ticket-fixtures.ts";
import {
  EVIDENCE_KINDS,
  EVIDENCE_PAGE_LIMITS,
  REPAIR_CONTEXT_BYTES,
  REPAIR_CONTEXT_LINES,
  REPAIR_CONTEXT_ROUTES,
  repairContextBundle,
  RepairContextBundleInputSchema,
  repairContextMore,
  RepairContextMoreInputSchema,
  RepairContextSchema,
  RepairContextSectionSchema,
  repairContextSummary,
  RepairContextSummaryInputSchema,
  SECTION_AVAILABILITY,
  SECTION_KINDS,
  SECTION_LIMITS,
  sectionAvailabilitySchema,
  sectionKindSchema,
} from "./repair-context.ts";

const source = {
  concern: "problems/reporting",
  id: "rpt_01h455vb4pex5v6nkc6gd5fdw1",
};

const section = {
  kind: "target_symptom" as const,
  problem: PRB,
  content: "save 버튼을 누르면 아무 응답이 없다",
  sources: [source],
  availability: "available" as const,
  reason: null,
  more: null,
};

const context = {
  app: APP,
  ticket: TKT,
  problems: [PRB],
  observed_at: AT,
  basis: [{ concern: "problems/grouping", id: PRB, event_seq: "12" }],
  sections: [section],
  truncated: false,
  bytes: 1_024,
  lines: 4,
};

Deno.test(
  "coding-agent/repair-context#R3, coding-agent/repair-context#R17: 절 순서·availability·evidence kind는 문서와 같다",
  () => {
    assertEquals(SECTION_KINDS, [
      "target_symptom",
      "human_text",
      "inspect",
      "acceptance_checks",
      "preserve",
      "failure_basis",
      "representative_occurrences",
      "preceding_changes",
      "logs",
      "past_repairs",
      "related_problems",
      "attachments",
      "reproduction",
      "more",
      "return_method",
    ]);
    assertEquals(sectionKindSchema.safeParse("symptom").success, false);
    assertEquals(SECTION_AVAILABILITY, [
      "available",
      "missing",
      "redacted",
      "forbidden",
      "truncated",
    ]);
    assertEquals(sectionAvailabilitySchema.safeParse("skipped").success, false);
    assertEquals(EVIDENCE_KINDS, [
      "log",
      "occurrences",
      "source_diff",
      "screen",
      "image",
      "fix_records",
      "verifications",
      "reference",
    ]);
  },
);

Deno.test(
  "coding-agent/repair-context#R4, #R5, #R6, #R7, #R8, #R9, #R10: 절별 상한 표는 문서 표와 같다",
  () => {
    assertEquals(SECTION_LIMITS.target_symptom, {
      lines_per_problem: 1,
      lines_total: 2,
    });
    assertEquals(SECTION_LIMITS.human_text, {
      lines_total: 5,
      chars_per_problem: 300,
    });
    assertEquals(SECTION_LIMITS.inspect, { lines: 10, sources: 5 });
    assertEquals(SECTION_LIMITS.acceptance_checks, { lines: 8, chars: 200 });
    assertEquals(SECTION_LIMITS.preserve, { lines: 8, chars: 200 });
    assertEquals(SECTION_LIMITS.failure_basis, { invocation_lines: 15 });
    assertEquals(SECTION_LIMITS.representative_occurrences, {
      count: 3,
      lines_total: 30,
      chars_each: 400,
    });
    assertEquals(SECTION_LIMITS.preceding_changes, {
      count: 12,
      lines: 14,
      chars_each: 100,
    });
    assertEquals(SECTION_LIMITS.logs, { default_lines: 45, page_lines: 200 });
    assertEquals(SECTION_LIMITS.past_repairs, { count: 5, lines: 10 });
    assertEquals(SECTION_LIMITS.related_problems, {
      lines: 5,
      count_total: 10,
    });
    assertEquals(SECTION_LIMITS.attachments, {
      lines: 40,
      image_metadata: 20,
      command_rows: 3,
    });
    assertEquals(SECTION_LIMITS.reproduction, { lines: 6, chars: 500 });
    assertEquals(SECTION_LIMITS.more, { lines: 5 });
    assertEquals(SECTION_LIMITS.return_method, { lines: 4 });
  },
);

Deno.test(
  "coding-agent/repair-context#R11: 전체 묶음은 24,576 bytes·300줄 상한 안이다",
  () => {
    assertEquals(REPAIR_CONTEXT_BYTES, 24_576);
    assertEquals(REPAIR_CONTEXT_LINES, 300);
    assertEquals(EVIDENCE_PAGE_LIMITS.text_bytes, 24_576);
    assertEquals(EVIDENCE_PAGE_LIMITS.text_lines, 300);
    const parsed = RepairContextSchema.parse(context);
    assertEquals(parsed.bytes, 1_024);
    assert(
      !RepairContextSchema.safeParse({ ...context, bytes: 24_577 }).success,
    );
    assert(!RepairContextSchema.safeParse({ ...context, lines: 301 }).success);
    // 생략·누락·잘림 표시도 예산에 포함되므로 상한 값은 같다.
    assertEquals(EVIDENCE_PAGE_LIMITS.screen_bytes, 24_576);
    assertEquals(EVIDENCE_PAGE_LIMITS.log_lines, 200);
    assertEquals(EVIDENCE_PAGE_LIMITS.occurrences, 20);
    assertEquals(EVIDENCE_PAGE_LIMITS.source_diff_lines, 300);
    assertEquals(EVIDENCE_PAGE_LIMITS.image_bytes, 2_097_152);
  },
);

Deno.test(
  "coding-agent/repair-context#R3, coding-agent/repair-context#R12: available 외에는 reason이 필수고 잘림에는 추가 읽기가 필수다",
  () => {
    const missing = RepairContextSectionSchema.parse({
      ...section,
      availability: "missing",
      reason: "보존된 snapshot이 없다",
    });
    assertEquals(missing.reason, "보존된 snapshot이 없다");
    assert(!RepairContextSectionSchema.safeParse(section).success === false);
    assert(
      !RepairContextSectionSchema.safeParse({
        ...section,
        availability: "missing",
        reason: null,
      }).success,
    );
    assert(
      !RepairContextSectionSchema.safeParse({
        ...section,
        availability: "truncated",
        reason: "log 상한을 넘었다",
        more: [],
      }).success,
    );
    assert(
      !RepairContextSectionSchema.safeParse({
        ...section,
        availability: "truncated",
        reason: null,
      }).success,
    );
  },
);

Deno.test(
  "coding-agent/repair-context#R15, coding-agent/repair-context#R17, coding-agent/mcp-server#R24: 세 route는 /v1/repair_context/{summary,bundle,more}다",
  () => {
    assertEquals(
      REPAIR_CONTEXT_ROUTES.map((route) => [route.kind, routePath(route)]),
      [
        ["read", "/v1/repair_context/summary"],
        ["read", "/v1/repair_context/bundle"],
        ["read", "/v1/repair_context/more"],
      ],
    );
    for (const route of REPAIR_CONTEXT_ROUTES) {
      assertEquals(route.actors, ["user", "coding_agent", "agent"]);
    }
  },
);

Deno.test(
  "coding-agent/repair-context#R11, coding-agent/repair-context#R15: summary·bundle은 problem 또는 repair ticket 하나만 받는다",
  () => {
    assertEquals(
      RepairContextSummaryInputSchema.parse({
        selector: { problem: PRB },
      }).selector.problem,
      PRB,
    );
    assertEquals(
      RepairContextSummaryInputSchema.parse({
        selector: { ticket: TKT },
      }).selector.ticket,
      TKT,
    );
    RepairContextBundleInputSchema.parse({
      selector: { ticket: TKT },
      summary_version: "rev-1",
    });
    // 둘 다 또는 둘 다 없음은 거절이다.
    assert(
      !RepairContextSummaryInputSchema.safeParse({
        selector: { problem: PRB, ticket: TKT },
      }).success,
    );
    assert(
      !RepairContextBundleInputSchema.safeParse({ selector: {} }).success,
    );
    // selector 밖 filter는 없다(architecture 5.3).
    assert(
      !RepairContextSummaryInputSchema.safeParse({
        selector: { problem: PRB },
        cursor: "next-1",
      }).success,
    );
    assert(
      !RepairContextSummaryInputSchema.safeParse({
        selector: { ticket: "prb_01h455vb4pex5v6nkc6gd5fdw1" },
      }).success,
    );
  },
);

Deno.test(
  "coding-agent/repair-context#R15, coding-agent/repair-context#R16: more는 problem·kind·source가 필수고 cursor는 opaque 문자열이다",
  () => {
    assertEquals(
      RepairContextMoreInputSchema.parse({
        problem: PRB,
        kind: "log",
        source: "snp_01h455vb4pex5v6nkc6gd5fdw1/logs",
        cursor: null,
      }).cursor,
      null,
    );
    RepairContextMoreInputSchema.parse({
      problem: PRB,
      kind: "occurrences",
      source: "prb_01h455vb4pex5v6nkc6gd5fdw1/reports",
      cursor: "page-2@seq12",
    });
    // source는 정본 참조뿐이다. 임의 파일 경로 입력은 owner object에 없다.
    assertEquals(
      Object.keys(RepairContextMoreInputSchema.shape).sort(),
      ["cursor", "kind", "problem", "source"],
    );
    assert(
      !RepairContextMoreInputSchema.safeParse({
        problem: PRB,
        kind: "log",
      }).success,
    );
    assert(
      !RepairContextMoreInputSchema.safeParse({
        problem: PRB,
        kind: "stack",
        source: "snp_01h455vb4pex5v6nkc6gd5fdw1/logs",
      }).success,
    );
    assert(
      !RepairContextMoreInputSchema.safeParse({
        problem: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
        kind: "log",
        source: "snp_01h455vb4pex5v6nkc6gd5fdw1/logs",
      }).success,
    );
    // cursor는 임의 문자열로 조건을 유지한다(HASH 값도 아니다).
    const request = commandRequestSchema(repairContextMore).parse({
      input: {
        problem: PRB,
        kind: "log",
        source: "snp_01h455vb4pex5v6nkc6gd5fdw1/logs",
        cursor: "opaque-next",
      },
      idempotency_key: "read-more",
      compare: {},
      prepared: [HASH],
    });
    assertEquals(request.input.cursor, "opaque-next");
    assertEquals(repairContextMore.name, "RepairContextMore");
    assertEquals(repairContextBundle.name, "RepairContextBundle");
    assertEquals(repairContextSummary.name, "RepairContextSummary");
    // read는 상태 무변경이라 confirmation handle을 요구하지 않는다.
    assertEquals(repairContextMore.confirmation, undefined);
  },
);
