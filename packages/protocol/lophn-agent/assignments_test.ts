import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import {
  assignmentRecordSchema,
  pauseReasonSchema,
} from "./assignment-values.ts";
import {
  ASSIGNMENT_EVENTS,
  ASSIGNMENT_ROUTES,
  assignmentRead,
  createAppEngineerAssignment,
  createAppEngineerAssignmentInputSchema,
  createBuiltinAssignment,
  createBuiltinAssignmentInputSchema,
  createOperatorAssignment,
  createOperatorAssignmentInputSchema,
  pauseAssignment,
  pauseAssignmentInputSchema,
  resumeAssignment,
  resumeAssignmentCompareSchema,
  withdrawAssignment,
  withdrawAssignmentCompareSchema,
} from "./assignments.ts";

const asg = "asg_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const prj = "prj_01arz3ndektsv4rrffq69g5fav";

const builtin = {
  id: asg,
  role: "lophn",
  scope: { kind: "all", id: null },
  state: "enabled",
  pause_reason: null,
  revision: 1,
};

const archived = (target: string) => ({
  kind: "scope_archived",
  detail: "The place was archived.",
  target,
});

Deno.test("lophn-agent/assignments#R2 [agent-R12]: eight assignment routes and four assignment events, with every removed route and event gone", () => {
  assertEquals(ASSIGNMENT_ROUTES.map(routePath), [
    "/v1/assignments/create-builtin",
    "/v1/assignments/create-app-engineer",
    "/v1/assignments/create-operator",
    "/v1/assignments/pause",
    "/v1/assignments/resume",
    "/v1/assignments/withdraw",
    "/v1/assignments/read",
    "/v1/assignments/list",
  ]);
  assertEquals(ASSIGNMENT_EVENTS.map((event) => event.type), [
    "AssignmentCreated",
    "AssignmentPaused",
    "AssignmentResumed",
    "AssignmentWithdrawn",
  ]);
  for (const route of ASSIGNMENT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("lophn-agent/assignments#R3 [agent-R12]: a record has identity, role, scope, state, pause reason and revision only", () => {
  assert(assignmentRecordSchema.safeParse(builtin).success);
  assert(
    assignmentRecordSchema.safeParse({
      ...builtin,
      role: "app_engineer",
      scope: { kind: "app", id: app },
    }).success,
  );
  // 설정 칸은 더 이상 읽히지 않는 값이라 record가 싣지 않는다.
  assertEquals(
    Object.keys(assignmentRecordSchema.parse({ ...builtin, preset: "x" })),
    ["id", "role", "scope", "state", "pause_reason", "revision"],
  );
  // 역할과 자리가 맞아야 한다: lophn은 all만, App Engineer는 app만.
  assert(
    !assignmentRecordSchema.safeParse({
      ...builtin,
      scope: { kind: "app", id: app },
    }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({
      ...builtin,
      role: "app_engineer",
      scope: { kind: "all", id: null },
    }).success,
  );
  // 멈춤 근거는 paused일 때만 있다.
  assert(
    assignmentRecordSchema.safeParse({
      ...builtin,
      scope: { kind: "app", id: app },
      role: "operator",
      state: "paused",
      pause_reason: archived(app),
    }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({ ...builtin, state: "paused" }).success,
  );
  assert(
    !assignmentRecordSchema.safeParse({
      ...builtin,
      pause_reason: archived(app),
    }).success,
  );
  assertEquals(assignmentRead.actors, [
    "user",
    "agent",
    "machine",
    "coding_agent",
  ]);
});

Deno.test("lophn-agent/assignments#R4 [agent-R12]: only a person creates an Operator assignment, in a project or app and without any preset", () => {
  assertEquals(createOperatorAssignment.actors, ["user"]);
  assert(
    createOperatorAssignmentInputSchema.safeParse({
      id: asg,
      scope: { kind: "project", id: prj },
    }).success,
  );
  assert(
    createOperatorAssignmentInputSchema.safeParse({
      id: asg,
      scope: { kind: "app", id: app },
    }).success,
  );
  assert(
    !createOperatorAssignmentInputSchema.safeParse({
      id: asg,
      scope: { kind: "all", id: null },
    }).success,
  );
  assert(
    !createOperatorAssignmentInputSchema.safeParse({
      id: asg,
      scope: { kind: "app", id: prj },
    }).success,
  );
  assert(
    !createOperatorAssignmentInputSchema.safeParse({
      id: asg,
      scope: { kind: "app", id: app },
      preset: "pst_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R2 [agent-R12]: built-in and App Engineer creation are machine only and take no preset", () => {
  assertEquals(createBuiltinAssignment.actors, ["machine"]);
  assertEquals(createAppEngineerAssignment.actors, ["machine"]);
  assert(
    createBuiltinAssignmentInputSchema.safeParse({
      id: asg,
      role: "context_engineer",
      scope: { kind: "all", id: null },
    }).success,
  );
  assert(
    !createBuiltinAssignmentInputSchema.safeParse({
      id: asg,
      role: "lophn",
      scope: { kind: "app", id: app },
    }).success,
  );
  assert(
    !createBuiltinAssignmentInputSchema.safeParse({
      id: asg,
      role: "lophn",
      scope: { kind: "all", id: null },
      preset: "pst_01arz3ndektsv4rrffq69g5fav",
      preset_revision: 1,
    }).success,
  );
  assert(
    createAppEngineerAssignmentInputSchema.safeParse({
      id: asg,
      app_created_seq: "12",
      app,
    }).success,
  );
  assert(
    !createAppEngineerAssignmentInputSchema.safeParse({
      id: asg,
      app_created_seq: "12",
      app,
      preset: "pst_01arz3ndektsv4rrffq69g5fav",
      preset_revision: 1,
    }).success,
  );
  assert(
    !createAppEngineerAssignmentInputSchema.safeParse({
      id: asg,
      app_created_seq: "12",
      app: prj,
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R9 [agent-R12]: withdraw is a person's and compares an open state", () => {
  assertEquals(withdrawAssignment.actors, ["user"]);
  assert(
    withdrawAssignmentCompareSchema.safeParse({
      revision: 2,
      state: "paused",
    }).success,
  );
  assert(
    !withdrawAssignmentCompareSchema.safeParse({
      revision: 2,
      state: "withdrawn",
    }).success,
  );
});

Deno.test("lophn-agent/assignments#R14 [agent-R12]: pause and resume are the machine's, pause carries only a scope_archived reason", () => {
  assertEquals(pauseAssignment.actors, ["machine"]);
  assertEquals(resumeAssignment.actors, ["machine"]);
  assert(pauseReasonSchema.safeParse(archived(app)).success);
  assert(pauseReasonSchema.safeParse(archived(prj)).success);
  // scope_archived 밖의 kind와 run·target 없는 모양은 없다.
  for (const kind of ["user", "other"]) {
    assert(!pauseReasonSchema.safeParse({ ...archived(app), kind }).success);
  }
  assert(
    !pauseReasonSchema.safeParse({ ...archived(app), runs: [] }).success,
  );
  assert(
    !pauseReasonSchema.safeParse({ ...archived(app), target: null }).success,
  );
  assert(
    pauseAssignmentInputSchema.safeParse({
      assignment: asg,
      reason: archived(app),
    }).success,
  );
  assert(
    resumeAssignmentCompareSchema.safeParse({ revision: 3, state: "paused" })
      .success,
  );
  assert(
    !resumeAssignmentCompareSchema.safeParse({ revision: 3, state: "enabled" })
      .success,
  );
});
