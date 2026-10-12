import type { z } from "zod";
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import {
  assignmentRead,
  finishModelCall,
  finishToolCall,
  messageBody,
  messagesList,
  modelCallList,
  recoverRun,
  RUN_BLOB_PURPOSES,
  runBody,
  runRead,
  runStarted,
  stopRun,
  toolCallList,
  type ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import { eventsList, routePath } from "../../../protocol/server/mod.ts";
import type { CoreCall } from "../tool-judgment/mod.ts";
import { callRevision } from "../tools/mod.ts";
import {
  parseToolArgs,
  type ResumeState,
  type ToolCallRequest,
  type ToolDone,
} from "../run-loop/mod.ts";
import {
  boundaryOf,
  type ModelView,
  planRecovery,
  type RebuildModel,
  rebuildResume,
  type RebuildTool,
  type ToolView,
} from "./recovery.ts";

// 중단 뒤 복구의 실제 일(lophn-agent/harness/waiting-and-recovery R8–R10, R12). ledger의 run·model
// call·tool call 사실을 읽어 경계를 확정하고, 결과 없이 시작만 있는 호출을 먼저 닫은 뒤 이미 확정한
// 응답·결과로 이력을 다시 만들어 같은 run을 잇게 한다. 확정한 call은 다시 부르지 않고, 결과 모르는
// 쓰기·external은 소유 계약의 결과 조회가 알려 주기 전에는 다시 보내지 않는다.

type ToolRecord = z.output<typeof toolCallList.output>["tool_calls"][number];
type ModelRecord = z.output<typeof modelCallList.output>["calls"][number];

// 결과를 모르는 쓰기·external의 저장된 결과를 소유 계약에서 조회한다. 확정한 결과를 찾으면 그 결과를,
// 찾을 수 없으면 null이다(결과 조회가 없는 tool도 null). 찾지 못한 것을 성공이나 미실행으로 추측하지
// 않는다.
export type ToolLookup = (call: {
  tool_call: string;
  tool: string;
  input: unknown;
}) => Promise<
  {
    outcome: { kind: "success" | "failure"; code: string };
    result: ToolResult;
  } | null
>;

export type RecoveryDeps = {
  // machine 자격의 loopback.
  machine: CoreCall;
  clock: Clock;
  // redaction한 바이트를 blob으로 먼저 저장하고 hash를 돌려준다.
  store(
    purpose: string,
    value: unknown,
  ): Promise<Result<{ hash: string; size: number }>>;
  lookup(tool: string): ToolLookup | undefined;
  // 기록하지 않은 남은 call을 미실행으로 닫는다.
  close(
    call: ToolCallRequest,
    why: { status: "not_executed"; code: string; summary: string },
  ): Promise<ToolDone>;
};

export type RecoveryOutcome =
  // 복구할 것이 없다. waiting은 결정 반영(해소기)의 일이다.
  | { kind: "skipped"; why: "finished" | "accepted" | "waiting" }
  // 담당이 멈췄거나 회수됐다. run은 멈춤으로 끝났고 입력·확정 결과는 그대로다.
  | { kind: "stopped"; reason: "assignment_paused" | "assignment_withdrawn" }
  | { kind: "finished"; reason: string }
  | {
    kind: "resume";
    resume: ResumeState;
    elapsed: { active_ms: number; stall_ms: number; checkpoint_at: string };
    // 지금까지 센 model 시도(실패·retry 포함).
    attempts: number;
    session: string | null;
    // StartRun이 고정한 AgentAppScope. credential은 이 값 그대로만 발급된다.
    scope: unknown;
    // 이 run의 가장 마지막 model call. 답 기록의 idempotency에 쓴다.
    lastModelCall: string | null;
  };

const FINISH_REASONS = [
  "effect_unknown",
  "clock_uncertain",
  "configuration_unavailable",
  "target_unavailable",
] as const;
export type RecoveryFinishReason = (typeof FINISH_REASONS)[number];

function textOf(
  content: { parts: readonly { kind: string; text?: string }[] },
): string {
  return content.parts.flatMap((part) =>
    part.kind === "text" && part.text !== undefined ? [part.text] : []
  ).join("\n");
}

const UNKNOWN_COST = {
  kind: "unknown" as const,
  amount: null,
  currency: null,
  basis: null,
  confirmed_at: null,
};

function viewOf(record: ToolRecord): ToolView {
  return {
    id: record.id,
    model_call: record.model_call,
    response_key: record.response_key,
    response_order: record.response_order,
    attempt: record.attempt,
    effect: record.effect,
    extension: record.extension,
    state: record.state,
    outcome_kind: record.outcome?.kind ?? null,
  };
}

export async function recoverRunFromLedger(
  deps: RecoveryDeps,
  runId: string,
  options: {
    // 사람의 허락으로 진입이 이미 기록되어 지금 실행할 call. 결과를 모른다고 보지 않는다.
    executing?: ReadonlySet<string>;
    // 새 진입 전 현재 사실의 재확인(scope·credential·model). 이유를 주면 진행하지 않고 끝낸다.
    preflight?(
      run: { scope: unknown; session: string | null },
    ): Promise<RecoveryFinishReason | null>;
  } = {},
): Promise<Result<RecoveryOutcome>> {
  const executing = options.executing ?? new Set<string>();
  const { machine } = deps;

  async function read<O extends z.ZodType>(
    route: { resource: string; method: string; output: O },
    body: unknown,
  ): Promise<Result<z.output<O>>> {
    const reply = await machine(routePath(route), body);
    if (!reply.ok) return reply;
    const parsed = route.output.safeParse(reply.value);
    return parsed.success
      ? ok(parsed.data)
      : err({ code: "unavailable", message: "unexpected core reply" });
  }

  async function command<O extends z.ZodType>(
    route: { resource: string; method: string; output: O },
    input: unknown,
    compare: unknown,
    key: string,
  ): Promise<Result<z.output<O>>> {
    return await read(route, {
      input,
      idempotency_key: key,
      compare,
      prepared: [],
    });
  }

  async function allModelCalls(): Promise<Result<ModelRecord[]>> {
    const calls: ModelRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const listed = await read(modelCallList, {
        run: runId,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!listed.ok) return listed;
      calls.push(...listed.value.calls);
      if (
        listed.value.next_cursor === null ||
        listed.value.next_cursor === undefined
      ) {
        return ok(calls);
      }
      cursor = listed.value.next_cursor;
    }
    return err({ code: "unavailable", message: "too many model calls" });
  }

  async function allToolCalls(): Promise<Result<ToolRecord[]>> {
    const calls: ToolRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const listed = await read(toolCallList, {
        run: runId,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!listed.ok) return listed;
      calls.push(...listed.value.tool_calls);
      if (
        listed.value.next_cursor === null ||
        listed.value.next_cursor === undefined
      ) {
        return ok(calls);
      }
      cursor = listed.value.next_cursor;
    }
    return err({ code: "unavailable", message: "too many tool calls" });
  }

  async function startedScope(): Promise<Result<unknown>> {
    let after = "0";
    for (let page = 0; page < 1000; page++) {
      const listed = await read(eventsList, {
        after_seq: after,
        types: [runStarted.type],
        subjects: [runId],
      });
      if (!listed.ok) return listed;
      const found = listed.value.events[0];
      if (found !== undefined) return ok(found.payload["scope"]);
      if (
        listed.value.next_cursor === null ||
        listed.value.next_cursor === undefined
      ) break;
      after = listed.value.next_cursor;
    }
    return err({ code: "unavailable", message: "the run start is not found" });
  }

  const record = await read(runRead, { run: runId });
  if (!record.ok) return record;
  const run = record.value.run;
  const assigned = await read(assignmentRead, { assignment: run.assignment });
  const assignment = assigned.ok ? assigned.value.assignment : undefined;
  if (!assigned.ok && assigned.error.code !== "not_found") return assigned;
  const models = await allModelCalls();
  if (!models.ok) return models;
  const tools = await allToolCalls();
  if (!tools.ok) return tools;

  const plan = planRecovery({
    run: {
      state: run.state,
      started_at: run.started_at,
      elapsed: run.elapsed,
    },
    assignment: assignment?.state as
      | "enabled"
      | "paused"
      | "withdrawn"
      | undefined,
    models: models.value.map((call) => ({
      id: call.id,
      attempt_order: call.attempt_order,
      state: call.state,
      outcome_kind: call.outcome?.kind ?? null,
    })),
    tools: tools.value.map(viewOf),
    now: deps.clock.now(),
  });
  if (plan.kind === "skip") return ok({ kind: "skipped", why: plan.why });
  if (plan.kind === "stop") {
    // 멈춘 assignment의 run은 풀지 않고 멈춤으로 끝낸다. 확정한 입력과 결과는 그대로 남는다.
    const stopped = await command(
      stopRun,
      {
        run: runId,
        reason: plan.reason,
        request_key: `${runId}:recover:${plan.reason}`,
      },
      { state_seq: run.state_seq },
      `${runId}:recover:${plan.reason}`,
    );
    return stopped.ok ? ok({ kind: "stopped", reason: plan.reason }) : stopped;
  }

  const finishWith = async (
    reason: RecoveryFinishReason,
    elapsed: { active_ms: number; stall_ms: number; checkpoint_at: string },
    state: { state_seq: string; basis_seq: string },
    tools_: readonly ToolRecord[],
    models_: readonly ModelRecord[],
  ): Promise<Result<RecoveryOutcome>> => {
    const view = tools_.map(viewOf);
    const finished = await command(
      recoverRun,
      basisOf(
        run.id,
        view,
        models_,
        elapsed,
        state.basis_seq,
        "finish",
        reason,
      ),
      { state_seq: state.state_seq },
      `${runId}:recover:finish:${reason}`,
    );
    return finished.ok ? ok({ kind: "finished", reason }) : finished;
  };

  if (plan.kind === "finish") {
    return await finishWith(
      plan.reason,
      {
        active_ms: run.elapsed.active_ms,
        stall_ms: run.elapsed.stall_ms,
        checkpoint_at: deps.clock.now(),
      },
      { state_seq: run.state_seq, basis_seq: record.value.as_of_seq },
      tools.value,
      models.value,
    );
  }

  // ---- 열린 호출을 먼저 닫는다 ----

  // model call이 시작만 있고 응답을 확정하지 못했다. 사용량을 모르므로 불명확으로 남기고 남은 한도
  // 안의 새 시도만 한다.
  if (plan.open.model !== null) {
    const call = models.value.find((entry) => entry.id === plan.open.model)!;
    const closed = await command(
      finishModelCall,
      {
        call: call.id,
        output: null,
        outcome: {
          kind: "uncertain",
          code: null,
          retry_at: null,
          finish_reason: null,
          http_status: null,
          provider_code: null,
        },
        usage: call.usage,
        cost: UNKNOWN_COST,
        duration_ms: null,
        first_output_ms: null,
        state_seq: "2",
      },
      { state_seq: "1" },
      `${call.id}:finish`,
    );
    if (!closed.ok) return closed;
  }

  // 진입하지 않은 call은 효과가 없다. 미실행으로 닫고 모델이 다시 판단하게 한다.
  const finishCall = (
    record_: ToolRecord,
    outcome: { kind: string; code: string },
    output: { hash: string; size: number } | null,
    result: ToolResult | null,
  ) =>
    command(
      finishToolCall,
      {
        tool_call: record_.id,
        outcome,
        output: output?.hash ?? null,
        ...(output === null ? {} : { output_size: output.size }),
        result,
        finished_at: deps.clock.now(),
        duration_ms: null,
      },
      { state_seq: callRevision(record_) },
      `${record_.id}:finish`,
    );
  for (const view of plan.open.requested) {
    const target = tools.value.find((entry) => entry.id === view.id)!;
    const closed = await finishCall(
      target,
      {
        kind: "not_executed",
        code: "recovery_interrupted",
      },
      null,
      null,
    );
    if (!closed.ok) return closed;
  }

  // 시작만 있고 결과가 없는 call. 읽기는 효과가 없으니 중단으로 닫는다. 쓰기·external은 소유 계약의
  // 결과 조회로 확정한 결과만 쓰고, 찾지 못하면 불명확으로 남긴다. 다시 보내지 않는다.
  const bodies = new Map<
    string,
    { text: string; tools: { id: string; name: string; args: string }[] }
  >();
  async function modelBody(id: string) {
    const held = bodies.get(id);
    if (held !== undefined) return ok(held);
    const body = await read(runBody, { kind: "model_call_output", id });
    if (!body.ok) return body;
    const value = body.value.value as {
      text: string;
      tools: { id: string; name: string; args: string }[];
    };
    bodies.set(id, value);
    return ok(value);
  }
  let unknownEffect = false;
  for (const view of plan.open.started) {
    if (executing.has(view.id)) continue;
    const target = tools.value.find((entry) => entry.id === view.id)!;
    if (target.effect === "read") {
      const closed = await finishCall(
        target,
        {
          kind: "failure",
          code: "interrupted",
        },
        null,
        {
          status: "failure",
          summary:
            "The read was interrupted by a restart. Ask again if needed.",
          content: null,
          complete: true,
          source: null,
          continuation: null,
          pending: [],
        },
      );
      if (!closed.ok) return closed;
      continue;
    }
    const lookup = deps.lookup(target.tool);
    let found: Awaited<ReturnType<ToolLookup>> = null;
    if (lookup !== undefined) {
      const model = await modelBody(target.model_call);
      if (!model.ok) return model;
      const sent = model.value.tools.find((call) =>
        call.id === target.response_key
      );
      let input: unknown = sent?.args ?? null;
      try {
        input = JSON.parse(sent?.args ?? "{}");
      } catch {
        // 해석할 수 없는 인자는 원문 그대로 조회에 준다.
      }
      found = await lookup({
        tool_call: target.id,
        tool: target.tool,
        input,
      });
    }
    if (found !== null) {
      let output: { hash: string; size: number } | null = null;
      if (found.outcome.kind === "success") {
        const stored = await deps.store(
          RUN_BLOB_PURPOSES.tool_call_output,
          found.result,
        );
        if (!stored.ok) return stored;
        output = stored.value;
      }
      const closed = await finishCall(
        target,
        found.outcome,
        output,
        found.result,
      );
      if (!closed.ok) return closed;
      continue;
    }
    unknownEffect = true;
    const closed = await finishCall(
      target,
      {
        kind: "uncertain",
        code: "uncertain",
      },
      null,
      {
        status: "uncertain",
        summary:
          "The call may have run before the restart and its outcome could not be confirmed.",
        content: null,
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      },
    );
    if (!closed.ok) return closed;
  }

  // 닫은 결과를 반영해 다시 읽는다. 확정한 경계는 이 사실이다.
  const closedModels = await allModelCalls();
  if (!closedModels.ok) return closedModels;
  const closedTools = await allToolCalls();
  if (!closedTools.ok) return closedTools;
  const now = await read(runRead, { run: runId });
  if (!now.ok) return now;
  const elapsed = {
    active_ms: plan.elapsed.active_ms,
    stall_ms: plan.elapsed.stall_ms,
    checkpoint_at: plan.elapsed.checkpoint_at as string,
  };
  const state = {
    state_seq: now.value.run.state_seq,
    basis_seq: now.value.as_of_seq,
  };

  // 확인할 수 없는 효과가 있으면 진행하지 않는다. 마지막 응답의 남은 call은 미실행으로 남기고 불명확
  // 효과와 구별해 끝낸다. 충돌할 수 있는 후속 call을 시작하지 않는다.
  if (unknownEffect) {
    const lastModel = closedModels.value
      .filter((call) =>
        call.outcome?.kind === "complete" && call.output !== null
      )
      .sort((a, b) => b.attempt_order - a.attempt_order)[0];
    if (lastModel !== undefined) {
      const body = await modelBody(lastModel.id);
      if (!body.ok) return body;
      const recorded = new Set(
        closedTools.value.filter((call) => call.model_call === lastModel.id)
          .map((call) => call.response_key),
      );
      for (const [order, call] of body.value.tools.entries()) {
        if (recorded.has(call.id)) continue;
        await deps.close({
          model_call: lastModel.id,
          key: call.id,
          order,
          name: call.name,
          input: parsedInput(call.args),
          attempt: 0,
          retry_of: null,
        }, {
          status: "not_executed",
          code: "earlier_call_failed",
          summary:
            "An earlier call's outcome is unknown, so this call did not start.",
        });
      }
    }
    const after = await allToolCalls();
    if (!after.ok) return after;
    return await finishWith(
      "effect_unknown",
      elapsed,
      state,
      after.value,
      closedModels.value,
    );
  }

  // ---- 새 진입 전 재확인 ----

  const scope = await startedScope();
  if (!scope.ok) return scope;
  const refused = await options.preflight?.({
    scope: scope.value,
    session: run.session,
  });
  if (refused !== null && refused !== undefined) {
    return await finishWith(
      refused,
      elapsed,
      state,
      closedTools.value,
      closedModels.value,
    );
  }

  // ---- 저장된 본문으로 이력을 다시 만든다 ----

  const rebuildModels: RebuildModel[] = [];
  for (const call of closedModels.value) {
    if (call.outcome === null) continue;
    let body: RebuildModel["body"] = null;
    if (
      (call.outcome.kind === "complete" || call.outcome.kind === "partial") &&
      call.output !== null
    ) {
      const stored = await modelBody(call.id);
      if (!stored.ok) return stored;
      body = stored.value;
    }
    rebuildModels.push({
      id: call.id,
      attempt_order: call.attempt_order,
      retry_of: call.retry_of,
      outcome: call.outcome,
      body,
      steering: [],
    });
  }
  if (run.session !== null) {
    const listed = await read(messagesList, {
      session: run.session,
      run: runId,
    });
    if (!listed.ok) return listed;
    for (const entry of listed.value.messages) {
      const message = entry.message;
      if (
        message.mode !== "correction" || message.actor !== "user" ||
        message.applied_at_call === null
      ) continue;
      const target = rebuildModels.find((call) =>
        call.id === message.applied_at_call
      );
      if (target === undefined) continue;
      const body = await read(messageBody, { message: message.id });
      if (!body.ok) return body;
      (target.steering as string[]).push(textOf(body.value.content));
    }
  }
  const rebuildTools: RebuildTool[] = [];
  for (const call of closedTools.value) {
    let result: ToolResult | null = null;
    if (call.outcome?.kind === "success" && call.output !== null) {
      const body = await read(runBody, {
        kind: "tool_call_output",
        id: call.id,
      });
      if (!body.ok) return body;
      result = body.value.value as ToolResult;
    }
    rebuildTools.push({
      ...viewOf(call),
      tool: call.tool,
      code: call.outcome?.code ?? null,
      result,
    });
  }
  const resume = await rebuildResume({
    collectedAt: deps.clock.now(),
    models: rebuildModels,
    tools: rebuildTools,
    executing,
  });

  const recovered = await command(
    recoverRun,
    basisOf(
      run.id,
      closedTools.value.map(viewOf),
      closedModels.value,
      elapsed,
      state.basis_seq,
      "resume",
      "stored_boundary",
    ),
    { state_seq: state.state_seq },
    `${runId}:recover:resume:${state.state_seq}`,
  );
  if (!recovered.ok) return recovered;
  const last =
    [...closedModels.value].sort((a, b) =>
      b.attempt_order - a.attempt_order
    )[0];
  return ok({
    kind: "resume",
    resume,
    elapsed,
    attempts: closedModels.value.length,
    session: run.session,
    scope: scope.value,
    lastModelCall: last?.id ?? null,
  });
}

function parsedInput(args: string): unknown {
  const parsed = parseToolArgs(args);
  return parsed.ok ? parsed.value : args;
}

// RecoveryBasis. 경계는 ledger 사실에서 다시 계산하고 확정한 결과는 끝난 call의 ID다.
function basisOf(
  run: string,
  tools: readonly ToolView[],
  models: readonly ModelRecord[],
  elapsed: { active_ms: number; stall_ms: number; checkpoint_at: string },
  basisSeq: string,
  resolution: "resume" | "finish",
  reason: string,
) {
  const views: ModelView[] = models.map((call) => ({
    id: call.id,
    attempt_order: call.attempt_order,
    state: call.state,
    outcome_kind: call.outcome?.kind ?? null,
  }));
  const found = boundaryOf({ state: "running" }, views, tools);
  return {
    run,
    boundary: found.boundary,
    basis_seq: basisSeq,
    call: found.call,
    confirmed_results: [
      ...views.filter((call) => call.state === "finished").map((call) =>
        call.id
      ),
      ...tools.filter((call) => call.state === "finished").map((call) =>
        call.id
      ),
    ],
    elapsed,
    resolution,
    reason,
  };
}
