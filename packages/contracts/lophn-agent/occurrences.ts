import { z } from "zod";
import {
  atSchema,
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  seqSchema,
  withReadCommon,
} from "../platform/mod.ts";
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const missed = {
  due_at: atSchema,
  missed_first_at: atSchema.nullable(),
  missed_last_at: atSchema.nullable(),
  missed_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};
type Range = z.infer<typeof missedRangeSchema>;
const missedRangeSchema = z.object(missed);
function validMissed(value: Range & { previous_due_at?: string | null }) {
  if (value.previous_due_at != null && value.previous_due_at >= value.due_at) {
    return false;
  }
  const none = value.missed_first_at === null && value.missed_last_at === null;
  if (value.missed_count === 0) return none;
  if (none || value.missed_first_at === null || value.missed_last_at === null) {
    return false;
  }
  return value.missed_first_at <= value.missed_last_at &&
    value.missed_last_at < value.due_at &&
    (value.previous_due_at == null ||
      value.previous_due_at < value.missed_first_at);
}
const common = {
  assignment_revision: revision,
  previous_due_at: atSchema.nullable(),
  ...missed,
  outcome: z.enum(["accepted", "skipped"]),
  run: idSchema("run").nullable(),
  skip_reason: z.literal("unfinished_run").nullable(),
  blocking_runs: z.array(idSchema("run")),
};
type Outcome = z.infer<typeof occurrenceFieldsSchema>;
const occurrenceFieldsSchema = z.object(common);
function validOutcome(value: Outcome) {
  if (!validMissed(value)) return false;
  if (value.outcome === "accepted") {
    return value.run !== null && value.skip_reason === null &&
      value.blocking_runs.length === 0;
  }
  return value.run === null && value.skip_reason === "unfinished_run" &&
    value.blocking_runs.length > 0 &&
    new Set(value.blocking_runs).size === value.blocking_runs.length;
}
export const scheduleOccurrenceSchema = z.object({
  assignment: idSchema("asg"),
  ...common,
}).refine(validOutcome, {
  message: "invalid occurrence outcome or missed range",
});
export type ScheduleOccurrence = z.infer<typeof scheduleOccurrenceSchema>;
export const processAssignmentOccurrenceInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  ...missed,
}).refine(validMissed, {
  message: "invalid missed range",
});
export const processAssignmentOccurrenceCompareSchema = z.strictObject({
  assignment_revision: revision,
  previous_due_at: atSchema.nullable(),
});
export const processAssignmentOccurrenceOutputSchema = z.object({
  occurrence: scheduleOccurrenceSchema,
});
const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;
export const processAssignmentOccurrence = defineCommand({
  resource: "assignment-occurrences",
  method: "process",
  name: "ProcessAssignmentOccurrence",
  input: processAssignmentOccurrenceInputSchema,
  compare: processAssignmentOccurrenceCompareSchema,
  output: processAssignmentOccurrenceOutputSchema,
  actors: ["machine"],
  errors,
});
export const assignmentOccurrencesListInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  assignment_revision: revision.optional(),
  after_due_at: atSchema.optional(),
  through_due_at: atSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).refine(
  (value) =>
    value.after_due_at === undefined || value.through_due_at === undefined ||
    value.after_due_at < value.through_due_at,
  {
    message: "empty or inverted due range",
  },
);
export const occurrenceSnapshotSchema = z.object({
  occurrence: scheduleOccurrenceSchema,
  event_seq: seqSchema,
});
export const assignmentOccurrencesListOutputSchema = withReadCommon(
  z.object({ occurrences: z.array(occurrenceSnapshotSchema) }),
).refine((value) => {
  if (!seqSchema.safeParse(value.as_of_seq).success) return false;
  const keys = new Set<string>();
  let previousDue = "";
  let previousSeq = -1n;
  return value.occurrences.every((entry) => {
    if (!seqSchema.safeParse(entry.event_seq).success) return false;
    const key =
      `${entry.occurrence.assignment}/${entry.occurrence.assignment_revision}/${entry.occurrence.due_at}`;
    const seq = BigInt(entry.event_seq);
    const valid = !keys.has(key) && entry.occurrence.due_at > previousDue &&
      seq > previousSeq && seq <= BigInt(value.as_of_seq);
    keys.add(key);
    previousDue = entry.occurrence.due_at;
    previousSeq = seq;
    return valid;
  });
}, { message: "occurrences must be unique, ordered and within snapshot" });
export const assignmentOccurrencesList = defineRead({
  resource: "assignment-occurrences",
  method: "list",
  name: "ListAssignmentOccurrences",
  input: assignmentOccurrencesListInputSchema,
  output: assignmentOccurrencesListOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: errors.filter((code) => code !== "conflict"),
});
export const assignmentScheduleAdvancedPayloadSchema = z.object(common).refine(
  validOutcome,
  { message: "invalid occurrence outcome or missed range" },
);
export const assignmentScheduleAdvanced = defineEvent(
  "AssignmentScheduleAdvanced",
  {
    subject: idSchema("asg"),
    payload: assignmentScheduleAdvancedPayloadSchema,
  },
);
export const OCCURRENCE_ROUTES = [
  processAssignmentOccurrence,
  assignmentOccurrencesList,
] as const;
export const OCCURRENCE_EVENTS = [assignmentScheduleAdvanced] as const;
// Schedule 산술·enabled Operator·unfinished Run·현재 revision/last_due_at CAS,
// 재전송·원자 Run 접수·회차 기록·last_due_at 이동은 owner runtime의 책임이다.
