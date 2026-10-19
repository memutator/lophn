import { APP_TOOL_CONTRACT } from "../tools/mod.ts";
import { EXTERNAL_TOOL_CONTRACT } from "../extensions/mod.ts";
import {
  agentDefinitionRead,
  agentSessionRead,
  checkpointTurn,
  compactSession,
  decideToolCall,
  failSessionCompact,
  finishModelCall,
  finishRewindSummary,
  finishToolCall,
  finishTurn,
  instructionsGet,
  issuerRequestDone,
  issuerRequestTake,
  mcpToolsRequestDone,
  mcpToolsRequestTake,
  messageBody,
  messagesList,
  modelCallList,
  modelDefaultRead,
  projectModelRead,
  providerList,
  providerRead,
  receivedMessageList,
  recordMessage,
  recordToolRequest,
  rewindList,
  sessionCompactRequests,
  sessionSummary,
  startModelCall,
  startToolCall,
  startTurn,
  takeRewindSummaryRequest,
  toolCallList,
  toolCallRead,
  turnBody,
  turnList,
  turnRead,
  userModelInfoRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { domainList } from "../../../protocol/domains/mod.ts";
import { appGet, appRuntime } from "../../../protocol/apps/mod.ts";
import {
  agentGrantsGet,
  applyApprovedAction,
  approvalsGet,
  approvalsList,
  approvalsText,
  cancelApprovalRequest,
  createApprovalRequest,
  toolGateCheck,
} from "../../../protocol/approvals/mod.ts";
import { appTools } from "../../../protocol/apps/blueprint/read.ts";
import { eventsList } from "../../../protocol/events/mod.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import { askWait } from "../../../protocol/lophn-agent/ask-tool.ts";

// agent runtime이 core loopback을 부르는 길이다. machine 자격은 아래 route만 열고 목록에 없는 경로는
// 요청하지 않는다. turn의 agent 자격은 core가 그 credential의 scope로 막으므로 경로를 고르지 않는다.
// core(발급 상한과 hello의 machine credential)와 runtime(열린 route)이 같은 목록을 쓰도록 이 package에 둔다.

export const RUNTIME_MACHINE_ROUTES = [
  eventsList,
  providerList,
  turnList,
  turnRead,
  agentDefinitionRead,
  providerRead,
  // 사람이 적은 custom model 정보(catalog user 층). model resolver가 turn마다 읽는다.
  userModelInfoRead,
  modelDefaultRead,
  // project 층 model. 전역 기본 → project → agent 정의 → session 순으로 쌓는다.
  projectModelRead,
  agentSessionRead,
  // 사람이 요청한 Compact를 끝낸다: 열린 요청을 읽고, 앞 구간의 요약 본문을 읽고, 요약 call을 잇거나 요청을 닫는다.
  sessionCompactRequests,
  sessionSummary,
  // 숨기거나 접은 구간은 이후 call의 입력에 들지 않는다: 되돌리기 기록에서 그 구간을 읽는다.
  rewindList,
  compactSession,
  failSessionCompact,
  settingsList,
  // 사람 지침(LOPHN.md)과 agent 지침. turn을 시작할 때 층마다 한 번 읽는다.
  instructionsGet,
  startTurn,
  checkpointTurn,
  finishTurn,
  turnBody,
  startModelCall,
  finishModelCall,
  modelCallList,
  messagesList,
  messageBody,
  // 이 session이 받은 메시지. turn이 이전 대화를 읽는다.
  receivedMessageList,
  recordMessage,
  recordToolRequest,
  decideToolCall,
  startToolCall,
  finishToolCall,
  toolCallRead,
  toolCallList,
  approvalsGet,
  approvalsList,
  approvalsText,
  applyApprovedAction,
  cancelApprovalRequest,
  // OAuth 발급자 호출(MCP, provider)을 core 대신 보낸다: core에는 외부 fetch가 없다.
  issuerRequestTake,
  issuerRequestDone,
  // Grants의 MCP tool 목록을 core 대신 서버에 연결해 읽는다: MCP 연결은 runtime의 몫이다.
  mcpToolsRequestTake,
  mcpToolsRequestDone,
  // "Summarize from here"의 요약 요청을 가져가고 끝난 요약 call을 돌려준다.
  takeRewindSummaryRequest,
  finishRewindSummary,
  // tool의 정의 재료(활성 release 선언과 agent grant)와 앱의 domain(다른 domain의 비공개 tool 거르기)을 읽는다.
  // domain 읽기는 turn을 시작할 때 맡은 domain의 이름과 purpose, skill 발견과 tool 목록이 쓴다.
  appTools,
  appGet,
  agentGrantsGet,
  domainList,
  // confirm 재검사의 프로세스 nonce. agent credential은 turn이 running일 때만 있다.
  appRuntime,
] as const;

// machine credential이 가져야 하는 operation 이름이다.
// 이 목록이 core가 runtime에 주는 machine credential의 scope 기준이다.
export const RUNTIME_MACHINE_OPERATIONS: readonly string[] = [
  ...new Set(RUNTIME_MACHINE_ROUTES.map((route) => route.name)),
];

// 외부 MCP tool이 쓰는 operation이다. 소유 contract와, 미분류·쓰기·external 호출이 사람에게
// 묻는 approval request 생성이다. 요청자는 이 turn의 agent 자격과 같아야 한다.
export const EXTERNAL_TOOL_OPERATIONS: readonly string[] = [
  EXTERNAL_TOOL_CONTRACT,
  createApprovalRequest.name,
];

// Gate가 걸리는 tool과 `ask`가 사람의 결정을 기다리는 입구다. 기다림은 core가 쥐고 호출 하나가 결과가 날 때까지 열려 있다.
// 사람이 답하는 입구가 아니라 turn의 agent 자격이 묻는 쪽이므로 모든 역할의 상한에 더한다.
const HUMAN_WAIT_ROUTES: readonly string[] = [toolGateCheck.name, askWait.name];

// 어느 역할이든 상한에 드는 operation이다. 앱 command 통로(`app.connect`)는 범위를 agent grant와 tool 목록이
// 정하고, 외부 MCP tool과 사람 결정 기다림은 turn의 agent 자격이 부른다. 역할 몫은 role 층이 더한다.
export const AGENT_BASE_OPERATIONS: readonly string[] = [
  APP_TOOL_CONTRACT,
  ...EXTERNAL_TOOL_OPERATIONS,
  ...HUMAN_WAIT_ROUTES,
];
