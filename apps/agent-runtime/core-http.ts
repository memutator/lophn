import { err, ok, type Result } from "../../packages/base/mod.ts";
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
  presetRead,
  processAssignmentOccurrence,
  questionRead,
  recordMessage,
  recordToolRequest,
  resolveRunWait,
  runList,
  runRead,
  sessionRead,
  startModelCall,
  startRun,
  startToolCall,
  toolCallList,
  toolCallRead,
  waitRun,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { OPTION_ACTION_OPERATIONS } from "../../packages/lophn-agent/questions/mod.ts";
import {
  applyApprovedAction,
  approvalsGet,
  approvalsList,
  approvalsText,
  cancelApprovalRequest,
  eventsList,
  routePath,
  settingsGet,
} from "../../packages/contracts/platform/mod.ts";
import type { CoreCall } from "./core-call.ts";

// runtime이 core loopback을 부르는 길이다. machine 자격은 아래 route만 열고 목록에 없는 경로는
// 요청하지 않는다. run의 agent 자격은 core가 그 credential의 scope로 막으므로 경로를 고르지 않는다.

export const RUNTIME_MACHINE_ROUTES = [
  eventsList,
  runList,
  runRead,
  assignmentList,
  assignmentRead,
  presetRead,
  sessionRead,
  settingsGet,
  startRun,
  checkpointRun,
  finishRun,
  waitRun,
  resolveRunWait,
  correctWaitingRun,
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

const MACHINE_PATHS: ReadonlySet<string> = new Set(
  RUNTIME_MACHINE_ROUTES.map((route) => routePath(route)),
);

type Fetch = typeof fetch;

async function post(
  fetchImpl: Fetch,
  port: number,
  token: string,
  path: string,
  body: unknown,
): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return err({ code: "unavailable", message: "core is not reachable" });
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return err({ code: "unavailable", message: "unexpected core reply" });
  }
  if (response.status === 200) return ok(parsed);
  const error = (parsed as {
    error?: {
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
    };
  })
    .error;
  return err({
    code: (error?.code ?? "internal") as "internal",
    message: error?.message ?? "core error",
    ...(error?.details === undefined ? {} : { details: error.details }),
  });
}

export function machineCall(options: {
  port: number;
  // 호출 시점의 사용 허가를 가진 credential. 없으면 요청하지 않는다.
  credential(): string | undefined;
  fetch?: Fetch;
}): CoreCall {
  return (path, body) => {
    if (!MACHINE_PATHS.has(path)) {
      return Promise.resolve(
        err({ code: "invalid_input", message: "route is not open" }),
      );
    }
    const token = options.credential();
    if (!token) {
      return Promise.resolve(
        err({ code: "unauthorized", message: "credential is not usable" }),
      );
    }
    return post(options.fetch ?? fetch, options.port, token, path, body);
  };
}

export function agentCall(options: {
  port: number;
  token: string;
  fetch?: Fetch;
}): CoreCall {
  return (path, body) =>
    post(options.fetch ?? fetch, options.port, options.token, path, body);
}
