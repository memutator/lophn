import type { ToolResult } from "../../../contracts/lophn-agent/mod.ts";
import type {
  ToolAttempt,
  ToolCallRequest,
  ToolDone,
  ToolInfo,
  ToolPort,
} from "./ports.ts";
import {
  TOOL_RETRY_MAX,
  toolFailureRetryable,
  toolMayRetry,
  toolRetryDelayMs,
} from "./retry.ts";

// 한 model 응답의 tool 묶음 처리(requirements lophn-agent/harness/run-loop R12, R13, R15).
// 모든 call이 읽기로 확인된 묶음만 병렬이고 그 밖에는 요청 순서로 하나씩 한다. 결과는 언제나 요청
// 순서다. 없는 tool·잘못된 인자는 인자를 고치지 않고 call별 결과로 돌려준다.

export type ModelToolCall = { id: string; name: string; args: string };

export type CallResult = {
  key: string;
  order: number;
  name: string;
  // 요청한 입력 그대로다. 해석할 수 없었으면 원문 글이다.
  input: unknown;
  // 기록한 ToolCall ID. 중단 요청에 답하지 않아 모를 때만 null이다.
  tool_call: string | null;
  status: ToolDone["status"];
  code: string;
  result: ToolResult;
  // 실제 진입 횟수. 미실행이면 0이다.
  entries: number;
};

export type BatchOutcome = {
  results: CallResult[];
  // 사람의 결정을 기다리는 call. 있으면 run은 그 결정 전까지 진행하지 않는다.
  waiting: { tool_call: string; approval: string } | null;
};

// 새 진입을 막아야 하는 이유(미실행 code). 없으면 null이다.
// server는 외부 MCP tool의 서버 이름이고 내장·앱 tool이면 null이다.
export type Gate = (server: string | null) => Promise<string | null>;

export type BatchControl = {
  tools: ToolPort;
  modelCall: string;
  gate: Gate;
  // 이 tool 진입의 중단 신호. 멈춤·한도·MCP 서버 연결 제거에 중단된다. release는 끝난 뒤 부른다.
  signalFor(server: string | null): { signal: AbortSignal; release(): void };
  wait(ms: number, signal: AbortSignal): Promise<"elapsed" | "aborted">;
  random(): number;
  graceMs: number;
};

const REASON_TEXT: Readonly<Record<string, string>> = {
  stopped: "The person stopped this work before the call started.",
  superseded: "A new instruction arrived before the call started.",
  limit_reached: "A run limit was reached before the call started.",
  configuration_revoked:
    "The provider or connection was turned off before the call started.",
  waiting_for_decision:
    "An earlier call is waiting for a person's decision, so this call did not start.",
  earlier_call_failed:
    "An earlier call did not complete, so this call did not start.",
};

export function notExecutedText(code: string): string {
  return REASON_TEXT[code] ?? "The call did not start.";
}

export function synthesizedResult(
  status: "failure" | "not_executed" | "uncertain",
  summary: string,
): ToolResult {
  return {
    status,
    summary,
    content: null,
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

// 인자는 JSON 객체여야 한다. 비어 있으면 인자 없는 호출이다(adapter가 같은 규칙으로 완성을
// 확인한다). 그 밖의 것은 고치지 않고 원문을 그대로 둔다.
function parseArgs(
  args: string,
): { ok: true; value: unknown } | { ok: false } {
  if (args.trim().length === 0) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(args);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return { ok: true, value };
    }
  } catch {
    // 해석할 수 없는 인자는 아래에서 잘못된 인자로 닫는다.
  }
  return { ok: false };
}

// 호출자가 abort를 요청한 뒤 grace 안에 돌아오지 않으면 기다리지 않는다. 늦은 결과는 감사 기록만
// 보완한다(R16).
export async function awaitAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  control: {
    wait(ms: number, signal: AbortSignal): Promise<"elapsed" | "aborted">;
    graceMs: number;
  },
): Promise<{ done: true; value: T } | { done: false }> {
  const finished = new AbortController();
  let onAbort: (() => void) | undefined;
  const abandoned = new Promise<{ done: false }>((resolve) => {
    onAbort = () => {
      void control.wait(control.graceMs, finished.signal).then((how) => {
        if (how === "elapsed") resolve({ done: false });
      });
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      promise.then((value) => ({ done: true as const, value })),
      abandoned,
    ]);
  } finally {
    finished.abort();
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

function toResult(
  request: ToolCallRequest,
  done: ToolDone,
  entries: number,
): CallResult {
  return {
    key: request.key,
    order: request.order,
    name: request.name,
    input: request.input,
    tool_call: done.tool_call,
    status: done.status,
    code: done.code,
    result: done.result,
    entries,
  };
}

export async function runToolBatch(
  control: BatchControl,
  calls: readonly ModelToolCall[],
): Promise<BatchOutcome> {
  const requests: ToolCallRequest[] = calls.map((call, order) => {
    const parsed = parseArgs(call.args);
    return {
      model_call: control.modelCall,
      key: call.id,
      order,
      name: call.name,
      input: parsed.ok ? parsed.value : call.args,
      attempt: 0,
      retry_of: null,
    };
  });
  const infos = requests.map((request) => control.tools.info(request.name));
  const valid = calls.map((call) => parseArgs(call.args).ok);
  const hold: { waiting: BatchOutcome["waiting"] } = { waiting: null };

  async function notExecuted(
    request: ToolCallRequest,
    code: string,
  ): Promise<CallResult> {
    const done = await control.tools.close(request, {
      status: "not_executed",
      code,
      summary: notExecutedText(code),
    });
    return toResult(request, done, 0);
  }

  async function entered(
    request: ToolCallRequest,
    info: ToolInfo,
  ): Promise<CallResult> {
    let entries = 0;
    async function once(next: ToolCallRequest): Promise<ToolAttempt | null> {
      entries += 1;
      const link = control.signalFor(info.server);
      try {
        const settled = await awaitAbortable(
          control.tools.attempt(next, link.signal),
          link.signal,
          control,
        );
        return settled.done ? settled.value : null;
      } finally {
        link.release();
      }
    }
    function unconfirmed(): CallResult {
      return {
        key: request.key,
        order: request.order,
        name: request.name,
        input: request.input,
        tool_call: null,
        status: "uncertain",
        code: "abort_unconfirmed",
        result: synthesizedResult(
          "uncertain",
          "The call did not answer after it was asked to stop; its outcome is not confirmed.",
        ),
        entries,
      };
    }
    let current = await once(request);
    if (current === null) return unconfirmed();
    let retries = 0;
    while (
      current.kind === "done" && toolMayRetry(info) &&
      toolFailureRetryable(current) && retries < TOOL_RETRY_MAX
    ) {
      // 다음 진입 전에 대기와 멈춤·새 입력·한도를 다시 본다(R24). 매 진입은 판정을 다시 한다.
      const link = control.signalFor(info.server);
      let how: "elapsed" | "aborted";
      try {
        how = await control.wait(
          toolRetryDelayMs(control.random),
          link.signal,
        );
      } finally {
        link.release();
      }
      if (how === "aborted" || await control.gate(info.server) !== null) break;
      retries += 1;
      const next = await once({
        ...request,
        attempt: 1,
        retry_of: current.tool_call,
      });
      if (next === null) return unconfirmed();
      current = next;
    }
    if (current.kind === "waiting") {
      hold.waiting = {
        tool_call: current.tool_call,
        approval: current.approval,
      };
      return {
        key: request.key,
        order: request.order,
        name: request.name,
        input: request.input,
        tool_call: current.tool_call,
        status: "not_executed",
        code: "waiting_for_decision",
        result: current.result,
        entries,
      };
    }
    return toResult(request, current, entries);
  }

  // 시작 직전에 멈춤·한도·설정 회수·새 입력을 다시 본다(R9, R10, R15, R25). 막히면 미실행이다.
  async function one(index: number, hold_: string | null): Promise<CallResult> {
    const request = requests[index];
    const info = infos[index];
    const blocked = (await control.gate(info?.server ?? null)) ?? hold_;
    if (blocked !== null) return await notExecuted(request, blocked);
    if (info === undefined) {
      return toResult(
        request,
        await control.tools.close(request, {
          status: "failure",
          code: "not_found",
          summary: "tool is not available",
        }),
        0,
      );
    }
    if (!valid[index]) {
      return toResult(
        request,
        await control.tools.close(request, {
          status: "failure",
          code: "invalid_input",
          summary: "tool arguments are not a JSON object",
        }),
        0,
      );
    }
    return await entered(request, info);
  }

  const parallel = infos.length > 0 &&
    infos.every((info) => info?.effect === "read");
  if (parallel) {
    // 완료 순서와 관계없이 요청 순서로 모은다.
    const results = await Promise.all(
      requests.map((_, index) => one(index, null)),
    );
    return { results, waiting: hold.waiting };
  }

  const results: CallResult[] = [];
  let skip: string | null = null;
  for (let index = 0; index < requests.length; index++) {
    const result = await one(index, skip);
    results.push(result);
    if (hold.waiting !== null) {
      skip = "waiting_for_decision";
      continue;
    }
    // 쓰기·external이 거절되거나 최종 실패·불명확이면 나머지는 시작하지 않는다. 읽기와 없는 tool의
    // 실패는 뒤 동작을 막지 않는다(R13).
    const effect = infos[index]?.effect;
    if (
      skip === null && effect !== undefined && effect !== "read" &&
      result.status !== "success" &&
      (result.entries > 0 || result.status === "failure")
    ) {
      skip = "earlier_call_failed";
    }
  }
  return { results, waiting: hold.waiting };
}
