import { SESSION_COMMANDS } from "./sessions.ts";
import { APP_CALL_ROUTES } from "./app-calls.ts";
import { SESSION_LIFECYCLE_ROUTES } from "./session-lifecycle.ts";
import { SESSION_STATUS_ROUTES } from "./session-status.ts";
import { WORKSPACE_SESSION_ROUTES } from "./agent-sessions.ts";
import { MESSAGE_ROUTES, messagesList } from "./messages.ts";
import { REVERT_ROUTES } from "./reverts.ts";
import { sessionRewind, sessionRewindPreview } from "./session-rewinds.ts";
import { COMMAND_ROUTES } from "./commands.ts";
import { MODEL_CALL_ROUTES } from "./model-calls.ts";
import { MODEL_ROUTES } from "./models.ts";
import { PROVIDER_ROUTES } from "./providers.ts";
import { TOOL_CALL_ROUTES } from "./tool-calls.ts";
import { TRACE_ROUTES } from "./traces.ts";
import { INSTRUCTION_ROUTES } from "./instructions.ts";
import { skillsCheck, skillsList, skillsRead } from "./skill-settings.ts";
import { TURN_COMMANDS } from "./turns.ts";
import { TURN_READS } from "./turn-reads.ts";
import { AGENT_CALL_ROUTES } from "./calls.ts";
import { MAIL_HOLD_ROUTES, MAIL_ROUTES } from "./mail.ts";
import { HANDOFF_ROUTES } from "./handoff.ts";
import { TEAM_ROUTES } from "./team.ts";
import {
  QUEUED_INPUT_ROUTES,
  recordShellMessage,
  sendMessage,
} from "./inputs.ts";
import { HARNESS_HOST_ROUTES } from "./harness-host.ts";
import { HOST_QUEUE_MEMORY_ROUTES } from "./host-queue.ts";
import { TERMINAL_USE_ROUTES } from "./terminal-use.ts";
import {
  INPUT_REQUEST_ROUTES,
  inputRequestAnswerSecret,
} from "./input-request.ts";
import { ASK_ROUTES } from "./ask-tool.ts";
import { FOLLOW_UP_ROUTES } from "./follow-ups.ts";
import { MESSAGE_IMAGE_ROUTES } from "./message-images.ts";
import { RECEIVED_MESSAGE_ROUTES } from "./received-messages.ts";
import { messageSearch } from "./message-search.ts";
import { AGENT_ROUTES } from "./agent-definitions.ts";
import { connectProvider, providerConnectKey } from "./providers.ts";
import {
  EXTENSION_ROUTES,
  mcpAuthBegin,
  mcpAuthCallback,
  mcpAuthCancel,
  mcpAuthComplete,
  mcpAuthState,
  mcpToolsList,
  mcpToolsRequestDone,
  mcpToolsRequestTake,
} from "./mcp-settings.ts";
import { issuerRequestDone, issuerRequestTake } from "./issuer-requests.ts";

export const ROUTES = [
  ...SESSION_COMMANDS,
  ...SESSION_STATUS_ROUTES,
  ...SESSION_LIFECYCLE_ROUTES,
  ...APP_CALL_ROUTES,
  ...WORKSPACE_SESSION_ROUTES,
  ...MESSAGE_ROUTES.filter((route) => route !== messagesList),
  ...REVERT_ROUTES,
  sessionRewind,
  sessionRewindPreview,
  ...COMMAND_ROUTES,
  ...PROVIDER_ROUTES,
  ...MODEL_CALL_ROUTES,
  ...MODEL_ROUTES,
  ...TOOL_CALL_ROUTES,
  ...TRACE_ROUTES,
  ...INSTRUCTION_ROUTES,
  ...EXTENSION_ROUTES,
  skillsRead,
  skillsList,
  skillsCheck,
  ...TURN_COMMANDS,
  ...TURN_READS,
  ...AGENT_CALL_ROUTES,
  // 기계 사이 mail: agent가 다른 컴퓨터로 보내는 입구와 다른 컴퓨터의 core가 넘기는 입구.
  ...MAIL_ROUTES,
  ...MAIL_HOLD_ROUTES,
  // handoff note: session이 남기는 입구와 이 컴퓨터의 사람이 다른 컴퓨터의 note를 읽는 입구.
  ...HANDOFF_ROUTES,
  ...TEAM_ROUTES,
  ...FOLLOW_UP_ROUTES,
  sendMessage,
  recordShellMessage,
  ...QUEUED_INPUT_ROUTES,
  ...ASK_ROUTES,
  // core 안 extension host의 harness extension이 부르는 memory route와 그것이 쓰는 machine command다.
  ...HARNESS_HOST_ROUTES,
  // core 메모리 host queue를 agent와 사람에게 여는 tabs/*, browser/*, terminal/*.
  ...HOST_QUEUE_MEMORY_ROUTES,
  ...TERMINAL_USE_ROUTES,
  // 사람에게 login 저장·한 번 넣기를 요청하는 agent 입구와, card·보호 창이 부르는 route.
  ...INPUT_REQUEST_ROUTES,
  inputRequestAnswerSecret,
  ...MESSAGE_IMAGE_ROUTES,
  ...RECEIVED_MESSAGE_ROUTES,
  messageSearch,
  ...AGENT_ROUTES,
  connectProvider,
  providerConnectKey,
  // MCP OAuth의 시작·완료·상태·취소 입구다. ledger queue를 거치지 않는
  // memory route다.
  mcpAuthBegin,
  mcpAuthComplete,
  mcpAuthState,
  mcpAuthCallback,
  mcpAuthCancel,
  // runtime이 OAuth 발급자 호출(MCP, provider)을 대신 보내는 machine 입구다.
  issuerRequestTake,
  issuerRequestDone,
  // Grants 화면의 MCP tool 목록 읽기와 runtime이 그 요청을 가져가 답하는 machine 입구다.
  mcpToolsList,
  mcpToolsRequestTake,
  mcpToolsRequestDone,
] as const;
