// model 호출 한 번의 실제 HTTP 실행.
// 인증 부착은 AuthTransport 하나를 거친다. 호출은 한 번이다: SDK 숨은 retry는
// 없고 재시도는 run-loop가 새 ModelCall로 한다. 응답은 두 길이다. 성공 SSE는
// protocol별 parser가 읽고, 그 밖의 응답(오류 status·JSON)은 상한 안 본문 한 덩어리로
// 읽어 failures.ts가 분류한다. 오류 본문 원문은 어디에도 남기지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ModelOutcome,
  TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthTransport } from "./adapters/auth-transport.ts";
import {
  applyCloudCodeFrames,
  createCloudCodeStreamResult,
  judgeCloudCode,
} from "./adapters/cloud-code.ts";
import {
  joinEndpoint,
  type ShapedCall,
  verifyStateFree,
} from "./adapters/compat.ts";
import {
  applyChatFrames,
  completeToolCalls,
  createChatStreamResult,
  finishChatStream,
  judgeChat,
} from "./adapters/chat-completions.ts";
import {
  applyFrames,
  createStreamResult,
  judge as judgeMessages,
  type ToolCall,
} from "./adapters/messages.ts";
import {
  applyResponsesFrames,
  createResponsesStreamResult,
  judgeResponses,
} from "./adapters/responses.ts";
import { framesFromBatch } from "./adapters/batch.ts";
import { createSseParser, type SseFrame } from "./adapters/stream.ts";
import {
  classifyHttpFailure,
  classifyStreamFailure,
  type FailureVerdict,
  outcomeFromVerdict,
  type ResponseFacts,
  responseFacts,
} from "./failures.ts";
import type {
  InvokeModelCall,
  ModelCallInput,
  ModelCallOutput,
  ModelOutputDelta,
} from "./work.ts";

// shape 없이 보낼 때의 경로다. Gemini wire는 model 이름이 경로에 들어가 shape만 주소를 만든다.
const PATHS: Partial<Record<ModelCallInput["model"]["protocol"], string>> = {
  "anthropic-messages": "/messages",
  "openai-responses": "/responses",
  "openai-chat-completions": "/chat/completions",
  "cloud-code-assist": "/v1internal:streamGenerateContent?alt=sse",
};

const ANTHROPIC_VERSION = "2023-06-01";

// 호출 하나가 byte를 한 번도 받지 못하는 시간의 상한이다. 제품 동작이라 설정 key로 열지 않는다.
export const MODEL_IDLE_MS = 120_000;

export type IdleTimer = (
  ms: number,
  signal: AbortSignal,
) => Promise<"elapsed" | "aborted">;

export type IdleDeps = { ms?: number; timer?: IdleTimer };

type InvokeDeps = {
  transport: AuthTransport;
  nowMs: () => number;
  // 지금 시각(ms)을 atSchema 꼴로 옮긴다.
  at: (ms: number) => string;
  idle?: IdleDeps;
  // 구독 client profile이 보내기 직전 요청을 다시 만든다(Claude Code). 없으면 packer의 body를 그대로 보낸다.
  shape?: (input: {
    endpoint: string;
    session: string | null;
    body: Record<string, unknown>;
  }) => ShapedCall | null;
};

function emptyUsage(revision: string): TokenUsage {
  return {
    input: null,
    output: null,
    cache_read: null,
    cache_write: null,
    reasoning: null,
    cache_in_input: null,
    reasoning_in_output: null,
    definition_revision: revision,
  };
}

type Collected = {
  text: string;
  reasoning: string | null;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  kind: "complete" | "partial" | "refused" | "failed";
  finishReason: string | null;
  errorType?: string;
  errorMessage?: string;
  providerCode: string | null;
  unknownEvents: string[];
};

type Collector = {
  push(frames: readonly SseFrame[]): void;
  finish(): Collected;
};

function collectorFor(
  protocol: ModelCallInput["model"]["protocol"],
  onDelta?: (delta: ModelOutputDelta) => void,
): Collector {
  // 세 adapter와 batch 성공 응답이 같은 push를 지난다. push 앞뒤로 결과의 text·reasoning
  // 길이를 재서 늘어난 조각을 넘긴다. reasoning은 block의 시작·끝도 빈 조각으로 넘긴다:
  // 읽을 글 없이 암호화만 온 reasoning도 시간을 재게 한다. adapter file은 고치지 않는다.
  function pushInto(
    out: { text: string; reasoning: string | null },
    apply: (frames: readonly SseFrame[]) => void,
    // Chat Completions에는 block 경계가 없다. 마지막 reasoning delta가 끝이다.
    ended?: () => boolean,
  ): (frames: readonly SseFrame[]) => void {
    return (frames) => {
      const before = out.text.length;
      // -1은 reasoning이 아직 없었다는 뜻이다.
      const reasoningBefore = out.reasoning?.length ?? -1;
      const endedBefore = ended?.() ?? false;
      apply(frames);
      if (onDelta === undefined) return;
      if (out.text.length > before) {
        onDelta({ kind: "text", text: out.text.slice(before) });
      }
      if (out.reasoning === null) return;
      if (reasoningBefore < 0) {
        onDelta({ kind: "reasoning", text: out.reasoning });
      } else if (out.reasoning.length > reasoningBefore) {
        onDelta({
          kind: "reasoning",
          text: out.reasoning.slice(reasoningBefore),
        });
      }
      if (ended !== undefined && !endedBefore && ended()) {
        onDelta({ kind: "reasoning", text: "" });
      }
    };
  }
  if (protocol === "anthropic-messages") {
    const out = createStreamResult();
    return {
      push: pushInto(
        out,
        (frames) => applyFrames(out, frames),
        () => out.reasoningEnded,
      ),
      finish() {
        const verdict = judgeMessages(out);
        return {
          text: out.text,
          reasoning: out.reasoning,
          toolCalls: out.toolCalls.filter((call) => call !== undefined),
          usage: out.usage,
          kind: verdict.kind,
          finishReason: out.stopReason ?? null,
          errorType: out.errorType,
          errorMessage: out.errorMessage,
          providerCode: verdict.providerCode ?? null,
          unknownEvents: out.unknownEvents,
        };
      },
    };
  }
  if (protocol === "openai-responses") {
    const out = createResponsesStreamResult();
    return {
      push: pushInto(
        out,
        (frames) => applyResponsesFrames(out, frames),
        () => out.reasoningEnded,
      ),
      finish() {
        const verdict = judgeResponses(out);
        return {
          text: out.text,
          reasoning: out.reasoning,
          toolCalls: out.toolCalls,
          usage: out.usage,
          kind: verdict.kind,
          finishReason: out.incompleteReason ?? out.responseStatus ?? null,
          errorType: out.errorType === "?" ? undefined : out.errorType,
          errorMessage: out.errorMessage,
          providerCode: verdict.providerCode ?? null,
          unknownEvents: out.unknownEvents,
        };
      },
    };
  }
  // Gemini API frame은 Cloud Code frame에서 `response` 겉봉만 없는 같은 GenerateContentResponse다.
  if (
    protocol === "cloud-code-assist" ||
    protocol === "gemini-generate-content"
  ) {
    const out = createCloudCodeStreamResult();
    return {
      push: pushInto(
        out,
        (frames) => applyCloudCodeFrames(out, frames),
        () => out.reasoningEnded,
      ),
      finish() {
        const verdict = judgeCloudCode(out);
        return {
          text: out.text,
          reasoning: out.reasoning,
          toolCalls: out.toolCalls,
          usage: out.usage,
          kind: verdict.kind,
          finishReason: out.finishReason ?? null,
          errorType: out.errorType,
          errorMessage: out.errorMessage,
          providerCode: verdict.providerCode ?? null,
          unknownEvents: [],
        };
      },
    };
  }
  const out = createChatStreamResult();
  return {
    push: pushInto(out, (frames) => applyChatFrames(out, frames)),
    finish() {
      finishChatStream(out);
      completeToolCalls(out);
      const verdict = judgeChat(out);
      return {
        text: out.text,
        reasoning: out.reasoning,
        toolCalls: out.toolCalls.filter((call) => call !== undefined),
        usage: out.usage,
        kind: verdict.kind,
        finishReason: out.finishReason ?? null,
        errorType: out.errorType,
        errorMessage: out.errorMessage,
        providerCode: verdict.providerCode ?? null,
        unknownEvents: out.unknownEvents,
      };
    },
  };
}

function timeoutTimer(
  ms: number,
  signal: AbortSignal,
): Promise<"elapsed" | "aborted"> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve("elapsed"), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        resolve("aborted");
      },
      { once: true },
    );
  });
}

// 호출 하나의 idle 기한이다. touch()가 기한을 새로 걸고(이전 기한은 접는다), 기한이 차면 signal이
// abort된다. 사람의 signal과 합쳐 쓰므로 어느 쪽이 끊었는지는 호출자 signal로 가른다.
function startIdle(deps: IdleDeps | undefined, human: AbortSignal) {
  const ms = deps?.ms ?? MODEL_IDLE_MS;
  const timer = deps?.timer ?? timeoutTimer;
  const expired = new AbortController();
  let current: AbortController | undefined;
  return {
    signal: AbortSignal.any([human, expired.signal]),
    touch() {
      current?.abort();
      const mine = new AbortController();
      current = mine;
      void timer(ms, mine.signal).then((result) => {
        if (result === "elapsed" && current === mine) expired.abort();
      });
    },
    stop: () => current?.abort(),
  };
}

function plainOutcome(
  kind: "complete" | "partial" | "cancelled" | "uncertain",
  status: number | null,
  finishReason: string | null,
  seen?: ResponseFacts,
): ModelOutcome {
  return {
    kind,
    code: null,
    retry_at: null,
    finish_reason: finishReason,
    http_status: status,
    provider_code: null,
    ...(seen === undefined
      ? {}
      : { evidence: { verdict_path: null, ...seen } }),
  };
}

export function createInvokeModelCall(deps: InvokeDeps): InvokeModelCall {
  return async (input, signal) => {
    const idle = startIdle(deps.idle, signal);
    try {
      return await invoke(deps, input, signal, idle);
    } finally {
      idle.stop();
    }
  };
}

async function invoke(
  deps: InvokeDeps,
  input: ModelCallInput,
  signal: AbortSignal,
  idle: ReturnType<typeof startIdle>,
): Promise<Result<ModelCallOutput>> {
  // state-free 계속 검증의 실제 호출 자리다. 불가면 보내지 않는다.
  if (
    input.continuation !== undefined &&
    input.model.protocol !== "anthropic-messages"
  ) {
    const verdict = verifyStateFree({
      protocol: input.model.protocol,
      pendingReasoning: input.continuation.pendingReasoning,
      reasoningRequired: input.continuation.reasoningRequired,
    });
    if (!verdict.continuable) {
      return err({
        code: "conflict",
        message: "state-free continuation is not possible",
      });
    }
  }
  const id = input.callId;
  const startedMs = deps.nowMs();
  const combined = idle.signal;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (input.model.protocol === "anthropic-messages") {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  }
  const shaped =
    deps.shape?.({
      endpoint: input.endpoint,
      session: input.session,
      body: input.body,
    }) ?? null;
  const path = PATHS[input.model.protocol];
  if ((deps.shape !== undefined || path === undefined) && shaped === null) {
    return err({ code: "internal", message: "요청 본문을 만들지 못했다" });
  }
  idle.touch();
  const sent = await deps.transport.send({
    url: shaped?.url ?? joinEndpoint(input.endpoint, path!),
    method: "POST",
    headers: shaped?.headers ?? headers,
    body: shaped?.body ?? JSON.stringify({ ...input.body, stream: true }),
    signal: combined,
  });
  const usageRevision = input.usageRevision;
  const done = (
    outcome: ModelOutcome,
    extra: Partial<ModelCallOutput> = {},
  ): Result<ModelCallOutput> =>
    ok({
      id,
      outcome,
      text: "",
      reasoning: null,
      toolCalls: [],
      usage: emptyUsage(usageRevision),
      durationMs: deps.nowMs() - startedMs,
      firstOutputMs: null,
      ...extra,
    });
  const doneFailed = (
    verdict: FailureVerdict,
    extra: Partial<ModelCallOutput> = {},
    seen?: ResponseFacts,
  ): Result<ModelCallOutput> =>
    done(outcomeFromVerdict(verdict, deps.at, seen), { ...extra, verdict });
  if (!sent.ok) {
    const how = sent.error.details?.transport;
    if (how === "aborted" || combined.aborted) {
      return done(abortOutcome(signal));
    }
    if (how === "connection_failed") {
      // 연결 실패는 일시 실패다.
      return doneFailed(classifyHttpFailureDisconnect());
    }
    // 보내기 전에 막혔다(secret 부착 거절 등). 모델 시도가 아니다.
    return sent;
  }
  const response = sent.value;
  if (response.stream === null && response.status >= 300) {
    const verdict = classifyHttpFailure({
      status: response.status,
      headers: response.headers,
      body: response.json,
      nowMs: deps.nowMs(),
    });
    // 본문은 여기서 버린다.
    return doneFailed(verdict, {}, responseFacts(response.headers, []));
  }
  const collector = collectorFor(input.model.protocol, input.onDelta);
  let firstOutputMs: number | null = null;
  let disconnected = false;
  let over = false;
  if (response.stream === null) {
    // batch(JSON) 성공 응답이다. stream과 같은 collector로 판정한다.
    const frames = framesFromBatch(input.model.protocol, response.json);
    if (frames === null) {
      // 읽을 수 없는 성공 본문은 원인 불명이다.
      const verdict = classifyStreamFailure({ nowMs: deps.nowMs() });
      return doneFailed(
        {
          ...verdict,
          http_status: response.status,
          path: "unparseable_success_body",
        },
        {},
        responseFacts(response.headers, []),
      );
    }
    firstOutputMs = deps.nowMs() - startedMs;
    collector.push(frames);
  } else {
    const parser = createSseParser();
    const reader = response.stream.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        idle.touch();
        const pushed = parser.push(next.value);
        if (!pushed.ok) {
          over = true;
          break;
        }
        if (pushed.frames.length > 0) {
          if (firstOutputMs === null) {
            firstOutputMs = deps.nowMs() - startedMs;
          }
          collector.push(pushed.frames);
        }
      }
    } catch {
      disconnected = true;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!disconnected && !over) parser.finish();
  }
  const collected = collector.finish();
  const seen = responseFacts(response.headers, collected.unknownEvents);
  const usage = collected.usage ?? emptyUsage(usageRevision);
  const extra = {
    text: collected.text,
    reasoning: collected.reasoning,
    toolCalls:
      collected.kind === "complete"
        ? collected.toolCalls.map((call) =>
            shaped === null
              ? call
              : { ...call, name: shaped.toolName(call.name) },
          )
        : [],
    usage: { ...usage, definition_revision: usageRevision },
    firstOutputMs,
  };
  if (combined.aborted) {
    return done(abortOutcome(signal), extra);
  }
  if (collected.kind === "failed") {
    const verdict = classifyStreamFailure({
      type: collected.errorType,
      message: collected.errorMessage,
      nowMs: deps.nowMs(),
    });
    return doneFailed(verdict, extra, seen);
  }
  if (collected.kind === "refused") {
    return done(
      {
        kind: "failed",
        code: "refused",
        retry_at: null,
        finish_reason: collected.finishReason,
        http_status: response.status,
        provider_code: collected.providerCode,
        evidence: { verdict_path: null, ...seen },
      },
      extra,
    );
  }
  if (over) {
    // 크기 상한 초과는 일시가 아니라 응답 크기 문제다. 받은 것까지 partial이다.
    return done(
      plainOutcome("partial", response.status, collected.finishReason, seen),
      extra,
    );
  }
  return done(
    plainOutcome(collected.kind, response.status, collected.finishReason, seen),
    extra,
  );
}

function abortOutcome(signal: AbortSignal): ModelOutcome {
  // 호출자가 멈췄으면 취소다. idle 기한이 찼으면 받은 글이 있어도 일시 실패다.
  if (signal.aborted) return plainOutcome("cancelled", null, null);
  return {
    kind: "failed",
    code: "temporary",
    retry_at: null,
    finish_reason: null,
    http_status: null,
    provider_code: null,
    evidence: {
      verdict_path: "idle_timeout",
      content_type: null,
      request_id: null,
      unknown_events: [],
    },
  };
}

function classifyHttpFailureDisconnect(): FailureVerdict {
  return {
    code: "temporary",
    retry_at_ms: null,
    until_ms: null,
    unavailable_reason: null,
    finish_reason: null,
    http_status: null,
    provider_code: null,
    path: "connection_failed",
  };
}
