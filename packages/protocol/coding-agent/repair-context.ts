import { z } from "zod";
import { withReadCommon } from "../server/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../server/route.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import { problemSummarySchema } from "../problems/problems.ts";
import { ticketIdSchema } from "./ticket-values.ts";

// 전체 묶음은 UTF-8 24 KiB(24,576 bytes)와 300줄을 넘지 않는다(repair-context#R11).
export const REPAIR_CONTEXT_BYTES = 24_576;
export const REPAIR_CONTEXT_LINES = 300;

// 절은 이 순서로 제공하고(→ coding-agent/repair-context#R3) 내용과 누락 사실이
// 모두 없는 빈 절만 뺀다.
export const SECTION_KINDS = [
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
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export const sectionKindSchema = z.enum(SECTION_KINDS);

// 절별 기본 묶음 상한(docs/domain-model 절 순서와 내용 표). 줄·문자 쌍 상한도 있다.
export const SECTION_LIMITS = {
  target_symptom: { lines_per_problem: 1, lines_total: 2 },
  human_text: { lines_total: 5, chars_per_problem: 300 },
  inspect: { lines: 10, sources: 5 },
  acceptance_checks: { lines: 8, chars: 200 },
  preserve: { lines: 8, chars: 200 },
  failure_basis: { invocation_lines: 15 },
  representative_occurrences: { count: 3, lines_total: 30, chars_each: 400 },
  preceding_changes: { count: 12, lines: 14, chars_each: 100 },
  logs: { default_lines: 45, page_lines: 200 },
  past_repairs: { count: 5, lines: 10 },
  related_problems: { lines: 5, count_total: 10 },
  attachments: { lines: 40, image_metadata: 20, command_rows: 3 },
  reproduction: { lines: 6, chars: 500 },
  more: { lines: 5 },
  return_method: { lines: 4 },
} as const;

export type SectionLimit = (typeof SECTION_LIMITS)[SectionKind];

// 기본 묶음 밖 추가 근거 페이지 상한(repair-context#R15, R17).
export const EVIDENCE_PAGE_LIMITS = {
  log_lines: 200,
  occurrences: 20,
  source_diff_lines: 300,
  screen_bytes: 24_576,
  image_bytes: 2_097_152,
  text_bytes: REPAIR_CONTEXT_BYTES,
  text_lines: REPAIR_CONTEXT_LINES,
} as const;

// 실제 읽기 근거. blob hash는 단독 접근 권한이 아니다(repair-context 정책).
export const evidenceSourceSchema = z.object({
  concern: z.string().min(1),
  id: z.string().min(1).optional(),
  event_seq: seqSchema.optional(),
  version: z.string().min(1).optional(),
  hash: z.string().min(1).optional(),
});
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

// 실제 수집·접근 상태. available 외에는 reason이 필수다.
export const SECTION_AVAILABILITY = [
  "available",
  "missing",
  "redacted",
  "forbidden",
  "truncated",
] as const;

export const sectionAvailabilitySchema = z.enum(SECTION_AVAILABILITY);

export type SectionAvailability = z.infer<typeof sectionAvailabilitySchema>;

// 추가 근거 요청·이어 읽기 참조(repair-context#R15). cursor는 opaque string이다.
export const EVIDENCE_KINDS = [
  "log",
  "occurrences",
  "source_diff",
  "screen",
  "image",
  "fix_records",
  "verifications",
  "reference",
] as const;

export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// source는 정본 참조다. 임의 파일 경로 입력은 없다.
export const evidenceSourceRefSchema = z.string().min(1);

export const RepairEvidenceReadSchema = z.object({
  problem: idSchema("prb"),
  kind: evidenceKindSchema,
  source: evidenceSourceRefSchema,
  cursor: z.string().min(1).nullable(),
});
export type RepairEvidenceRead = z.infer<typeof RepairEvidenceReadSchema>;

// 문제별 절이면 problem이 필수고 공통 ticket·반환 안내는 null이다.
export const RepairContextSectionSchema = z.object({
  kind: sectionKindSchema,
  problem: idSchema("prb").nullable(),
  content: z.string().min(1),
  sources: z.array(evidenceSourceSchema).min(1),
  availability: sectionAvailabilitySchema,
  reason: z.string().min(1).nullable(),
  more: z.array(RepairEvidenceReadSchema).min(1).nullable(),
}).refine(
  (value) =>
    (value.availability === "available") === (value.reason === null) &&
    (value.availability === "truncated") === (value.more !== null),
  { message: "non-available section needs a reason; truncated needs more" },
);
export type RepairContextSection = z.infer<typeof RepairContextSectionSchema>;

export const RepairContextSchema = z.object({
  app: idSchema("app"),
  ticket: ticketIdSchema.nullable(),
  problems: z.array(idSchema("prb")).min(1).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate problem" },
  ),
  observed_at: atSchema,
  basis: z.array(evidenceSourceSchema).min(1),
  sections: z.array(RepairContextSectionSchema),
  truncated: z.boolean(),
  bytes: z.number().int().min(0).max(REPAIR_CONTEXT_BYTES),
  lines: z.number().int().min(0).max(REPAIR_CONTEXT_LINES),
});
export type RepairContext = z.infer<typeof RepairContextSchema>;

// problem 요약과 repair context는 같은 읽기 근거를 가리킨다(repair-context#R18).
export const repairContextSummarySchema = z.object({
  app: idSchema("app"),
  ticket: ticketIdSchema.nullable(),
  problems: z.array(problemSummarySchema).min(1),
  observed_at: atSchema,
  truncated: z.boolean(),
});

// 문제 요약은 문제당 2줄·전체 10줄·1,200자 이하다(repair-context#R11). 조립이
// 적용하고 contract는 basis에 더해 이 상한 상수만 묶는다.
export const REPAIR_CONTEXT_SUMMARY_MAX_CHARS = 1_200;

// selector는 problem 또는 repair ticket 둘 중 하나다(architecture 5.3).
const repairTargetSelectorSchema = z.object({
  problem: idSchema("prb").optional(),
  ticket: ticketIdSchema.optional(),
}).refine(
  (value) => (value.problem === undefined) !== (value.ticket === undefined),
  { message: "problem or ticket" },
);

const summaryCommon = {
  selector: repairTargetSelectorSchema,
  summary_version: z.string().min(1).optional(),
};

// `/v1/repair_context/summary` 요청 입력(architecture 5.3). 상태 무변경 read다.
export const RepairContextSummaryInputSchema = z.strictObject(summaryCommon);

export const repairContextSummaryOutputSchema = withReadCommon(z.object({
  summary: repairContextSummarySchema,
}));

export const repairContextSummary = defineRead({
  resource: "repair_context",
  method: "summary",
  name: "RepairContextSummary",
  input: RepairContextSummaryInputSchema,
  output: repairContextSummaryOutputSchema,
  actors: ["user", "coding_agent", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const RepairContextBundleInputSchema = z.strictObject(summaryCommon);

export const repairContextBundleOutputSchema = withReadCommon(z.object({
  context: RepairContextSchema,
}));

export const repairContextBundle = defineRead({
  resource: "repair_context",
  method: "bundle",
  name: "RepairContextBundle",
  input: RepairContextBundleInputSchema,
  output: repairContextBundleOutputSchema,
  actors: ["user", "coding_agent", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// 추가 근거 읽기는 problem·kind·source가 필수고 cursor는 첫 페이지 null이다.
export const RepairContextMoreInputSchema = z.strictObject({
  problem: idSchema("prb"),
  kind: evidenceKindSchema,
  source: evidenceSourceRefSchema,
  cursor: z.string().min(1).nullable().optional(),
});

// 페이지 응답은 kind별 상한을 지키고 다음 위치를 조건 유지 cursor로 준다(R15).
export const repairContextMoreOutputSchema = withReadCommon(z.object({
  problem: idSchema("prb"),
  kind: evidenceKindSchema,
  source: evidenceSourceRefSchema,
  item: z.unknown().nullable(),
  blobs: z.array(z.object({ purpose: z.string(), hash: z.string() })),
  missing: z.object({ reason: z.string() }).nullable(),
  next_cursor: z.string().min(1).nullable(),
}));

export const repairContextMore = defineRead({
  resource: "repair_context",
  method: "more",
  name: "RepairContextMore",
  input: RepairContextMoreInputSchema,
  output: repairContextMoreOutputSchema,
  actors: ["user", "coding_agent", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const REPAIR_CONTEXT_ROUTES = [
  repairContextSummary,
  repairContextBundle,
  repairContextMore,
] as const;

export type RepairContextRoute = typeof repairContextSummary;
