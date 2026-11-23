import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AgentAddress,
  AgentRequest,
  Checkpoint,
  EscalateRequest,
  EventFilter,
  EventHandler,
  FlowEvent,
  FlowPort,
  HumanRequest,
  Outcome,
  ReportRequest,
  SoftOutput,
  ToolRequest,
  WireRequestBody,
  WorkflowRequest,
} from "./wire.ts";

type PrimitiveKind = "agent" | "human" | "workflow" | "tool";

type StepScope = {
  key: string;
  counts: Record<string, number>;
};

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  return "cancelled";
}

function normalizeAgentAddress(target: AgentAddress | string): AgentAddress {
  return typeof target === "string" ? { agent: target } : target;
}

export function createFlowRuntime(port: FlowPort) {
  // AsyncLocalStorage로 Promise.all 병렬 step 분기가 서로의 순번을 오염시키지 않게 격리한다.
  const stepScope = new AsyncLocalStorage<StepScope>();
  const completedSteps = new Map<string, unknown>();
  for (const cp of port.checkpoints) {
    if (cp.kind === "step" && cp.state === "completed") {
      completedSteps.set(cp.key, cp.output);
    }
  }
  let cancelSeq = 0;
  let subSeq = 0;

  function resolvePrimitiveKey(
    kind: PrimitiveKind,
    explicitKey: string | undefined,
  ): { key: string; stepKey: string | undefined } {
    const scope = stepScope.getStore();
    if (explicitKey !== undefined) {
      if (typeof explicitKey !== "string" || explicitKey.trim() === "") {
        throw new Error(`${kind}() key must be a non-empty string`);
      }
      return { key: explicitKey, stepKey: scope?.key };
    }
    if (scope === undefined) {
      throw new Error(
        `${kind}() requires an explicit key or must be called inside step(key, fn)`,
      );
    }
    const next = (scope.counts[kind] ?? 0) + 1;
    scope.counts[kind] = next;
    return { key: `${scope.key}/${kind}#${next}`, stepKey: scope.key };
  }

  async function requestCancellable<T>(
    signal: AbortSignal | undefined,
    build: (cancelId: string | undefined) => WireRequestBody,
  ): Promise<Outcome<T>> {
    if (signal?.aborted) {
      return {
        ok: false,
        reason: "cancelled",
        message: abortMessage(signal),
      };
    }
    const cancelId = signal !== undefined ? `c_${++cancelSeq}` : undefined;
    const onAbort = () => {
      if (cancelId === undefined) return;
      void port
        .request({ type: "cancel", cancel_id: cancelId })
        .catch(() => {});
    };
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      return (await port.request(build(cancelId))) as Outcome<T>;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function step<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    if (typeof key !== "string" || key.trim() === "") {
      throw new Error("step() requires a non-empty key");
    }
    if (completedSteps.has(key)) {
      return completedSteps.get(key) as T;
    }
    const began = await port.request({ type: "step_begin", key });
    if (!began.ok) {
      throw new Error(`step "${key}" failed to begin: ${began.message}`);
    }
    const scope: StepScope = { key, counts: Object.create(null) };
    let result: T;
    try {
      result = await stepScope.run(scope, () => fn());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await port
        .request({
          type: "step_end",
          key,
          outcome: { ok: false, reason: "internal", message },
        })
        .catch(() => {});
      throw error;
    }
    const ended = await port.request({
      type: "step_end",
      key,
      outcome: { ok: true, result: result === undefined ? null : result },
    });
    if (!ended.ok) {
      throw new Error(`step "${key}" failed to checkpoint: ${ended.message}`);
    }
    completedSteps.set(key, result);
    return result;
  }

  function agent(req: AgentRequest): Promise<Outcome<SoftOutput>> {
    const { key, stepKey } = resolvePrimitiveKey("agent", req.key);
    const { signal, key: _ignoredKey, step: explicitStep, mode, ...rest } = req;
    const stepName = explicitStep ?? stepKey;
    return requestCancellable<SoftOutput>(signal, (cancelId) => ({
      type: "agent",
      key,
      ...rest,
      mode: mode ?? "turn",
      ...(stepName !== undefined ? { step: stepName } : {}),
      ...(cancelId !== undefined ? { cancel_id: cancelId } : {}),
    }));
  }

  function human(req: HumanRequest): Promise<Outcome<SoftOutput>> {
    const { key, stepKey } = resolvePrimitiveKey("human", req.key);
    const {
      signal,
      key: _ignoredKey,
      step: explicitStep,
      with: target,
      ...rest
    } = req;
    const stepName = explicitStep ?? stepKey;
    return requestCancellable<SoftOutput>(signal, (cancelId) => ({
      type: "human",
      key,
      with: normalizeAgentAddress(target),
      ...rest,
      ...(stepName !== undefined ? { step: stepName } : {}),
      ...(cancelId !== undefined ? { cancel_id: cancelId } : {}),
    }));
  }

  function workflow(req: WorkflowRequest): Promise<Outcome<SoftOutput>> {
    const { key } = resolvePrimitiveKey("workflow", req.key);
    const { signal, key: _ignoredKey, ...rest } = req;
    return requestCancellable<SoftOutput>(signal, (cancelId) => ({
      type: "workflow",
      key,
      ...rest,
      ...(cancelId !== undefined ? { cancel_id: cancelId } : {}),
    }));
  }

  function tool<T = unknown>(req: ToolRequest): Promise<Outcome<T>> {
    const { key } = resolvePrimitiveKey("tool", req.key);
    const { signal, key: _ignoredKey, ...rest } = req;
    return requestCancellable<T>(signal, (cancelId) => ({
      type: "tool",
      key,
      ...rest,
      ...(cancelId !== undefined ? { cancel_id: cancelId } : {}),
    }));
  }

  function onEvent<T = unknown>(
    filter: EventFilter,
    handler: EventHandler<T>,
  ): () => void {
    if (
      typeof filter?.source !== "string" ||
      filter.source.trim() === "" ||
      typeof filter?.event !== "string" ||
      filter.event.trim() === ""
    ) {
      throw new Error("onEvent() requires non-empty source and event");
    }
    const subscriptionId = `sub_${++subSeq}`;
    let disposed = false;
    const unregister = port.registerEventListener(
      subscriptionId,
      (event: FlowEvent) => {
        if (disposed) return;
        try {
          const maybePromise = handler(event as FlowEvent<T>);
          if (
            maybePromise !== null &&
            typeof maybePromise === "object" &&
            "catch" in maybePromise &&
            typeof maybePromise.catch === "function"
          ) {
            void maybePromise.catch((error: unknown) => {
              console.error("flow: async event handler error:", error);
            });
          }
        } catch (error) {
          console.error("flow: event handler error:", error);
        }
      },
    );
    void port
      .request({
        type: "subscribe",
        subscription_id: subscriptionId,
        source: filter.source,
        event: filter.event,
        ...(filter.workspace !== undefined
          ? { workspace: filter.workspace }
          : {}),
      })
      .then((outcome) => {
        if (!outcome.ok) {
          console.error(
            `flow: onEvent(${filter.source}, ${filter.event}) subscribe failed: ${outcome.message}`,
          );
        }
      })
      .catch(() => {});

    return () => {
      if (disposed) return;
      disposed = true;
      unregister();
      void port
        .request({
          type: "unsubscribe",
          subscription_id: subscriptionId,
        })
        .catch(() => {});
    };
  }

  async function report(req: ReportRequest): Promise<Outcome<void>> {
    const out = await port.request({ type: "report", ...req });
    return out.ok ? { ok: true, result: undefined } : out;
  }

  async function escalate(req: EscalateRequest): Promise<Outcome<void>> {
    const out = await port.request({ type: "escalate", ...req });
    return out.ok ? { ok: true, result: undefined } : out;
  }

  return {
    step,
    agent,
    human,
    workflow,
    tool,
    onEvent,
    report,
    escalate,
  };
}

export type FlowRuntime = ReturnType<typeof createFlowRuntime>;
export type { Checkpoint };
