import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  assignmentRecordSchema,
  operatorApprovalBundleSchema,
  outputDeclarationSchema,
  pauseReasonSchema,
  scheduleSchema,
} from "./assignment-values.ts";
import {
  applyOperatorAssignment,
  ASSIGNMENT_EVENTS,
  ASSIGNMENT_ROUTES,
  assignmentOutputs,
  assignmentRead,
  changeAssignmentPreset,
  changeAssignmentPresetCompareSchema,
  changeAssignmentPresetInputSchema,
  createAppEngineerAssignment,
  createBuiltinAssignment,
  createBuiltinAssignmentInputSchema,
  pauseAssignment,
  pauseAssignmentInputSchema,
  withdrawAssignment,
  withdrawAssignmentCompareSchema,
} from "./assignments.ts";
import { OperatorOutput } from "./instructions.ts";

const asg = "asg_01arz3ndektsv4rrffq69g5fav";
const pst = "pst_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const doc = "doc_01arz3ndektsv4rrffq69g5fav";
const ver = "ver_01arz3ndektsv4rrffq69g5fav";
const apr = "apr_01arz3ndektsv4rrffq69g5fav";
const run = "run_01arz3ndektsv4rrffq69g5fav";
const hash = "cd".repeat(32);

const builtin = {
  id: asg,
  role: "lophn",
  preset: pst,
  preset_revision: 1,
  scope: { kind: "all", id: null },
  outputs: [],
  read_apps: [],
  read_commands: [],
  schedule: null,
  approval: null,
  state: "enabled",
  pause_reason: null,
  last_due_at: null,
  revision: 1,
};

const bundle = {
  draft_version: ver,
  assignment: null,
  expected_assignment_revision: null,
  preset: pst,
  preset_revision: 2,
  preset_definition: hash,
  scope: { kind: "app", id: app },
  outputs: [{ document: doc, content: "weekly status" }],
  read_apps: [app],
  read_commands: [{ app, command: "status" }],
  schedule: { first_at: "2026-10-06T00:00:00.000Z", every_ms: 86_400_000 },
  reason: "start the weekly review",
};

Deno.test("lophn-agent/assignments#R2: ten assignment routes and five assignment events", () => {
  assertEquals(ASSIGNMENT_ROUTES.map(routePath), [
    "/v1/assignments/create-builtin",
    "/v1/assignments/create-app-engineer",
    "/v1/assignments/apply-operator",
    "/v1/assignments/change-preset",
    "/v1/assignments/pause",
    "/v1/assignments/resume",
    "/v1/assignments/withdraw",
    "/v1/assignments/read",
    "/v1/assignments/list",
    "/v1/assignments/outputs",
  ]);
  assertEquals(ASSIGNMENT_EVENTS.map((event) => event.type), [
    "AssignmentCreated",
    "AssignmentChanged",
    "AssignmentPaused",
    "AssignmentResumed",
    "AssignmentWithdrawn",
  ]);
  assertEquals(createBuiltinAssignment.actors, ["machine"]);
  assertEquals(createAppEngineerAssignment.actors, ["machine"]);
  for (const route of ASSIGNMENT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
  assert(assignmentRecordSchema.safeParse(builtin).success);
  assert(
    assignmentRecordSchema.safeParse({
      ...builtin,
      role: "app_engineer",
      scope: { kind: "app", id: app },
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R4: applying an operator pairs the approval with the assignment read", () => {
  assertEquals(applyOperatorAssignment.actors, ["machine"]);
  assertEquals(applyOperatorAssignment.confirmation, "required");
  assertEquals(applyOperatorAssignment.binding, [
    "approval",
    "decision_seq",
    "bundle",
  ]);
  assertEquals(applyOperatorAssignment.display_read, "/v1/assignments/read");
  assert(
    operatorApprovalBundleSchema.safeParse(bundle).success,
  );
  assert(
    !operatorApprovalBundleSchema.safeParse({
      ...bundle,
      preset_definition: pst,
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R5: a changed bundle field or a mismatched previous revision is rejected", () => {
  assert(
    !operatorApprovalBundleSchema.safeParse({
      ...bundle,
      assignment: asg,
      expected_assignment_revision: null,
    }).success,
  );
  assert(
    !operatorApprovalBundleSchema.safeParse({ ...bundle, extra_tool: "shell" })
      .success,
  );
  assert(
    !operatorApprovalBundleSchema.safeParse({
      ...bundle,
      scope: { kind: "all", id: null },
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R6: an operator output names an existing document and a judgment", () => {
  assert(
    outputDeclarationSchema.safeParse({ document: doc, content: "status" })
      .success,
  );
  assert(
    !outputDeclarationSchema.safeParse({ document: doc, content: "  " })
      .success,
  );
  assert(
    !outputDeclarationSchema.safeParse({
      document: "ser_01arz3ndektsv4rrffq69g5fav",
      content: "status",
    }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({
      ...builtin,
      role: "operator",
      scope: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
      outputs: [],
      schedule: bundle.schedule,
      approval: apr,
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R9: withdraw compares an open state and builtin scope stays all", () => {
  assert(
    withdrawAssignmentCompareSchema.safeParse({ revision: 4, state: "paused" })
      .success,
  );
  assert(
    !withdrawAssignmentCompareSchema.safeParse({
      revision: 4,
      state: "withdrawn",
    }).success,
  );
  assertEquals(withdrawAssignment.actors, ["user"]);
  assert(
    !createBuiltinAssignmentInputSchema.safeParse({
      id: asg,
      preset: pst,
      preset_revision: 1,
      role: "lophn",
      scope: { kind: "app", id: app },
    }).success,
  );
  assert(
    !createBuiltinAssignmentInputSchema.safeParse({
      id: asg,
      preset: pst,
      preset_revision: 1,
      role: "operator",
      scope: { kind: "all", id: null },
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R10: a machine pause carries exactly three failed runs", () => {
  const runs = [
    run,
    "run_01arz3ndektsv4rrffq69g5faw",
    "run_01arz3ndektsv4rrffq69g5fax",
  ];
  assert(
    pauseReasonSchema.safeParse({
      kind: "consecutive_failures",
      detail: "three failed runs",
      runs,
      target: null,
    }).success,
  );
  assert(
    !pauseReasonSchema.safeParse({
      kind: "consecutive_failures",
      detail: "two",
      runs: runs.slice(0, 2),
      target: null,
    }).success,
  );
  assert(
    pauseAssignmentInputSchema.safeParse({
      assignment: asg,
      reason: {
        kind: "user",
        detail: "hold",
        runs: [],
        target: null,
      },
    }).success,
  );
  assertEquals(pauseAssignment.actors, ["user", "machine"]);
  assert(
    !pauseAssignmentInputSchema.safeParse({
      assignment: asg,
      reason: { kind: "user", detail: "hold", runs: [], target: null },
      actor: "machine",
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R16: read keeps enabled, paused and withdrawn apart from a run", () => {
  assert(
    assignmentRead.output.safeParse({
      assignment: {
        ...builtin,
        state: "paused",
        pause_reason: {
          kind: "user",
          detail: "hold",
          runs: [],
          target: null,
        },
        revision: 2,
      },
      as_of_seq: "8",
      next_cursor: null,
    }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({ ...builtin, state: "running" }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({
      ...builtin,
      state: "paused",
      pause_reason: null,
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R17: changing a preset compares the current revision and same-kind role", () => {
  assert(
    changeAssignmentPresetInputSchema.safeParse({
      assignment: asg,
      preset: pst,
      preset_revision: 4,
    }).success,
  );
  assert(
    changeAssignmentPresetCompareSchema.safeParse({
      revision: 3,
      role: "context_engineer",
    }).success,
  );
  assert(
    !changeAssignmentPresetCompareSchema.safeParse({
      revision: 3,
      role: "operator",
    }).success,
  );
  assertEquals(changeAssignmentPreset.actors, ["user"]);
  assert(
    !changeAssignmentPresetInputSchema.safeParse({
      assignment: "pst_01arz3ndektsv4rrffq69g5fav",
      preset: pst,
      preset_revision: 4,
    }).success,
  );
});

Deno.test("lophn-agent/scheduling#R1: a schedule is operator-only and has no default interval", () => {
  assert(
    scheduleSchema.safeParse({
      first_at: "2026-10-06T00:00:00.000Z",
      every_ms: 1,
    }).success,
  );
  assert(
    !scheduleSchema.safeParse({
      first_at: "2026-10-06T00:00:00.000Z",
      every_ms: 0,
    }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({
      ...builtin,
      schedule: bundle.schedule,
    }).success,
  );
});

Deno.test("lophn-agent/scheduling#R3: an interval is a positive millisecond count in UTC", () => {
  assert(
    !scheduleSchema.safeParse({
      first_at: "2026-10-06T00:00:00.000Z",
      every_ms: -1,
      cron: "0 * * * *",
    }).success,
  );
  assert(
    !scheduleSchema.safeParse({
      first_at: "2026-10-06 00:00",
      every_ms: 1000,
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R8: operator approval pins the preset hash, not a credential secret", () => {
  assert(
    !operatorApprovalBundleSchema.safeParse({
      ...bundle,
      credentials: ["raw-token"],
    }).success,
  );
});

Deno.test("lophn-agent/harness/tools#R10: agent is not an actor of apply or change", () => {
  assert(!applyOperatorAssignment.actors.includes("agent"));
  assert(!changeAssignmentPreset.actors.includes("agent"));
  assert(!createBuiltinAssignment.actors.includes("agent"));
});

Deno.test("lophn-agent/roles/context-engineer#R12: outputs read returns the owning operator or none", () => {
  assertEquals(routePath(assignmentOutputs), "/v1/assignments/outputs");
  assert(
    assignmentOutputs.output.safeParse({
      output: { assignment: asg, revision: 2, state: "paused" },
      as_of_seq: "3",
      next_cursor: null,
    }).success,
  );
  assert(
    assignmentOutputs.output.safeParse({
      output: null,
      as_of_seq: "3",
      next_cursor: null,
    }).success,
  );
  assert(
    !assignmentOutputs.input.safeParse({ document: doc, assignment: asg })
      .success,
  );
  assert(OperatorOutput.name === "OperatorOutput");
});
