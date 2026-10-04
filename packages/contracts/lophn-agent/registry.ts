import { RUN_COMMANDS, RUN_EVENTS } from "./runs.ts";
import { SESSION_COMMANDS, SESSION_EVENTS } from "./sessions.ts";
import { MESSAGE_EVENTS, MESSAGE_ROUTES } from "./messages.ts";
import { OCCURRENCE_EVENTS, OCCURRENCE_ROUTES } from "./occurrences.ts";
import { QUESTION_COMMANDS, QUESTION_EVENTS } from "./questions.ts";
import { HANDOFF_ROUTES } from "./handoffs.ts";
import { REVERT_EVENTS, REVERT_ROUTES } from "./reverts.ts";
import { PRESET_EVENTS, PRESET_ROUTES } from "./presets.ts";
import { ASSIGNMENT_EVENTS, ASSIGNMENT_ROUTES } from "./assignments.ts";
import { TOOL_CALL_EVENTS, TOOL_CALL_ROUTES } from "./tool-calls.ts";
import { TRACE_ROUTES } from "./traces.ts";

export const ROUTES = [
  ...RUN_COMMANDS,
  ...SESSION_COMMANDS,
  ...MESSAGE_ROUTES,
  ...OCCURRENCE_ROUTES,
  ...QUESTION_COMMANDS,
  ...HANDOFF_ROUTES,
  ...REVERT_ROUTES,
  ...PRESET_ROUTES,
  ...ASSIGNMENT_ROUTES,
  ...TOOL_CALL_ROUTES,
  ...TRACE_ROUTES,
] as const;

export const EVENTS = [
  ...RUN_EVENTS,
  ...SESSION_EVENTS,
  ...MESSAGE_EVENTS,
  ...OCCURRENCE_EVENTS,
  ...QUESTION_EVENTS,
  ...REVERT_EVENTS,
  ...PRESET_EVENTS,
  ...ASSIGNMENT_EVENTS,
  ...TOOL_CALL_EVENTS,
] as const;
