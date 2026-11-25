import type { Result } from "../../../base/mod.ts";
import {
  type ModelChoice,
  modelDefaultRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type WorkflowTitleRequest,
  workflowInstanceSetAiTitle,
  workflowTitleRequestTake,
} from "../../../protocol/workflows/mod.ts";
import type { ModelBinding } from "../../lophn-agent/models/binding.ts";
import {
  parseSessionTitle,
  workflowTitleRequest,
} from "../../lophn-agent/prompt-assembly/title.ts";
import {
  type RedactText,
  redactValue,
} from "../../lophn-agent/run-loop/blobs.ts";
import {
  type CoreCall,
  commandOf,
  readOf,
} from "../../lophn-agent/run-loop/core-call.ts";

// 새로 시작된 workflow instance의 제목을 전역 기본 model(model-default)로 짓는다.
// core에는 외부 fetch가 없어 agent-runtime이 요청을 하나씩 가져와 model을 부르고
// SetWorkflowInstanceAiTitle로 기록한다. 실패하거나 기본 model이 없으면 자동 제목이 그대로 남는다.

const TITLE_PUMP_IDLE_MS = 500;
const TITLE_TIMEOUT_MS = 15_000;

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function generateWorkflowTitle(options: {
  call: CoreCall;
  resolveModel: (input: {
    model: ModelChoice;
    purpose?: "judgment" | "organizing";
  }) => Promise<Result<ModelBinding>>;
  redact: RedactText;
  request: WorkflowTitleRequest;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { call, resolveModel, redact, request } = options;
  const def = await readOf(call, modelDefaultRead, {});
  if (!def.ok || def.value.default === null) return null;
  const resolved = await resolveModel({
    model: def.value.default,
    purpose: "organizing",
  });
  if (!resolved.ok) return null;
  const binding = resolved.value;
  const prompt = workflowTitleRequest({
    workflow: request.workflow,
    input: request.input,
    ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
  });
  const packed = binding.pack(prompt);
  const safeBody = await redactValue(redact, packed.body);
  if (!safeBody.ok) return null;
  const timeout = AbortSignal.timeout(TITLE_TIMEOUT_MS);
  const signal =
    options.signal === undefined
      ? timeout
      : AbortSignal.any([options.signal, timeout]);
  const invoked = await binding.invoke(
    {
      callId: `wfi_title_${request.instance}`,
      turn: request.instance,
      session: request.instance,
      purpose: "organizing",
      model: binding.call,
      endpoint: binding.endpoint,
      inputHash: "",
      contextBasisHash: "",
      body: safeBody.value as Record<string, unknown>,
      usageRevision: binding.usageRevision,
    },
    signal,
  );
  if (!invoked.ok || invoked.value.outcome.kind !== "complete") return null;
  const title = parseSessionTitle(invoked.value.text);
  if (title === null) return null;
  await commandOf(
    call,
    workflowInstanceSetAiTitle,
    {
      instance: request.instance,
      expected: request.expected,
      title,
    },
    {},
    `${request.instance}:ai-title`,
  );
  return title;
}

export async function startWorkflowTitlePump(options: {
  call: CoreCall;
  resolveModel: (input: {
    model: ModelChoice;
    purpose?: "judgment" | "organizing";
  }) => Promise<Result<ModelBinding>>;
  redact: RedactText;
  signal: AbortSignal;
  idleMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const idleMs = options.idleMs ?? TITLE_PUMP_IDLE_MS;
  const wait = options.wait ?? abortableWait;
  while (!options.signal.aborted) {
    let worked = false;
    try {
      const taken = await readOf(options.call, workflowTitleRequestTake, {});
      const request = taken.ok ? taken.value.request : null;
      if (request !== null) {
        worked = true;
        await generateWorkflowTitle({
          call: options.call,
          resolveModel: options.resolveModel,
          redact: options.redact,
          request,
          signal: options.signal,
        });
      }
    } catch {
      // 제목 생성 실패는 workflow 실행에 영향을 주지 않는다.
    }
    if (!worked) await wait(idleMs, options.signal);
  }
}
