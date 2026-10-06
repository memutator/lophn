import { ROLE_CAPS } from "../../presets/mod.ts";
import { OPTION_ACTION_OPERATIONS } from "../../questions/mod.ts";
import { BUILTIN_TOOLS, runOperations } from "../tools/mod.ts";
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
  messageBody,
  messagesList,
  modelCallList,
  modelDefaultsRead,
  presetRead,
  processAssignmentOccurrence,
  providerRead,
  questionRead,
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
  applyApprovedAction,
  approvalsGet,
  approvalsList,
  approvalsText,
  cancelApprovalRequest,
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
  cancelQuestion,
  applyQuestionOption,
  processAssignmentOccurrence,
] as const;

// machine credential이 가져야 하는 operation 이름이다. 사람이 고른 선택지의 고정 action을 적용하는
// 소유 command의 operation도 더한다: 소유 command의 대상 권한은 바깥 요청 자격의 scope로 판정된다
// (questions#R13). 이 목록이 core가 runtime에 주는 machine credential의 scope 기준이다.
export const RUNTIME_MACHINE_OPERATIONS: readonly string[] = [
  ...new Set([
    ...RUNTIME_MACHINE_ROUTES.map((route) => route.name),
    ...OPTION_ACTION_OPERATIONS,
  ]),
];

// 역할이 닿을 수 있는 operation의 상한. 역할 tool 상한(ROLE_CAPS)의 소유 contract와 보조 operation이다.
// runtime은 run마다 이 안에서 agent credential을 청하고, core는 같은 상한으로 요청을 대조한다.
export function roleOperations(role: string): readonly string[] {
  const cap = ROLE_CAPS.get(role);
  if (cap === undefined) return [];
  const names = new Set(cap.tools);
  return runOperations(BUILTIN_TOOLS.filter((tool) => names.has(tool.name)));
}
