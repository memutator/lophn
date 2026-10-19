// ticket의 값. 내용은 목표(goal) 하나, acceptance check 하나, 근거(evidence)다.
import { z } from "zod";
import { annotationReadSchema } from "../../apps/annotation.ts";
import { toolNameSchema } from "../../apps/channel-values.ts";
import { canonicalize } from "../../../base/mod.ts";
import { idSchema } from "../../base/ids.ts";
import { atSchema, seqSchema, sha256Schema } from "../../base/values.ts";
import { codingSessionIdSchema } from "../token.ts";

export const ticketIdSchema = idSchema("tkt");
export type TicketId = z.infer<typeof ticketIdSchema>;

// 앱 source 안 상대 위치. 절대 경로·루트 밖 `..`·빈 조각은 거절한다.
export const sourceRelativePathSchema = z.string().min(1).refine(
  (value) =>
    value === "." ||
    (!/^[\\/]|^[A-Za-z]:|\\/.test(value) && !value.includes("\u0000") &&
      !/[\r\n]/.test(value) &&
      value.split("/").every((part) => part !== ".." && part !== "")),
  { message: "path must stay inside source" },
);

const TICKET_STATES = [
  "open",
  "claimed",
  "reported",
  "verified",
  "failed",
  "cancelled",
] as const;
export const ticketStateSchema = z.enum(TICKET_STATES);
export type TicketState = z.infer<typeof ticketStateSchema>;

const GOAL_MAX_CODE_POINTS = 2000;
const TITLE_MAX_CODE_POINTS = 120;

const codePoints = (max: number) =>
  z.string().refine((value) => {
    const count = [...value].length;
    return count >= 1 && count <= max && /\S/.test(value);
  }, { message: "text length" });

export const ticketGoalSchema = codePoints(GOAL_MAX_CODE_POINTS);
export const ticketCancelReasonSchema = codePoints(200).refine(
  (value) => !/[\r\n]/.test(value),
  { message: "one line" },
);

// 목록용 제목은 goal의 첫 줄이다.
export function ticketTitleOf(goal: string): string {
  const line = goal.split(/\r?\n/).find((part) => /\S/.test(part)) ?? "";
  return [...line.trim()].slice(0, TITLE_MAX_CODE_POINTS).join("");
}

const CHECK_TEXT_MAX_CODE_POINTS = 500;
const EXAMPLE_STEPS_MAX = 20;
const EXAMPLE_VALUE_MAX_BYTES = 8192;

// tool 입력이라 JSON Schema로 바뀌어야 한다. z.custom은 바뀌지 않아 turn 준비가 깨진다.
const exampleValueSchema = z.json().refine(
  (value) =>
    new TextEncoder().encode(canonicalize(value)).byteLength <=
      EXAMPLE_VALUE_MAX_BYTES,
  { message: "example value is too large" },
);

// tool 한 번의 호출 예시. 호출이 성공하면 그 result가 expect와 맞아야 한다.
const exampleStepSchema = z.strictObject({
  tool: toolNameSchema,
  input: exampleValueSchema.optional(),
  expect: exampleValueSchema,
});

// acceptance check는 하나다. examples는 program이 준비된 release에 불러 비교하는 tool 예시이고,
// text는 App Engineer가 판단하는 글 조건이다.
export const acceptanceCheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("examples"),
    steps: z.array(exampleStepSchema).min(1).max(EXAMPLE_STEPS_MAX),
  }),
  z.strictObject({ kind: z.literal("app_test") }),
  z.strictObject({
    kind: z.literal("text"),
    text: codePoints(CHECK_TEXT_MAX_CODE_POINTS),
  }),
]);
export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>;

// 근거 링크. 문제, 다른 ticket, release, 앱 source 파일, 화면 annotation.
const ticketEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("problem"), id: idSchema("prb") }),
  z.strictObject({ kind: z.literal("ticket"), id: ticketIdSchema }),
  z.strictObject({ kind: z.literal("release"), id: idSchema("rel") }),
  z.strictObject({ kind: z.literal("file"), path: sourceRelativePathSchema }),
  z.strictObject({ kind: z.literal("annotation"), id: idSchema("ann") }),
]);
export type TicketEvidence = z.infer<typeof ticketEvidenceSchema>;

const TICKET_EVIDENCE_MAX = 20;
export const ticketEvidenceListSchema = z.array(ticketEvidenceSchema)
  .max(TICKET_EVIDENCE_MAX)
  .refine(
    (values) =>
      new Set(values.map((value) => JSON.stringify(value))).size ===
        values.length,
    { message: "duplicate evidence" },
  );

// 읽는 쪽 근거. annotation은 값을 풀어 싣는다(메모, component 겹, release,
// screenshot 파일 경로). 지워졌거나 못 읽는 annotation은 값이 null이다.
export const ticketEvidenceReadSchema = z.union([
  z.strictObject({
    kind: z.literal("annotation"),
    id: idSchema("ann"),
    annotation: annotationReadSchema.nullable(),
  }),
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("problem"), id: idSchema("prb") }),
    z.strictObject({ kind: z.literal("ticket"), id: ticketIdSchema }),
    z.strictObject({ kind: z.literal("release"), id: idSchema("rel") }),
    z.strictObject({ kind: z.literal("file"), path: sourceRelativePathSchema }),
  ]),
]);
export type TicketEvidenceRead = z.infer<typeof ticketEvidenceReadSchema>;

// claim의 주인은 coding session이다.
export const ticketClaimSchema = z.object({
  session: codingSessionIdSchema,
  claim_seq: seqSchema,
  expires_at: atSchema,
});

const CHECK_RESULTS = ["pass", "fail", "inconclusive"] as const;
export const checkResultSchema = z.enum(CHECK_RESULTS);
export type CheckResult = z.infer<typeof checkResultSchema>;

// 보고를 받을 때 돌린 실행 조건의 결과다. 기록만 하고 상태는 바꾸지 않는다.
export const ticketCheckResultSchema = z.object({
  completion_seq: seqSchema,
  result: checkResultSchema,
  reason: z.string().max(2000),
  verification: idSchema("vrf").nullable(),
});

// 완료 보고의 값이다. release는 coding agent가 준비한 것이고 summary는 hash로 가리킨다.
export const completionFields = {
  release: idSchema("rel"),
  summary_hash: sha256Schema,
  verifications: z.array(idSchema("vrf")).max(24),
};
export const ticketCompletionSchema = z.object({
  completion_seq: seqSchema,
  ...completionFields,
});

const VERIFY_RESULTS = ["verified", "failed"] as const;
export const verifyResultSchema = z.enum(VERIFY_RESULTS);
export const VERIFY_NOTE_MAX_CODE_POINTS = 500;
export const ticketVerdictSchema = z.object({
  completion_seq: seqSchema,
  result: verifyResultSchema,
  note: z.string().nullable(),
});

export const TICKET_LIST_LIMIT = 20;
