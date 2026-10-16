import { RUN_COMMANDS, RUN_EVENTS } from "./runs.ts";
import {
  closeSession,
  openSession,
  SESSION_COMMANDS,
  SESSION_EVENTS,
  sessionList,
  unarchiveSession,
} from "./sessions.ts";
import { AGENT_SESSION_ROUTES } from "./agent-sessions.ts";
import { MESSAGE_EVENTS, MESSAGE_ROUTES, messagesList } from "./messages.ts";
import { QUESTION_COMMANDS, QUESTION_EVENTS } from "./questions.ts";
import { REVERT_EVENTS, REVERT_ROUTES } from "./reverts.ts";
import { AGENT_EVENTS, AGENT_ROUTES } from "./agents.ts";
import { COMMAND_ROUTES } from "./commands.ts";
import { MODEL_CALL_EVENTS, MODEL_CALL_ROUTES } from "./model-calls.ts";
import { MODEL_EVENTS, MODEL_ROUTES } from "./models.ts";
import { PROVIDER_EVENTS, PROVIDER_ROUTES } from "./providers.ts";
import { TOOL_CALL_EVENTS, TOOL_CALL_ROUTES } from "./tool-calls.ts";
import { TRACE_ROUTES } from "./traces.ts";
import { INSTRUCTION_ROUTES } from "./instructions.ts";
import { skillsRead } from "./skill-settings.ts";
import { TURN_COMMANDS } from "./turns.ts";
import { TURN_READS } from "./turn-reads.ts";
import { CALL_ROUTES } from "./calls.ts";
import { QUEUED_INPUT_ROUTES, sendMessage } from "./inputs.ts";
import { ASK_ROUTES } from "./ask-tool.ts";
import { RECEIVED_MESSAGE_ROUTES } from "./received-messages.ts";
import { AGENT_DEFINITION_ROUTES } from "./agent-definitions.ts";
import { connectProvider } from "./providers.ts";
import {
  EXTENSION_ROUTES,
  mcpAuthBegin,
  mcpAuthCancel,
  mcpAuthComplete,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
  mcpAuthState,
} from "./mcp-settings.ts";

export const ROUTES = [
  ...RUN_COMMANDS,
  // 옛 session·message route 가운데 새 route로 바뀐 것은 뺀다.
  ...SESSION_COMMANDS.filter((route) =>
    !([
      openSession,
      sessionList,
      closeSession,
      unarchiveSession,
    ] as readonly unknown[])
      .includes(route)
  ),
  ...AGENT_SESSION_ROUTES,
  ...MESSAGE_ROUTES.filter((route) => route !== messagesList),
  ...QUESTION_COMMANDS,
  ...REVERT_ROUTES,
  ...AGENT_ROUTES,
  ...COMMAND_ROUTES,
  ...PROVIDER_ROUTES,
  ...MODEL_CALL_ROUTES,
  ...MODEL_ROUTES,
  ...TOOL_CALL_ROUTES,
  ...TRACE_ROUTES,
  ...INSTRUCTION_ROUTES,
  ...EXTENSION_ROUTES,
  skillsRead,
  ...TURN_COMMANDS,
  ...TURN_READS,
  ...CALL_ROUTES,
  sendMessage,
  ...QUEUED_INPUT_ROUTES,
  ...ASK_ROUTES,
  ...RECEIVED_MESSAGE_ROUTES,
  ...AGENT_DEFINITION_ROUTES,
  connectProvider,
  // MCP OAuth의 시작·완료·상태·취소 입구다. ledger queue를 거치지 않는
  // memory route다.
  mcpAuthBegin,
  mcpAuthComplete,
  mcpAuthState,
  mcpAuthCancel,
  // runtime이 발급자 호출을 대신 보내는 machine 입구다.
  mcpAuthRequestTake,
  mcpAuthRequestDone,
] as const;

export const EVENTS = [
  ...RUN_EVENTS,
  ...SESSION_EVENTS,
  ...MESSAGE_EVENTS,
  ...QUESTION_EVENTS,
  ...REVERT_EVENTS,
  ...AGENT_EVENTS,
  ...PROVIDER_EVENTS,
  ...MODEL_EVENTS,
  ...MODEL_CALL_EVENTS,
  ...TOOL_CALL_EVENTS,
] as const;
