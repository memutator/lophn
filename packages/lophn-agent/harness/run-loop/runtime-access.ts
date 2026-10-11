import { APP_COMMAND_EXPOSURE, ROLE_CAPS } from "../../presets/mod.ts";
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
} from "../../../contracts/documents/mod.ts";
import { EXTERNAL_TOOL_CONTRACT } from "../../extensions/mod.ts";
import {
  applyQuestionOption,
  assignmentList,
  assignmentRead,
  cancelQuestion,
  checkpointRun,
  correctWaitingRun,
  decideToolCall,
  finishModelCall,
  finishRun,
  finishToolCall,
  instructionRead,
  messageBody,
  messagesList,
  modelCallList,
  modelDefaultsRead,
  presetRead,
  processAssignmentOccurrence,
  providerRead,
  questionRead,
  questionText,
  recordMessage,
  recordToolRequest,
  recoverRun,
  resolveRunWait,
  runBody,
  runList,
  runRead,
  sessionRead,
  startModelCall,
  startRun,
  startToolCall,
  stopRun,
  toolCallList,
  toolCallRead,
  waitRun,
} from "../../../contracts/lophn-agent/mod.ts";
import {
  appAgentConfirmProof,
  appBlueprint,
  appRuntime,
  grantsList,
  invocationAcceptConfirm,
  invocationsList,
} from "../../../contracts/apps/mod.ts";
import {
  applyApprovedAction,
  approvalsGet,
  approvalsList,
  approvalsText,
  cancelApprovalRequest,
  createApprovalRequest,
  eventsList,
  settingsGet,
} from "../../../contracts/platform/mod.ts";

// agent runtime이 core loopback을 부르는 길이다. machine 자격은 아래 route만 열고 목록에 없는 경로는
// 요청하지 않는다. run의 agent 자격은 core가 그 credential의 scope로 막으므로 경로를 고르지 않는다.
// core(발급 상한과 hello의 machine credential)와 runtime(열린 route)이 같은 목록을 쓰도록 이 package에 둔다.

export const RUNTIME_MACHINE_ROUTES = [
  eventsList,
  runList,
  runRead,
  assignmentList,
  assignmentRead,
  presetRead,
  providerRead,
  modelDefaultsRead,
  sessionRead,
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
  cancelQuestion,
  applyQuestionOption,
  processAssignmentOccurrence,
  // 선언 검색 tool의 정의 재료다. 고른 context의 적용된 판(계약·검색)을 run을 시작하기 전에 읽는다
  // (lophn-agent/harness/tools#R21).
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
  ];
  // 외부 MCP tool의 소유 contract다(T37). 확장 선택은 상한 항목이 아니라 preset의
  // 선택 항목이라(presets role-caps R5) 상한 이름에 넣지 않고 contract만 더한다.
  // run이 실제로 제공하는 external 정의는 runOperations(listed)가 더한다.
  // 앱 command를 실행하는 역할은 앱 통로(`app.connect`)를 더한다. 범위는 StartRun이 고정한 AgentAppScope가 정한다.
  return APP_COMMAND_EXPOSURE.get(role)?.execution === "none"
    ? [...own, ...EXTERNAL_TOOL_OPERATIONS]
    : [...own, APP_TOOL_CONTRACT, ...EXTERNAL_TOOL_OPERATIONS];
}
