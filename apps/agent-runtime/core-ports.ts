import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  type CallCost,
  checkpointRun,
  finishModelCall,
  finishRun,
  finishToolCall,
  messageBody,
  messagesList,
  modelCallList,
  recordMessage,
  recordToolRequest,
  RUN_BLOB_PURPOSES,
  runRead,
  startModelCall,
  type TokenUsage,
  waitRun,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  approvalsGet,
  approvalsText,
  routePath,
} from "../../packages/contracts/platform/mod.ts";
import {
  type WorkspaceReadOutput,
  workspaceReadOutputSchema,
} from "../../packages/contracts/shell/mod.ts";
import { estimatedCost } from "../../packages/lophn-agent/harness/usage/mod.ts";
import {
  type CallRequest,
  createToolJudgment,
  type ToolBinding,
} from "../../packages/lophn-agent/harness/tool-judgment/mod.ts";
import {
  executeTool,
  type RunCredential,
  type ToolDefinition,
  type ToolHandler,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import type {
  FinishRequest,
  ModelAttempt,
  PendingInputs,
  RunContext,
  RunPorts,
  StopCheck,
  ToolAttempt,
  ToolCallRequest,
  ToolDone,
  ToolInfo,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";
import type { ModelBinding } from "./model-binding.ts";
import { type BlobPort, storeValue } from "./run-blobs.ts";

// agent loop의 port를 실제 core 호출로 잇는다(lophn-agent/harness/run-loop). 읽기와 기록은 machine
// 자격의 loopback이고, tool 진입(판정의 approval 요청·소유 command)은 이 run의 agent 자격이다.
// ledger가 정본이다: 이 모듈은 상태를 따로 들고 있지 않고 id·순번·마지막 model call만 기억한다.

export type RunSeat = {
  run: string;
  assignment: string;
  session: string | null;
};

export type ToolSetup = {
  listed: readonly ToolDefinition[];
  bindings: ReadonlyMap<string, ToolBinding>;
  handlers: ReadonlyMap<string, ToolHandler>;
  credential: RunCredential;
  mcpConnection(definition: ToolDefinition): { revision: number } | undefined;
  // 외부 MCP tool의 서버 이름. 없으면 내장·앱 tool이다.
  server?(definition: ToolDefinition): string | null;
  approvalTtlMs: number;
};

export type CorePortsDeps = {
  seat: RunSeat;
  clock: Clock;
  ids: IdSource;
  machine: CoreCall;
  agent: CoreCall;
  // 기록이 hash로 가리키는 본문을 먼저 저장하는 통로와 전송 전 redaction.
  blobs: BlobPort;
  redact(text: string): string | null;
  model: ModelBinding;
  tools: ToolSetup;
  context(): Promise<Result<RunContext>>;
};

export type CorePorts = {
  ports: RunPorts;
  // 진입 직전 재검사·시작·미실행 종료. 기다림 해소기가 같은 기준으로 쓴다.
  judgment: ReturnType<typeof createToolJudgment>;
  // 기다림 해소기가 쓰는 고정 call의 실제 입력(model 응답에서 온 값)이다. 이 process가 낸 call만 있다.
  callRequest(toolCall: string): Promise<Result<CallRequest>>;
};

const STOP_REASONS = new Set([
  "user_stopped",
  "assignment_paused",
  "assignment_withdrawn",
]);

function textOf(
  content: { parts: readonly { kind: string; text?: string }[] },
): string {
  return content.parts.flatMap((part) =>
    part.kind === "text" && part.text !== undefined ? [part.text] : []
  ).join("\n");
}

const EMPTY_USAGE = (revision: string): TokenUsage => ({
  input: null,
  output: null,
  cache_read: null,
  cache_write: null,
  reasoning: null,
  cache_in_input: null,
  reasoning_in_output: null,
  definition_revision: revision,
});

const UNKNOWN_COST: CallCost = {
  kind: "unknown",
  amount: null,
  currency: null,
  basis: null,
  confirmed_at: null,
};

export function createCorePorts(deps: CorePortsDeps): CorePorts {
  const { seat, machine, agent, clock, ids } = deps;
  const store = (purpose: string, value: unknown) =>
    storeValue(deps.blobs, deps.redact, purpose, value);
  let attempts: number | undefined;
  let lastModelCall: string | null = null;
  const requests = new Map<string, CallRequest>();
  const definitionOf = (name: string) =>
    deps.tools.listed.find((tool) => tool.name === name);

  const judgment = createToolJudgment({
    clock,
    ids,
    machine,
    agent,
    assignment: seat.assignment,
    credential: deps.tools.credential,
    listed: deps.tools.listed,
    bindings: deps.tools.bindings,
    mcpConnection: deps.tools.mcpConnection,
    approvalTtlMs: deps.tools.approvalTtlMs,
  });

  async function runRecord() {
    return await readOf(machine, runRead, { run: seat.run });
  }

  // ---- 멈춤·입력 ----

  async function stop(): Promise<StopCheck> {
    const read = await runRecord();
    if (!read.ok || read.value.run.state !== "finished") {
      return { stopped: false };
    }
    const reason = read.value.run.outcome?.reason ?? "";
    return {
      stopped: true,
      reason: STOP_REASONS.has(reason)
        ? reason as "user_stopped"
        : "user_stopped",
    };
  }

  async function bodyOf(message: string): Promise<Result<string>> {
    const read = await readOf(machine, messageBody, { message });
    return read.ok ? ok(textOf(read.value.content)) : read;
  }

  async function inputs(): Promise<Result<PendingInputs>> {
    const record = await runRecord();
    if (!record.ok) return record;
    const source = record.value.run.source;
    let request: string | null = null;
    if (source.kind === "message") {
      const body = await bodyOf(source.message);
      if (!body.ok) return body;
      request = body.value;
    }
    const steering: { id: string; text: string }[] = [];
    if (seat.session !== null) {
      const listed = await readOf(machine, messagesList, {
        session: seat.session,
        run: seat.run,
      });
      if (!listed.ok) return listed;
      for (const entry of listed.value.messages) {
        const message = entry.message;
        if (
          message.mode !== "correction" || message.applied_at_call !== null ||
          message.actor !== "user"
        ) continue;
        const body = await bodyOf(message.id);
        if (!body.ok) return body;
        steering.push({ id: message.id, text: body.value });
      }
    }
    return ok({ request, steering });
  }

  // ---- model call ----

  async function modelAttempt(
    request: Parameters<RunPorts["model"]["call"]>[0],
    signal: AbortSignal,
  ): Promise<Result<ModelAttempt>> {
    if (attempts === undefined) {
      const listed = await readOf(machine, modelCallList, { run: seat.run });
      if (!listed.ok) return listed;
      attempts = listed.value.calls.length;
    }
    attempts += 1;
    // 요청과 조립 근거는 전송 전에 저장한다. 저장하지 못하면 보내지 않는다.
    const inputBlob = await store(
      RUN_BLOB_PURPOSES.model_call_input,
      request.body,
    );
    if (!inputBlob.ok) return inputBlob;
    const basisBlob = await store(
      RUN_BLOB_PURPOSES.model_call_basis,
      request.assembly.basis,
    );
    if (!basisBlob.ok) return basisBlob;
    const id = ids.newId("mcl");
    const startedAt = clock.now();
    const model = deps.model;
    const call = {
      id,
      run: seat.run,
      session: seat.session,
      model_use: "judgment" as const,
      preset: model.preset,
      purpose: "judgment" as const,
      test_request: null,
      attempt_kind: request.kind,
      attempt_order: attempts,
      retry_of: request.retry_of,
      credential_change_of: null,
      model: model.call,
      input: inputBlob.value.hash,
      context_basis: basisBlob.value.hash,
      output: null,
      state: "started" as const,
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
      first_output_ms: null,
      outcome: null,
      usage: EMPTY_USAGE(model.usageRevision),
      cost: UNKNOWN_COST,
    };
    // 수정 입력의 처음 반영은 시작 기록과 같은 transaction이다(Q30).
    const started = await commandOf(
      machine,
      startModelCall,
      {
        call,
        applied_messages: request.applied,
        blob_sizes: {
          input: inputBlob.value.size,
          context_basis: basisBlob.value.size,
        },
        state_seq: "1",
        timeout_ms: null,
      },
      { state_seq: "1" },
      `${id}:start`,
    );
    if (!started.ok) return started;
    lastModelCall = id;
    const invoked = await model.invoke({
      callId: id,
      run: seat.run,
      session: seat.session,
      purpose: "judgment",
      model: model.call,
      endpoint: model.endpoint,
      inputHash: inputBlob.value.hash,
      contextBasisHash: basisBlob.value.hash,
      body: request.body,
      timeoutMs: model.timeoutMs,
      usageRevision: model.usageRevision,
    }, signal);
    const output = invoked.ok ? invoked.value : undefined;
    const outcome = output?.outcome ?? {
      kind: "failed" as const,
      code: "credential_unavailable" as const,
      retry_at: null,
      finish_reason: null,
      http_status: null,
      provider_code: null,
    };
    const usage = output?.usage ?? EMPTY_USAGE(model.usageRevision);
    const price = model.call.price_basis;
    const charged = price === null ? undefined : estimatedCost(usage, price);
    const cost: CallCost = charged?.amount == null ? UNKNOWN_COST : {
      kind: "estimated",
      amount: charged.amount,
      currency: "USD",
      basis: (charged.rate_basis ?? {}) as Record<string, never>,
      confirmed_at: clock.now(),
    };
    const kept = output !== undefined &&
      (output.text.length > 0 || output.toolCalls.length > 0);
    let outputBlob: { hash: string; size: number } | null = null;
    if (kept || outcome.kind === "partial") {
      const stored = await store(RUN_BLOB_PURPOSES.model_call_output, {
        text: output?.text ?? "",
        tools: output?.toolCalls ?? [],
      });
      if (!stored.ok) return stored;
      outputBlob = stored.value;
    }
    const finished = await commandOf(
      machine,
      finishModelCall,
      {
        call: id,
        output: outputBlob?.hash ?? null,
        ...(outputBlob === null ? {} : { output_size: outputBlob.size }),
        outcome,
        usage,
        cost,
        duration_ms: output?.durationMs ?? null,
        first_output_ms: output?.firstOutputMs ?? null,
        state_seq: "2",
      },
      { state_seq: "1" },
      `${id}:finish`,
    );
    if (!finished.ok) return finished;
    if (output === undefined) {
      return err(
        invoked.ok ? { code: "internal", message: "no output" } : invoked.error,
      );
    }
    return ok({
      id,
      outcome,
      text: output.text,
      toolCalls: output.toolCalls,
    });
  }

  // ---- tool ----

  function info(name: string): ToolInfo | undefined {
    const definition = definitionOf(name);
    if (definition === undefined) return undefined;
    return {
      effect: definition.effect,
      idempotent: definition.idempotent,
      server: deps.tools.server?.(definition) ?? null,
    };
  }

  async function record(
    call: ToolCallRequest,
    id: string,
    definition: ToolDefinition | undefined,
  ): Promise<Result<unknown>> {
    // 인자는 redaction한 바이트를 blob으로 저장한 뒤 그 hash로 기록한다.
    const inputBlob = await store(
      RUN_BLOB_PURPOSES.tool_call_input,
      call.input,
    );
    if (!inputBlob.ok) return inputBlob;
    return await commandOf(
      machine,
      recordToolRequest,
      {
        id,
        run: seat.run,
        model_call: call.model_call,
        response_key: call.key,
        response_order: call.order,
        tool: call.name,
        definition_revision: definition?.revision ?? "unlisted",
        effect: definition?.effect ?? "read",
        confirm: definition?.confirm ?? false,
        extension: null,
        input: inputBlob.value.hash,
        input_size: inputBlob.value.size,
        retry_of: call.retry_of,
        attempt: call.attempt,
      },
      { run_state_seq: "0", model_call_finished_seq: "0" },
      `${id}:request`,
    );
  }

  const done = (
    tool_call: string,
    status: ToolDone["status"],
    code: string,
    summary: string,
  ): ToolDone => ({
    kind: "done",
    tool_call,
    status,
    code,
    result: {
      status,
      summary,
      content: null,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
  });

  async function attemptTool(
    call: ToolCallRequest,
    signal: AbortSignal,
  ): Promise<ToolAttempt> {
    const definition = definitionOf(call.name);
    const id = ids.newId("tcl");
    const recorded = await record(call, id, definition);
    if (!recorded.ok) {
      return done(
        id,
        "failure",
        "unavailable",
        "tool call could not be recorded",
      );
    }
    let request: CallRequest = {
      toolCall: id,
      run: seat.run,
      tool: call.name,
      input: call.input,
      stateSeq: "0",
    };
    requests.set(id, request);
    const decided = await judgment.decide(request);
    if (!decided.ok) {
      return done(id, "failure", "unavailable", "tool judgment is unavailable");
    }
    request = { ...request, stateSeq: decided.value.stateSeq };
    requests.set(id, request);
    const decision = decided.value.decision;
    if (decision.decision === "deny") {
      return done(id, "not_executed", "denied", decision.reason);
    }
    if (decision.decision === "ask") {
      const approval = decision.approval;
      if (approval === null) {
        return done(id, "not_executed", "denied", "no approval request");
      }
      return {
        kind: "waiting",
        tool_call: id,
        approval,
        result: done(
          id,
          "not_executed",
          "waiting_for_decision",
          "waiting for a person",
        ).result,
      };
    }
    // 진입 직전 재검사. 판정을 기록한 때와 달라졌으면 옛 허락을 쓰지 않는다.
    const admitted = await judgment.admit(request, decision);
    if (!admitted.ok || admitted.value.kind !== "enter") {
      const code = admitted.ok ? admitted.value.kind : "unavailable";
      await judgment.closeUnentered(request, request.stateSeq, code);
      return done(id, "not_executed", code, "the call was not entered");
    }
    const started = await judgment.start(request, admitted.value);
    if (!started.ok) {
      return done(
        id,
        "failure",
        "unavailable",
        "the call could not be started",
      );
    }
    request = { ...request, stateSeq: started.value };
    requests.set(id, request);
    const startedMs = clock.nowMs();
    const outcome = await executeTool(
      {
        listed: deps.tools.listed,
        handlers: deps.tools.handlers,
        credential: {
          ...deps.tools.credential,
          call: call.retry_of ?? id,
        },
      },
      call.name,
      call.input,
    );
    if (signal.aborted && outcome.outcome.kind === "failure") {
      // 중단 요청 뒤의 실패는 그대로 기록한다. 이미 보낸 효과는 결과 확인 경계가 본다.
    }
    let outputBlob: { hash: string; size: number } | null = null;
    if (outcome.outcome.kind === "success") {
      const stored = await store(
        RUN_BLOB_PURPOSES.tool_call_output,
        outcome.result,
      );
      // 결과를 저장하지 못하면 확정 사실이 없다. 불명확으로 닫는다.
      if (!stored.ok) {
        return done(
          id,
          "uncertain",
          "uncertain",
          "the result could not be stored",
        );
      }
      outputBlob = stored.value;
    }
    const finished = await commandOf(
      machine,
      finishToolCall,
      {
        tool_call: id,
        outcome: outcome.outcome,
        output: outputBlob?.hash ?? null,
        ...(outputBlob === null ? {} : { output_size: outputBlob.size }),
        result: outcome.result,
        finished_at: clock.now(),
        duration_ms: Math.max(0, clock.nowMs() - startedMs),
      },
      { state_seq: request.stateSeq },
      `${id}:finish`,
    );
    if (!finished.ok) {
      return done(
        id,
        "uncertain",
        "uncertain",
        "the result could not be recorded",
      );
    }
    return {
      kind: "done",
      tool_call: id,
      status: outcome.outcome.kind,
      code: outcome.outcome.code,
      result: outcome.result,
    };
  }

  async function close(
    call: ToolCallRequest,
    why: { status: "failure" | "not_executed"; code: string; summary: string },
  ): Promise<ToolDone> {
    const id = ids.newId("tcl");
    const definition = definitionOf(call.name);
    const recorded = await record(call, id, definition);
    if (recorded.ok) {
      await judgment.closeUnentered(
        {
          toolCall: id,
          run: seat.run,
          tool: call.name,
          input: call.input,
          stateSeq: "0",
        },
        "0",
        why.code,
      );
    }
    return done(id, why.status, why.code, why.summary);
  }

  // ---- 끝·기다림·기록 ----

  async function currentSeq(): Promise<Result<string>> {
    const record = await runRecord();
    return record.ok ? ok(record.value.run.state_seq) : record;
  }

  async function finish(request: FinishRequest) {
    const seq = await currentSeq();
    if (!seq.ok) return seq;
    // 결과는 확정한 사실이고 redaction한 바이트를 blob으로 저장한 뒤 그 hash로 끝낸다.
    const result = await store(RUN_BLOB_PURPOSES.run_result, {
      outcome: request.outcome,
      facts: request.facts,
      limit: request.limit,
    });
    if (!result.ok) return result;
    const finished = await commandOf(
      machine,
      finishRun,
      {
        run: seat.run,
        outcome: request.outcome,
        result: result.value.hash,
        result_size: result.value.size,
      },
      { state_seq: seq.value },
      `${seat.run}:finish`,
    );
    if (finished.ok) return ok({ finished: true as const });
    if (
      finished.error.code === "conflict" &&
      finished.error.message.includes("steering")
    ) {
      return ok({ finished: false as const, reason: "pending_input" as const });
    }
    return finished;
  }

  const ports: RunPorts = {
    stop,
    inputs,
    context: deps.context,
    async view(input): Promise<Result<WorkspaceReadOutput>> {
      const reply = await agent(
        routePath({ resource: "workspace", method: "read" }),
        input,
      );
      if (!reply.ok) return reply;
      const parsed = workspaceReadOutputSchema.safeParse(reply.value);
      return parsed.success
        ? ok(parsed.data)
        : err({ code: "unavailable", message: "unexpected workspace reply" });
    },
    model: {
      pack: deps.model.pack,
      available: () => deps.model.available(),
      call: modelAttempt,
    },
    tools: { info, attempt: attemptTool, close },
    async checkpoint(elapsed) {
      const record = await runRecord();
      if (!record.ok || record.value.run.state !== "running") return;
      await commandOf(
        machine,
        checkpointRun,
        { run: seat.run, elapsed },
        { state_seq: record.value.run.state_seq },
        `${seat.run}:checkpoint:${elapsed.active_ms}:${elapsed.stall_ms}`,
      );
    },
    async answer(text) {
      // 세션 없는 주기 run은 답을 남길 대화가 없다. 결과는 run 결과와 출력 문서가 낸다.
      if (seat.session === null || text.trim() === "") return ok(undefined);
      const recorded = await commandOf(
        agent,
        recordMessage,
        {
          id: ids.newId("msg"),
          session: seat.session,
          run: seat.run,
          content: { schema_version: 1, parts: [{ kind: "text", text }] },
          links: lastModelCall === null
            ? []
            : [{ kind: "model_call", call: lastModelCall }],
        },
        {},
        `${seat.run}:answer:${lastModelCall ?? "none"}`,
      );
      return recorded.ok ? ok(undefined) : recorded;
    },
    async wait(request) {
      // 판정이 이미 만든 approval을 읽어 같은 내용으로 WaitRun에 싣는다. 요청 생성과 waiting_on 연결은
      // WaitRun이 한 transaction으로 한다.
      const approval = await readOf(machine, approvalsGet, {
        approval: request.approval,
      });
      if (!approval.ok) return approval;
      const text = await readOf(machine, approvalsText, {
        approval: request.approval,
      });
      if (!text.ok) return text;
      const stored = approval.value.request;
      const seq = await currentSeq();
      if (!seq.ok) return seq;
      const waited = await commandOf(
        machine,
        waitRun,
        {
          run: seat.run,
          request: {
            kind: "approval",
            tool_call: request.tool_call,
            input: {
              id: stored.id,
              requester: stored.requester,
              run: stored.run,
              reason: text.value.reason,
              effect: {
                changes: text.value.changes,
                external: text.value.external,
                reversible: stored.effect.reversible,
                reversibility: text.value.reversibility,
              },
              action: stored.action,
              expires_at: stored.expires_at,
            },
          },
          call: request.tool_call,
        },
        { state_seq: seq.value },
        `${request.approval}:wait`,
      );
      return waited.ok ? ok(undefined) : waited;
    },
    finish,
  };

  return {
    ports,
    judgment,
    callRequest(toolCall) {
      const found = requests.get(toolCall);
      return Promise.resolve(
        found === undefined
          ? err({ code: "not_found", message: "the call input is not held" })
          : ok(found),
      );
    },
  };
}
