import type {
  RECOVERY_BOUNDARIES,
  RunElapsed,
  ToolResult,
} from "../../../contracts/lophn-agent/mod.ts";
import type { HistoryMessage } from "../prompt-assemble/mod.ts";
import {
  type CallResult,
  historyResultPart,
  isTransientFailure,
  type ModelAttempt,
  parseToolArgs,
  type ResumeState,
} from "../run-loop/mod.ts";

// 중단 뒤 복구의 순수 규칙(lophn-agent/harness/waiting-and-recovery R8–R10). ledger 사실에서 어디까지
// 확정됐는지(경계)를 정하고, 이미 확정한 model 응답과 tool 결과로 이력을 다시 만든다. 읽기·쓰기는
// 모른다. 같은 규칙을 core의 RecoverRun 검증과 runtime의 복구가 함께 쓴다.

export type Boundary = {
  boundary: (typeof RECOVERY_BOUNDARIES)[number];
  call: string | null;
};

export type RunView = {
  state: "accepted" | "running" | "waiting_user" | "finished";
};

export type ModelView = {
  id: string;
  attempt_order: number;
  state: "started" | "finished";
  outcome_kind: string | null;
};

export type ToolView = {
  id: string;
  model_call: string;
  response_key: string;
  response_order: number;
  attempt: number;
  effect: "read" | "write" | "external";
  extension: unknown | null;
  state: "requested" | "started" | "finished";
  outcome_kind: string | null;
};

function byOrder(models: readonly ModelView[]): ModelView[] {
  return [...models].sort((a, b) => a.attempt_order - b.attempt_order);
}

// 확정된 마지막 지점이다. 진행 중이던 호출이 있으면 그 호출이 경계다: 시작만 있고 결과가 없는 tool call,
// 그다음 시작만 있는 model call, 그다음 마지막 model 응답이다.
export function boundaryOf(
  run: RunView,
  models: readonly ModelView[],
  tools: readonly ToolView[],
): Boundary {
  if (run.state === "finished") return { boundary: "finished", call: null };
  if (run.state === "accepted") return { boundary: "accepted", call: null };
  if (run.state === "waiting_user") return { boundary: "waiting", call: null };
  const open = tools.find((tool) => tool.state === "started");
  if (open !== undefined) {
    return {
      boundary: open.extension !== null || open.effect === "external"
        ? "outside_call"
        : "ledger_write",
      call: open.id,
    };
  }
  const ordered = byOrder(models);
  const last = ordered[ordered.length - 1];
  if (last === undefined) return { boundary: "accepted", call: null };
  return {
    boundary: last.state === "started" ? "model_started" : "model_finished",
    call: last.id,
  };
}

// 중단 시간을 보수적으로 센다. 마지막 확인 시각부터 지금까지를 active와 stall에 모두 더한다. 기준
// 시각이 없거나 시계가 거꾸로 갔으면 판단할 수 없다(clock_uncertain).
export function advanceElapsed(
  elapsed: RunElapsed,
  startedAt: string | null,
  now: string,
): RunElapsed | null {
  const base = elapsed.checkpoint_at ?? startedAt;
  if (base === null) return null;
  const gap = Date.parse(now) - Date.parse(base);
  if (Number.isNaN(gap) || gap < 0) return null;
  return {
    active_ms: elapsed.active_ms + gap,
    stall_ms: elapsed.stall_ms + gap,
    checkpoint_at: now,
  };
}

export type RecoveryPlan =
  // 복구할 것이 없다: 끝난 run, 아직 시작하지 않은 run(원래 순서의 후보), 사람을 기다리는 run(결정 반영의
  // 일이다).
  | { kind: "skip"; why: "finished" | "accepted" | "waiting" }
  // 담당이 멈췄거나 회수됐다. 자동으로 풀지 않고 입력과 확정 결과를 남긴 채 멈춘다.
  | { kind: "stop"; reason: "assignment_paused" | "assignment_withdrawn" }
  | { kind: "finish"; reason: "clock_uncertain" }
  | {
    kind: "resume";
    boundary: Boundary;
    elapsed: RunElapsed;
    // 결과 없이 시작만 있는 호출과 진입하지 않은 호출. 복구가 먼저 닫는다.
    open: {
      model: string | null;
      started: readonly ToolView[];
      requested: readonly ToolView[];
    };
  };

export function planRecovery(input: {
  run: RunView & { started_at: string | null; elapsed: RunElapsed };
  // 현재 assignment 상태. 없으면 회수와 같다.
  assignment: "enabled" | "paused" | "withdrawn" | undefined;
  models: readonly ModelView[];
  tools: readonly ToolView[];
  now: string;
}): RecoveryPlan {
  const { run } = input;
  if (run.state === "finished") return { kind: "skip", why: "finished" };
  if (run.state === "accepted") return { kind: "skip", why: "accepted" };
  if (run.state === "waiting_user") return { kind: "skip", why: "waiting" };
  if (input.assignment !== "enabled") {
    return {
      kind: "stop",
      reason: input.assignment === "paused"
        ? "assignment_paused"
        : "assignment_withdrawn",
    };
  }
  const elapsed = advanceElapsed(run.elapsed, run.started_at, input.now);
  if (elapsed === null) return { kind: "finish", reason: "clock_uncertain" };
  const ordered = byOrder(input.models);
  const last = ordered[ordered.length - 1];
  return {
    kind: "resume",
    boundary: boundaryOf(run, input.models, input.tools),
    elapsed,
    open: {
      model: last?.state === "started" ? last.id : null,
      started: input.tools.filter((tool) => tool.state === "started"),
      requested: input.tools.filter((tool) => tool.state === "requested"),
    },
  };
}

// ledger의 tool call 행에서 확정한 사실(변경·미실행·불명확 효과)을 모은다. 요청 key마다 마지막 시도만
// 센다. 끝나지 않은 call은 어느 쪽에도 넣지 않는다.
export function confirmedFactsOf(
  tools: readonly ToolView[],
): { changes: string[]; unexecuted: string[]; unknown_effects: string[] } {
  const finals = new Map<string, ToolView>();
  for (const tool of tools) {
    const key = `${tool.model_call}:${tool.response_key}`;
    const held = finals.get(key);
    if (held === undefined || held.attempt < tool.attempt) {
      finals.set(key, tool);
    }
  }
  const facts = {
    changes: [] as string[],
    unexecuted: [] as string[],
    unknown_effects: [] as string[],
  };
  for (const tool of finals.values()) {
    if (tool.state !== "finished") continue;
    if (tool.outcome_kind === "success" && tool.effect !== "read") {
      facts.changes.push(tool.id);
    } else if (tool.outcome_kind === "not_executed") {
      facts.unexecuted.push(tool.id);
    } else if (tool.outcome_kind === "uncertain") {
      facts.unknown_effects.push(tool.id);
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// 이력 재구성
// ---------------------------------------------------------------------------

export type ModelBody = {
  text: string;
  tools: readonly { id: string; name: string; args: string }[];
};

export type RebuildModel = {
  id: string;
  attempt_order: number;
  retry_of: string | null;
  outcome: {
    kind: string;
    code: string | null;
    retry_at: string | null;
    finish_reason: string | null;
  };
  // complete·partial 응답의 저장된 본문. 없으면 null이다.
  body: ModelBody | null;
  // 이 call에 처음 반영된 사람의 수정 입력 글.
  steering: readonly string[];
};

export type RebuildTool = ToolView & {
  tool: string;
  code: string | null;
  // 성공한 call의 저장된 결과 본문.
  result: ToolResult | null;
};

function synthesized(
  status: "failure" | "not_executed" | "uncertain",
  code: string,
): ToolResult {
  return {
    status,
    summary: `The recorded outcome of this call is ${status} (${code}).`,
    content: null,
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

function resultOf(
  key: string,
  order: number,
  name: string,
  input: unknown,
  tool: RebuildTool,
): CallResult {
  const status = tool.outcome_kind as CallResult["status"];
  const code = tool.code ?? status;
  return {
    key,
    order,
    name,
    input,
    tool_call: tool.id,
    status,
    code,
    result: status === "success" && tool.result !== null
      ? tool.result
      : synthesized(status === "success" ? "failure" : status, code),
    entries: status === "not_executed" ? 0 : 1,
  };
}

// 확정한 model 응답과 tool 결과로 이력·사실·남은 일을 다시 만든다. 저장된 응답을 다시 부르지 않는다.
// 마지막 완전 응답에 아직 확정하지 않은 call이나 기록하지 않은 답이 남았으면 pending이다.
// executing은 사람의 허락으로 진입이 기록되어 지금 실행할 call의 ID다.
export async function rebuildResume(input: {
  collectedAt: string;
  models: readonly RebuildModel[];
  tools: readonly RebuildTool[];
  executing: ReadonlySet<string>;
}): Promise<ResumeState> {
  const models = [...input.models].sort((a, b) =>
    a.attempt_order - b.attempt_order
  );
  const history: HistoryMessage[] = [];
  const append = (message: HistoryMessage) => {
    const last = history[history.length - 1];
    if (message.role === "user" && last?.role === "user") {
      history[history.length - 1] = {
        role: "user",
        parts: [...last.parts, ...message.parts],
      };
    } else history.push(message);
  };
  const last = models[models.length - 1];
  let pending: ResumeState["pending"] = null;
  const settled: RebuildTool[] = [];

  for (const model of models) {
    if (model.steering.length > 0) {
      append({
        role: "user",
        parts: model.steering.map((text) => ({ kind: "text", text })),
      });
    }
    if (model.outcome.kind === "partial") {
      append({
        role: "user",
        parts: [{
          kind: "text",
          text: `[machine] The previous response was cut off (${
            model.outcome.finish_reason ?? "unknown"
          }). None of its tool calls were started. Continue from what is confirmed.`,
        }],
      });
      continue;
    }
    if (model.outcome.kind !== "complete" || model.body === null) continue;
    const body = model.body;
    const rows = input.tools.filter((tool) => tool.model_call === model.id);
    const finalOf = (key: string): RebuildTool | undefined =>
      rows.filter((row) => row.response_key === key)
        .sort((a, b) => b.attempt - a.attempt)[0];
    const keyed = body.tools.map((call, order) => {
      const parsed = parseToolArgs(call.args);
      return {
        key: call.id,
        order,
        name: call.name,
        input: parsed.ok ? parsed.value : call.args,
        row: finalOf(call.id),
      };
    });
    const confirmed = keyed.flatMap((item) =>
      item.row !== undefined && item.row.state === "finished"
        ? [resultOf(item.key, item.order, item.name, item.input, item.row)]
        : []
    );
    const isLast = model === last;
    const complete = confirmed.length === keyed.length;
    if (isLast && (keyed.length === 0 || !complete)) {
      const attempt: ModelAttempt = {
        id: model.id,
        outcome: model.outcome as ModelAttempt["outcome"],
        text: body.text,
        toolCalls: body.tools,
      };
      pending = {
        attempt,
        confirmed,
        started: Object.fromEntries(
          keyed.flatMap((item) =>
            item.row !== undefined && input.executing.has(item.row.id)
              ? [[item.key, item.row.id]]
              : []
          ),
        ),
      };
      continue;
    }
    if (keyed.length === 0) {
      if (body.text.trim() !== "") {
        append({
          role: "assistant",
          parts: [{ kind: "text", text: body.text }],
        });
      }
      continue;
    }
    const results: CallResult[] = keyed.map((item) =>
      item.row !== undefined && item.row.state === "finished"
        ? resultOf(item.key, item.order, item.name, item.input, item.row)
        : {
          key: item.key,
          order: item.order,
          name: item.name,
          input: item.input,
          tool_call: null,
          status: "not_executed",
          code: "no_record",
          result: synthesized("not_executed", "no_record"),
          entries: 0,
        }
    );
    append({
      role: "assistant",
      parts: [
        ...(body.text.trim() === ""
          ? []
          : [{ kind: "text" as const, text: body.text }]),
        ...results.map((result) => ({
          kind: "tool_use" as const,
          id: result.key,
          name: result.name,
          input: result.input,
        })),
      ],
    });
    append({
      role: "user",
      parts: await Promise.all(
        results.map((result) => historyResultPart(input.collectedAt, result)),
      ),
    });
    for (const item of keyed) {
      if (item.row !== undefined) settled.push(item.row);
    }
  }

  // 사실은 이미 처리를 마친 응답의 결과만 센다. 남은 응답의 확정 결과는 loop가 이어 가며 센다.
  const facts = confirmedFactsOf(settled);

  // 마지막 응답이 일시 실패였다면 retry 대기를 잇는다. 쓴 횟수는 같은 요청의 연속 실패 수다.
  let retry: ResumeState["retry"] = null;
  if (last !== undefined && pending === null) {
    const outcome = last.outcome as Parameters<typeof isTransientFailure>[0];
    if (isTransientFailure(outcome)) {
      let retries = 0;
      for (
        let cursor: RebuildModel | undefined = last;
        cursor !== undefined;
        cursor = models.find((model) => model.id === cursor?.retry_of)
      ) {
        retries += 1;
      }
      retry = {
        previous: last.id,
        retries,
        retry_at: last.outcome.retry_at,
      };
    }
  }
  return { history, facts, pending, retry };
}
