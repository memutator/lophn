import type { Result } from "../../../base/mod.ts";
import {
  type ModelChoice,
  modelDefaultRead,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type CommitMessageRequest,
  sourceControlMessageRequestDone,
  sourceControlMessageRequestTake,
} from "../../../protocol/projects/source-control.ts";
import type { ModelBinding } from "../../lophn-agent/models/binding.ts";
import {
  commitMessageRequest,
  parseCommitMessage,
} from "../../lophn-agent/prompt-assembly/commit-message.ts";
import {
  type RedactText,
  redactValue,
} from "../../lophn-agent/run-loop/blobs.ts";
import { type CoreCall, readOf } from "../../lophn-agent/run-loop/core-call.ts";

// Source Control의 AI 커밋 메시지를 lophn agent의 전역 기본 model로 짓는다(workflow 제목과 같은 길).
// core에는 외부 fetch가 없어 agent-runtime이 요청을 하나씩 가져와 model을 부르고 답을 돌려준다. 커밋은 사람이 한다.

const PUMP_IDLE_MS = 500;
const MESSAGE_TIMEOUT_MS = 45_000;

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

type ResolveModel = (input: {
  model: ModelChoice;
  purpose?: "judgment" | "organizing";
}) => Promise<Result<ModelBinding>>;

export async function generateCommitMessage(options: {
  call: CoreCall;
  resolveModel: ResolveModel;
  redact: RedactText;
  request: CommitMessageRequest;
  signal?: AbortSignal;
}): Promise<{ message: string | null; error: string | null }> {
  const { call, resolveModel, redact, request } = options;
  const def = await readOf(call, modelDefaultRead, {});
  if (!def.ok || def.value.default === null) {
    return { message: null, error: "no default model is set" };
  }
  const resolved = await resolveModel({
    model: def.value.default,
    purpose: "organizing",
  });
  if (!resolved.ok) return { message: null, error: resolved.error.message };
  const binding = resolved.value;
  const packed = binding.pack(
    commitMessageRequest({
      diff: request.diff,
      files: request.files,
      recentSubjects: request.recent_subjects,
    }),
  );
  const safeBody = await redactValue(redact, packed.body);
  if (!safeBody.ok) return { message: null, error: safeBody.error.message };
  const timeout = AbortSignal.timeout(MESSAGE_TIMEOUT_MS);
  const signal =
    options.signal === undefined
      ? timeout
      : AbortSignal.any([options.signal, timeout]);
  const invoked = await binding.invoke(
    {
      callId: `scm_msg_${request.request}`,
      turn: request.request,
      session: request.request,
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
  if (!invoked.ok) return { message: null, error: invoked.error.message };
  if (invoked.value.outcome.kind !== "complete") {
    return { message: null, error: "the model did not finish" };
  }
  return { message: parseCommitMessage(invoked.value.text), error: null };
}

export async function startCommitMessagePump(options: {
  call: CoreCall;
  resolveModel: ResolveModel;
  redact: RedactText;
  signal: AbortSignal;
}): Promise<void> {
  while (!options.signal.aborted) {
    let worked = false;
    try {
      const taken = await readOf(
        options.call,
        sourceControlMessageRequestTake,
        {},
      );
      const request = taken.ok ? taken.value.request : null;
      if (request !== null) {
        worked = true;
        const result = await generateCommitMessage({
          call: options.call,
          resolveModel: options.resolveModel,
          redact: options.redact,
          request,
          signal: options.signal,
        }).catch((error: unknown) => ({
          message: null,
          error: error instanceof Error ? error.message : "model call failed",
        }));
        await readOf(options.call, sourceControlMessageRequestDone, {
          request: request.request,
          message: result.message,
          error: result.error?.slice(0, 2000) ?? null,
        });
      }
    } catch {
      // 메시지 생성 실패는 사람의 호출이 시간 넘김으로 끝난다.
    }
    if (!worked) await abortableWait(PUMP_IDLE_MS, options.signal);
  }
}
