import { SESSION_COMMANDS } from "./sessions.ts";
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
import { skillsRead } from "./skill-settings.ts";
import { TURN_COMMANDS } from "./turns.ts";
import { TURN_READS } from "./turn-reads.ts";
import { AGENT_CALL_ROUTES } from "./calls.ts";
import { TEAM_ROUTES } from "./team.ts";
import {
  QUEUED_INPUT_ROUTES,
  recordShellMessage,
  sendMessage,
} from "./inputs.ts";
import { HARNESS_HOST_ROUTES } from "./harness-host.ts";
import { HOST_QUEUE_MEMORY_ROUTES } from "./host-queue.ts";
import { LOGIN_REQUEST_ROUTES } from "./login-request.ts";
import { EXTENSION_TOOL_ROUTES } from "./extension-tools.ts";
import { ASK_ROUTES } from "./ask-tool.ts";
import { MESSAGE_IMAGE_ROUTES } from "./message-images.ts";
import { RECEIVED_MESSAGE_ROUTES } from "./received-messages.ts";
import { messageSearch } from "./message-search.ts";
import { AGENT_ROUTES } from "./agent-definitions.ts";
import { connectProvider } from "./providers.ts";
import {
  EXTENSION_ROUTES,
  mcpAuthBegin,
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
  ...TURN_COMMANDS,
  ...TURN_READS,
  ...AGENT_CALL_ROUTES,
  ...TEAM_ROUTES,
  sendMessage,
  recordShellMessage,
  ...QUEUED_INPUT_ROUTES,
  ...ASK_ROUTES,
  // shell main의 harness host가 부르는 memory route와 그것이 쓰는 machine command다.
  ...HARNESS_HOST_ROUTES,
  // core 메모리 host queue: shell main이 가져가는 host/*와 agent의 tabs/*, browser/read.
  ...HOST_QUEUE_MEMORY_ROUTES,
  // 사람에게 login 저장·한 번 넣기를 요청하는 agent 입구와, card·보호 창이 부르는 route.
  ...LOGIN_REQUEST_ROUTES,
  // shell extension의 tool: shell main이 올리는 목록과 agent의 호출 입구.
  ...EXTENSION_TOOL_ROUTES,
  ...MESSAGE_IMAGE_ROUTES,
  ...RECEIVED_MESSAGE_ROUTES,
  messageSearch,
  ...AGENT_ROUTES,
  connectProvider,
  // MCP OAuth의 시작·완료·상태·취소 입구다. ledger queue를 거치지 않는
  // memory route다.
  mcpAuthBegin,
  mcpAuthComplete,
  mcpAuthState,
  mcpAuthCancel,
  // runtime이 OAuth 발급자 호출(MCP, provider)을 대신 보내는 machine 입구다.
  issuerRequestTake,
  issuerRequestDone,
  // Grants 화면의 MCP tool 목록 읽기와 runtime이 그 요청을 가져가 답하는 machine 입구다.
  mcpToolsList,
  mcpToolsRequestTake,
  mcpToolsRequestDone,
] as const;
