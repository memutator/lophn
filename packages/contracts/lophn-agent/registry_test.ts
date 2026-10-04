import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { ALL_EVENTS, ALL_ROUTES, lophnAgent } from "../mod.ts";
import { routePath } from "../platform/mod.ts";
import { EVENTS, ROUTES } from "./mod.ts";

Deno.test("lophn-agent/harness/run-loop#R2: public entry registers the exact run conversation and occurrence routes", () => {
  assertEquals(ROUTES.map(routePath), [
    "/v1/runs/accept",
    "/v1/runs/start",
    "/v1/runs/checkpoint",
    "/v1/runs/finish",
    "/v1/runs/stop",
    "/v1/runs/confirm-next",
    "/v1/runs/wait",
    "/v1/runs/resolve-wait",
    "/v1/runs/correct-waiting",
    "/v1/runs/recover",
    "/v1/runs/read",
    "/v1/runs/list",
    "/v1/runs/result",
    "/v1/sessions/open",
    "/v1/sessions/change-work-place",
    "/v1/sessions/close",
    "/v1/sessions/read",
    "/v1/sessions/list",
    "/v1/messages/receive",
    "/v1/messages/execute-stored",
    "/v1/messages/record",
    "/v1/messages/apply",
    "/v1/messages/assign",
    "/v1/messages/list",
    "/v1/assignment-occurrences/process",
    "/v1/assignment-occurrences/list",
    "/v1/questions/create",
    "/v1/questions/answer",
    "/v1/questions/defer",
    "/v1/questions/cancel",
    "/v1/questions/expire",
    "/v1/questions/apply-option",
    "/v1/questions/read",
    "/v1/questions/list",
    "/v1/handoffs/submit",
    "/v1/handoffs/status",
    "/v1/handoffs/result",
    "/v1/reverts/checkpoint",
    "/v1/reverts/finish",
    "/v1/reverts/apply",
    "/v1/reverts/preview",
    "/v1/reverts/list",
    "/v1/presets/register-default",
    "/v1/presets/create",
    "/v1/presets/revise",
    "/v1/presets/read",
    "/v1/presets/list",
    "/v1/presets/instruction-attachments",
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
  assertEquals(lophnAgent.ROUTES, ROUTES);
  for (const route of ROUTES) {
    assert(ALL_ROUTES.includes(route));
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assert(!route.errors.includes("internal"));
  }
});

Deno.test("lophn-agent/harness/run-loop#R6: public events omit checkpoint and confirm-next events", () => {
  assertEquals(EVENTS.map((event) => event.type), [
    "RunAccepted",
    "RunStarted",
    "RunWaited",
    "RunResumed",
    "RunRecovered",
    "RunFinished",
    "SessionOpened",
    "SessionWorkPlaceChanged",
    "SessionClosed",
    "MessageReceived",
    "MessageRecorded",
    "MessageApplied",
    "MessageAssigned",
    "AssignmentScheduleAdvanced",
    "QuestionCreated",
    "QuestionAnswered",
    "QuestionExpired",
    "QuestionCancelled",
    "RevertStarted",
    "RevertApplied",
    "RevertBlocked",
    "RevertFinished",
    "PresetCreated",
    "PresetRevised",
    "AssignmentCreated",
    "AssignmentChanged",
    "AssignmentPaused",
    "AssignmentResumed",
    "AssignmentWithdrawn",
  ]);
  assertEquals(lophnAgent.EVENTS, EVENTS);
  for (const event of EVENTS) assert(ALL_EVENTS.includes(event));
});
