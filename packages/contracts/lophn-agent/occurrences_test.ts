import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  assignmentOccurrencesList,
  assignmentOccurrencesListInputSchema,
  assignmentOccurrencesListOutputSchema,
  assignmentScheduleAdvanced,
  OCCURRENCE_EVENTS,
  OCCURRENCE_ROUTES,
  processAssignmentOccurrence,
  processAssignmentOccurrenceCompareSchema,
  processAssignmentOccurrenceInputSchema,
  scheduleOccurrenceSchema,
} from "./occurrences.ts";
import { asg, at, later, latest, run, run2 } from "./message-fixtures.ts";

const missedNone = {
  due_at: later,
  missed_first_at: null,
  missed_last_at: null,
  missed_count: 0,
};

const accepted = {
  assignment: asg,
  assignment_revision: 2,
  previous_due_at: at,
  ...missedNone,
  outcome: "accepted",
  run,
  skip_reason: null,
  blocking_runs: [],
};

Deno.test("lophn-agent/scheduling#R1: occurrence process and list stay machine-owned routes", () => {
  assertEquals(OCCURRENCE_ROUTES.map(routePath), [
    "/v1/assignment-occurrences/process",
    "/v1/assignment-occurrences/list",
  ]);
  assertEquals(OCCURRENCE_EVENTS.map((event) => event.type), [
    "AssignmentScheduleAdvanced",
  ]);
  assertEquals(processAssignmentOccurrence.actors, ["machine"]);
  assertEquals(assignmentOccurrencesList.actors, ["user", "agent", "machine"]);
  assert(!assignmentOccurrencesList.errors.includes("conflict"));
  for (const route of OCCURRENCE_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assertEquals(assignmentScheduleAdvanced.subject.safeParse(asg).success, true);
  assert(!assignmentScheduleAdvanced.subject.safeParse("asg").success);
});

Deno.test("lophn-agent/scheduling#R4: accepted and skipped values do not mix", () => {
  assert(scheduleOccurrenceSchema.safeParse(accepted).success);
  assert(
    scheduleOccurrenceSchema.safeParse({
      ...accepted,
      outcome: "skipped",
      run: null,
      skip_reason: "unfinished_run",
      blocking_runs: [run, run2],
    }).success,
  );
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...accepted,
      outcome: "skipped",
      skip_reason: "unfinished_run",
      blocking_runs: [run],
    }).success,
  );
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...accepted,
      run: null,
    }).success,
  );
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...accepted,
      blocking_runs: [run, run],
      outcome: "skipped",
      run: null,
      skip_reason: "unfinished_run",
    }).success,
  );
  assert(
    assignmentScheduleAdvanced.payload.safeParse({
      ...accepted,
      observed: true,
    }).success,
  );
  assert(
    !processAssignmentOccurrenceInputSchema.safeParse({
      assignment: asg,
      ...missedNone,
      enabled: true,
    }).success,
  );
});

Deno.test("lophn-agent/scheduling#R5: a skip names unfinished blockers and no new run", () => {
  const skipped = {
    ...accepted,
    outcome: "skipped",
    run: null,
    skip_reason: "unfinished_run",
    blocking_runs: [run],
  };
  assert(scheduleOccurrenceSchema.safeParse(skipped).success);
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...skipped,
      blocking_runs: [],
    }).success,
  );
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...skipped,
      skip_reason: null,
    }).success,
  );
  assert(
    processAssignmentOccurrenceCompareSchema.safeParse({
      assignment_revision: 2,
      previous_due_at: at,
    }).success,
  );
  assert(
    !processAssignmentOccurrenceCompareSchema.safeParse({
      assignment_revision: 0,
      previous_due_at: null,
    }).success,
  );
});

Deno.test("lophn-agent/scheduling#R6: missed range is zero or previous < first <= last < due", () => {
  assert(
    processAssignmentOccurrenceInputSchema.safeParse({
      assignment: asg,
      ...missedNone,
    }).success,
  );
  assert(
    processAssignmentOccurrenceInputSchema.safeParse({
      assignment: asg,
      due_at: latest,
      missed_first_at: at,
      missed_last_at: later,
      missed_count: 9,
    }).success,
  );
  assert(
    !processAssignmentOccurrenceInputSchema.safeParse({
      assignment: asg,
      ...missedNone,
      missed_count: 9,
    }).success,
  );
  assert(
    !processAssignmentOccurrenceInputSchema.safeParse({
      assignment: asg,
      due_at: later,
      missed_first_at: later,
      missed_last_at: later,
      missed_count: 1,
    }).success,
  );
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...accepted,
      previous_due_at: later,
      missed_first_at: at,
      missed_last_at: at,
      missed_count: 1,
    }).success,
  );
  assert(
    !scheduleOccurrenceSchema.safeParse({
      ...accepted,
      previous_due_at: latest,
    }).success,
  );
});

Deno.test("lophn-agent/scheduling#R7: list keeps revision number and due order inside as_of", () => {
  assert(
    assignmentOccurrencesListInputSchema.safeParse({
      assignment: asg,
      assignment_revision: 2,
      after_due_at: at,
      through_due_at: latest,
    }).success,
  );
  assert(
    !assignmentOccurrencesListInputSchema.safeParse({
      assignment: asg,
      assignment_revision: "2",
    }).success,
  );
  assert(
    !assignmentOccurrencesListInputSchema.safeParse({
      assignment: asg,
      after_due_at: later,
      through_due_at: later,
    }).success,
  );
  const row = { occurrence: accepted, event_seq: "3" };
  for (const invalid of ["bad", "01", "-1", "1.5", ""]) {
    assert(
      !assignmentOccurrencesListOutputSchema.safeParse({
        as_of_seq: invalid,
        next_cursor: null,
        occurrences: [row],
      }).success,
    );
    assert(
      !assignmentOccurrencesListOutputSchema.safeParse({
        as_of_seq: "4",
        next_cursor: null,
        occurrences: [{ ...row, event_seq: invalid }],
      }).success,
    );
  }
  assert(
    assignmentOccurrencesListOutputSchema.safeParse({
      as_of_seq: "4",
      next_cursor: "next",
      occurrences: [row, {
        occurrence: { ...accepted, due_at: latest, assignment_revision: 3 },
        event_seq: "4",
      }],
    }).success,
  );
  assert(
    !assignmentOccurrencesListOutputSchema.safeParse({
      as_of_seq: "4",
      next_cursor: null,
      occurrences: [row, row],
    }).success,
  );
  assert(
    !assignmentOccurrencesListOutputSchema.safeParse({
      as_of_seq: "2",
      next_cursor: null,
      occurrences: [row],
    }).success,
  );
});
