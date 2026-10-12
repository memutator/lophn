import { APP_COMMAND_EXPOSURE, ROLE_CAPS } from "../../agents/mod.ts";
import { OPTION_ACTION_OPERATIONS } from "../../questions/mod.ts";
import {
  APP_TOOL_CONTRACT,
  BUILTIN_TOOLS,
  CONTEXT_ENTITY_CONTRACT,
  CONTEXT_ENTITY_TOOL,
  CONTEXT_SEARCH_CONTRACT,
  runOperations,
} from "../tools/mod.ts";
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  contextOverviewRoute,
  glossaryListRoute,
} from "../../../protocol/projects/mod.ts";
import { EXTERNAL_TOOL_CONTRACT } from "../../extensions/mod.ts";
import {
  agentsRead,
  applyQuestionOption,
  assignmentList,
  assignmentRead,
  cancelQuestionGroup,
  checkpointRun,
  compactSession,
  correctWaitingRun,
  decideToolCall,
  failSessionCompact,
  finishModelCall,
  finishRewindSummary,
  finishRun,
  finishToolCall,
  instructionRead,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
  messageBody,
  messagesList,
  modelCallList,
  modelDefaultsRead,
  placeAgentSettingsRead,
  providerRead,
  questionRead,
  questionText,
  recordMessage,
  recordToolRequest,
  recoverRun,
  resolveRunWait,
  rewindList,
  runBody,
  runList,
  runRead,
  sessionCompactRequests,
  sessionRead,
  sessionSummary,
  startModelCall,
  startRun,
  startToolCall,
  stopRun,
  takeRewindSummaryRequest,
  toolCallList,
  toolCallRead,
  waitRun,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  appAgentConfirmProof,
  appBlueprint,
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
  eventsList,
  settingsGet,
} from "../../../protocol/platform/mod.ts";

// agent runtime이 core loopback을 부르는 길이다. machine 자격은 아래 route만 열고 목록에 없는 경로는
// 요청하지 않는다. run의 agent 자격은 core가 그 credential의 scope로 막으므로 경로를 고르지 않는다.
// core(발급 상한과 hello의 machine credential)와 runtime(열린 route)이 같은 목록을 쓰도록 이 package에 둔다.

export const RUNTIME_MACHINE_ROUTES = [
  eventsList,
  runList,
  runRead,
  assignmentList,
  assignmentRead,
  agentsRead,
  placeAgentSettingsRead,
  providerRead,
  modelDefaultsRead,
  sessionRead,
  // 사람이 요청한 Compact를 끝낸다: 열린 요청을 읽고, 앞 구간의 요약 본문을 읽고, 요약 call을 잇거나 요청을 닫는다.
  sessionCompactRequests,
  sessionSummary,
  // 숨기거나 접은 구간은 이후 call의 입력에 들지 않는다: 되돌리기 기록에서 그 구간을 읽는다(prompt-assemble#R31).
  rewindList,
  compactSession,
  failSessionCompact,
  settingsGet,
  // 사람 지침(LOPHN.md) 확정 판. 매 model call 직전에 다시 읽는다(instructions R5, R8).
  instructionRead,
  startRun,
  checkpointRun,
  finishRun,
  waitRun,
  resolveRunWait,
  correctWaitingRun,
  recoverRun,
  runBody,
  stopRun,
  startModelCall,
  finishModelCall,
  modelCallList,
  messagesList,
  messageBody,
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
  // MCP OAuth 발급자 호출을 core 대신 보낸다(extensions R16, R17): core에는 외부 fetch가 없다.
  mcpAuthRequestTake,
  mcpAuthRequestDone,
  // "Summarize from here"의 요약 요청을 가져가고 끝난 요약 call을 돌려준다(revert R15).
  takeRewindSummaryRequest,
  finishRewindSummary,
  // run 준비가 resolved agent의 층(자리의 active context)과 선언 검색 tool의 정의 재료(고른 context의 적용된 판:
  // 계약·검색)를 run을 시작하기 전에 읽는다(lophn-agent/harness/tools#R21).
  contextListRoute,
  contextGetRoute,
  contextContractRoute,
  // 앱 command tool의 정의 재료(선언·허락)와 결과 조회(invocation 기록)를 읽는다.
  appBlueprint,
  grantsList,
  invocationsList,
  // confirm 재검사의 프로세스 nonce. agent credential은 run이 running일 때만 있다.
  appRuntime,
  // 이미 접수된 agent confirm의 서명 proof. 적용은 apply_approved_action이고 서명은 core가 한다.
  appAgentConfirmProof,
] as const;

// machine credential이 가져야 하는 operation 이름이다. 사람이 고른 선택지의 고정 action을 적용하는
// 소유 command의 operation도 더한다: 소유 command의 대상 권한은 바깥 요청 자격의 scope로 판정된다
// (questions#R13). 이 목록이 core가 runtime에 주는 machine credential의 scope 기준이다.
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

// 외부 MCP tool이 쓰는 operation이다(T37). 소유 contract와, 미분류·쓰기·external 호출이 사람에게
// 묻는 approval request 생성이다(R28). 요청자는 이 run의 agent 자격과 같아야 한다.
export const EXTERNAL_TOOL_OPERATIONS: readonly string[] = [
  EXTERNAL_TOOL_CONTRACT,
  createApprovalRequest.name,
];

// prompt의 context 자료(overview·용어집)를 run을 시작할 때 읽는 route의 operation이다. run의 agent 자격으로
// 읽으므로 모든 역할의 상한에 읽기로만 더한다(prompt-assemble#R4, presets#R17). 앱 하나에 묶인 agent가 어느
// context를 보는지는 core가 정한다(roles/app-engineer#R2).
const CONTEXT_MATERIAL_READS: readonly string[] = [
  contextListRoute.name,
  contextGetRoute.name,
  contextContractRoute.name,
  contextOverviewRoute.name,
  glossaryListRoute.name,
];

// 역할이 닿을 수 있는 operation의 상한. 역할 tool 상한(ROLE_CAPS)의 소유 contract와 보조 operation이다.
// runtime은 run마다 이 안에서 agent credential을 청하고, core는 같은 상한으로 요청을 대조한다.
export function roleOperations(role: string): readonly string[] {
  const cap = ROLE_CAPS.get(role);
  if (cap === undefined) return [];
  const names = new Set(cap.tools);
  // context 읽기다. 선언 검색 tool(origin context)은 이름이 동적이라 상한 이름에 없고, 개체 읽기를 가진 역할이
  // 선택한 context의 검색과 개체를 읽는다(harness/tools#R21, R22).
  const contextRead = names.has(CONTEXT_ENTITY_TOOL)
    ? [CONTEXT_SEARCH_CONTRACT, CONTEXT_ENTITY_CONTRACT]
    : [];
  const own = [
    ...runOperations(BUILTIN_TOOLS.filter((tool) => names.has(tool.name))),
    ...contextRead,
    ...CONTEXT_MATERIAL_READS,
  ];
  // 외부 MCP tool의 소유 contract다(T37). 확장 선택은 상한 항목이 아니라 preset의
  // 선택 항목이라(presets role-caps R5) 상한 이름에 넣지 않고 contract만 더한다.
  // run이 실제로 제공하는 external 정의는 runOperations(listed)가 더한다.
  // 앱 command를 실행하는 역할은 앱 통로(`app.connect`)를 더한다. 범위는 StartRun이 고정한 AgentAppScope가 정한다.
  // 역할 tool이 소유한 operation과 겹치는 것(조회 tool의 context 읽기, 승인 요청)은 한 번만 둔다.
  return [
    ...new Set(
      APP_COMMAND_EXPOSURE.get(role)?.execution === "none"
        ? [...own, ...EXTERNAL_TOOL_OPERATIONS]
        : [...own, APP_TOOL_CONTRACT, ...EXTERNAL_TOOL_OPERATIONS],
    ),
  ];
}
