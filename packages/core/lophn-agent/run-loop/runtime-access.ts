import { OPTION_ACTION_OPERATIONS } from "../tools/questions/mod.ts";
import {
  APP_TOOL_CONTRACT,
  CONTEXT_ENTITY_CONTRACT,
  CONTEXT_SEARCH_CONTRACT,
  listRoleTools,
  runOperations,
} from "../tools/mod.ts";
import { type Role, ROLES } from "../../../protocol/lophn-agent/mod.ts";
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  glossaryListRoute,
  projectApi,
} from "../../../protocol/projects/mod.ts";
import { EXTERNAL_TOOL_CONTRACT } from "../extensions/mod.ts";
import {
  agentDefinitionRead,
  agentSessionRead,
  applyQuestionOption,
  callSendable,
  cancelQuestionGroup,
  checkpointTurn,
  compactSession,
  decideToolCall,
  failSessionCompact,
  finishModelCall,
  finishRewindSummary,
  finishToolCall,
  finishTurn,
  instructionsGet,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
  messageBody,
  messagesList,
  modelCallList,
  modelDefaultRead,
  projectModelRead,
  providerList,
  providerRead,
  questionRead,
  questionText,
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
} from "../../../protocol/lophn-agent/mod.ts";
import {
  appAgentConfirmProof,
  appBlueprint,
  appGet,
  appList,
  appRuntime,
  grantsList,
  invocationAcceptConfirm,
  invocationsList,
} from "../../../protocol/apps/mod.ts";
import {
  applyApprovedAction,
  approvalsGet,
  approvalsList,
  approvalsText,
  cancelApprovalRequest,
  createApprovalRequest,
} from "../../../protocol/approvals/mod.ts";
import { appAppApi } from "../../../protocol/apps/blueprint/read.ts";
import { eventsList } from "../../../protocol/events/mod.ts";
import { settingsGet } from "../../../protocol/config/mod.ts";

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
  settingsGet,
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
  questionRead,
  questionText,
  cancelQuestionGroup,
  applyQuestionOption,
  // MCP OAuth 발급자 호출을 core 대신 보낸다: core에는 외부 fetch가 없다.
  mcpAuthRequestTake,
  mcpAuthRequestDone,
  // "Summarize from here"의 요약 요청을 가져가고 끝난 요약 call을 돌려준다.
  takeRewindSummaryRequest,
  finishRewindSummary,
  // turn 준비가 resolved agent의 층(자리의 active context)과 선언 검색 tool의 정의 재료(고른 context의 적용된 판:
  // 계약·검색)를 turn을 시작하기 전에 읽는다.
  contextListRoute,
  contextGetRoute,
  contextContractRoute,
  // 앱 command tool의 정의 재료(선언·허락)와 결과 조회(invocation 기록)를 읽는다.
  appBlueprint,
  grantsList,
  invocationsList,
  // confirm 재검사의 프로세스 nonce. agent credential은 turn이 running일 때만 있다.
  appRuntime,
  // 이미 접수된 agent confirm의 서명 proof. 적용은 apply_approved_action이고 서명은 core가 한다.
  appAgentConfirmProof,
] as const;

// machine credential이 가져야 하는 operation 이름이다. 사람이 고른 선택지의 고정 action을 적용하는
// 소유 command의 operation도 더한다: 소유 command의 대상 권한은 바깥 요청 자격의 scope로 판정된다.
// 이 목록이 core가 runtime에 주는 machine credential의 scope 기준이다.
export const RUNTIME_MACHINE_OPERATIONS: readonly string[] = [
  ...new Set([
    ...RUNTIME_MACHINE_ROUTES.map((route) => route.name),
    ...OPTION_ACTION_OPERATIONS,
    // 접수 command는 apply의 안쪽 tx.call이다. 권한은 바깥 machine 자격의 scope로
    // 다시 검사하므로 이 operation이 있어야 이미 허락된 confirm이 접수된다.
    // HTTP route에는 넣지 않는다. 직접 호출은 dispatch 전용이라 거절된다.
    invocationAcceptConfirm.name,
  ]),
];

// 외부 MCP tool이 쓰는 operation이다. 소유 contract와, 미분류·쓰기·external 호출이 사람에게
// 묻는 approval request 생성이다. 요청자는 이 turn의 agent 자격과 같아야 한다.
export const EXTERNAL_TOOL_OPERATIONS: readonly string[] = [
  EXTERNAL_TOOL_CONTRACT,
  createApprovalRequest.name,
];

// prompt의 place 정보(project·앱·context 글·부를 수 있는 agent)를 읽는 route의 operation이다. turn의 agent
// 자격으로 읽으므로 모든 역할의 상한에 읽기로만 더한다. 어느 대상을 보는지는 core가 credential의 scope로 정한다.
const PLACE_READS: readonly string[] = [
  contextListRoute.name,
  contextGetRoute.name,
  contextContractRoute.name,
  glossaryListRoute.name,
  projectApi.get.name,
  projectApi.list.name,
  appGet.name,
  appList.name,
  appAppApi.name,
  callSendable.name,
];

function isRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

// 역할이 닿을 수 있는 operation의 상한. 역할이 고정한 tool 목록의 소유 contract와 보조 operation이다.
// runtime은 turn마다 이 안에서 agent credential을 청하고, core는 같은 상한으로 요청을 대조한다.
// 앱 command 통로(`app.connect`)는 어느 역할이든 닿을 수 있다: 범위는 agent grant와 tool 목록이 정한다.
export function roleOperations(role: string): readonly string[] {
  if (!isRole(role)) return [];
  return [
    ...new Set([
      ...runOperations(listRoleTools(role, { input_media: ["image"] })),
      // 선택한 context의 선언 검색과 개체 읽기다. 이름이 동적이라 tool 이름에 없다.
      CONTEXT_SEARCH_CONTRACT,
      CONTEXT_ENTITY_CONTRACT,
      ...PLACE_READS,
      APP_TOOL_CONTRACT,
      ...EXTERNAL_TOOL_OPERATIONS,
    ]),
  ];
}
