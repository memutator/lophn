// model 호출 한 번의 실제 HTTP 실행(architecture §5.2 invokeModelCall; provider#R19–R23,
// R25). 인증 부착은 AuthTransport 하나를 거친다. 호출은 한 번이다: SDK 숨은 retry는
// 없고 재시도는 run-loop가 새 ModelCall로 한다(R20). 응답은 두 길이다. 성공 SSE는
// protocol별 parser가 읽고, 그 밖의 응답(오류 status·JSON)은 상한 안 본문 한 덩어리로
// 읽어 failures.ts가 분류한다. 오류 본문 원문은 어디에도 남기지 않는다(R19).

import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ModelOutcome,
  TokenUsage,
} from "../../../contracts/lophn-agent/mod.ts";
import type { AuthTransport } from "./adapters/auth-transport.ts";
import { joinEndpoint, verifyStateFree } from "./adapters/compat.ts";
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
} from "./failures.ts";
import type {
  InvokeModelCall,
  ModelCallInput,
  ModelCallOutput,
} from "./work.ts";

const PATHS = {
  "anthropic-messages": "/messages",
  "openai-responses": "/responses",
  "openai-chat-completions": "/chat/completions",
} as const;

export const ANTHROPIC_VERSION = "2023-06-01";

export type InvokeDeps = {
  transport: AuthTransport;
  nowMs: () => number;
  // 지금 시각(ms)을 atSchema 꼴로 옮긴다.
  at: (ms: number) => string;
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
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  kind: "complete" | "partial" | "refused" | "failed";
  finishReason: string | null;
  errorType?: string;
  errorMessage?: string;
  providerCode: string | null;
};

type Collector = {
  push(frames: readonly SseFrame[]): void;
  finish(): Collected;
};

function collectorFor(
  protocol: ModelCallInput["model"]["protocol"],
): Collector {
  if (protocol === "anthropic-messages") {
    const out = createStreamResult();
    return {
      push: (frames) => applyFrames(out, frames),
      finish() {
        const verdict = judgeMessages(out);
        return {
          text: out.text,
          toolCalls: out.toolCalls.filter((call) => call !== undefined),
          usage: out.usage,
          kind: verdict.kind,
          finishReason: out.stopReason ?? null,
          errorType: out.errorType,
          errorMessage: out.errorMessage,
          providerCode: verdict.providerCode ?? null,
        };
      },
    };
  }
  if (protocol === "openai-responses") {
    const out = createResponsesStreamResult();
    return {
      push: (frames) => applyResponsesFrames(out, frames),
      finish() {
        const verdict = judgeResponses(out);
        return {
          text: out.text,
          toolCalls: out.toolCalls,
          usage: out.usage,
          kind: verdict.kind,
          finishReason: out.incompleteReason ?? out.responseStatus ?? null,
          errorType: out.errorType === "?" ? undefined : out.errorType,
          errorMessage: out.errorMessage,
          providerCode: verdict.providerCode ?? null,
        };
      },
    };
  }
  const out = createChatStreamResult();
  return {
    push: (frames) => applyChatFrames(out, frames),
    finish() {
      finishChatStream(out);
      completeToolCalls(out);
      const verdict = judgeChat(out);
      return {
        text: out.text,
        toolCalls: out.toolCalls.filter((call) => call !== undefined),
        usage: out.usage,
        kind: verdict.kind,
        finishReason: out.finishReason ?? null,
        errorType: out.errorType,
        errorMessage: out.errorMessage,
        providerCode: verdict.providerCode ?? null,
      };
    },
  };
}

function plainOutcome(
  kind: "complete" | "partial" | "cancelled" | "uncertain",
  status: number | null,
  finishReason: string | null,
): ModelOutcome {
  return {
    kind,
    code: null,
    retry_at: null,
    finish_reason: finishReason,
    http_status: status,
    provider_code: null,
  };
}

export function createInvokeModelCall(deps: InvokeDeps): InvokeModelCall {
  return async (input, signal): Promise<Result<ModelCallOutput>> => {
    // state-free 계속 검증의 실제 호출 자리다(질문 Q7). 불가면 보내지 않는다.
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
    const timeout = input.timeoutMs === null
      ? undefined
      : AbortSignal.timeout(input.timeoutMs);
    const combined = timeout === undefined
      ? signal
      : AbortSignal.any([signal, timeout]);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
    };
    if (input.model.protocol === "anthropic-messages") {
      headers["anthropic-version"] = ANTHROPIC_VERSION;
    }
    const sent = await deps.transport.send({
      url: joinEndpoint(input.endpoint, PATHS[input.model.protocol]),
      method: "POST",
      headers,
      body: JSON.stringify({ ...input.body, stream: true }),
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
        toolCalls: [],
        usage: emptyUsage(usageRevision),
        durationMs: deps.nowMs() - startedMs,
        firstOutputMs: null,
        ...extra,
      });
    const doneFailed = (
      verdict: FailureVerdict,
      extra: Partial<ModelCallOutput> = {},
    ): Result<ModelCallOutput> =>
      done(outcomeFromVerdict(verdict, deps.at), { ...extra, verdict });
    if (!sent.ok) {
      const how = sent.error.details?.transport;
      if (how === "aborted" || combined.aborted) {
        return done(abortOutcome(signal, null));
      }
      if (how === "connection_failed") {
        // 연결 실패는 일시 실패다(R20).
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
      return doneFailed(verdict);
    }
    const collector = collectorFor(input.model.protocol);
    let firstOutputMs: number | null = null;
    let disconnected = false;
    let over = false;
    if (response.stream === null) {
      // batch(JSON) 성공 응답이다. stream과 같은 collector로 판정한다.
      const frames = framesFromBatch(input.model.protocol, response.json);
      if (frames === null) {
        // 읽을 수 없는 성공 본문은 원인 불명이다.
        const verdict = classifyStreamFailure({ nowMs: deps.nowMs() });
        return doneFailed({ ...verdict, http_status: response.status });
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
    const usage = collected.usage ?? emptyUsage(usageRevision);
    const extra = {
      text: collected.text,
      toolCalls: collected.kind === "complete" ? collected.toolCalls : [],
      usage: { ...usage, definition_revision: usageRevision },
      firstOutputMs,
    };
    if (combined.aborted) {
      return done(abortOutcome(signal, collected.text.length > 0), extra);
    }
    if (collected.kind === "failed") {
      const verdict = classifyStreamFailure({
        type: collected.errorType,
        message: collected.errorMessage,
        nowMs: deps.nowMs(),
      });
      return doneFailed(verdict, extra);
    }
    if (collected.kind === "refused") {
      return done({
        kind: "failed",
        code: "refused",
        retry_at: null,
        finish_reason: collected.finishReason,
        http_status: response.status,
        provider_code: collected.providerCode,
      }, extra);
    }
    if (over) {
      // 크기 상한 초과는 일시가 아니라 응답 크기 문제다. 받은 것까지 partial이다.
      return done(
        plainOutcome("partial", response.status, collected.finishReason),
        extra,
      );
    }
    return done(
      plainOutcome(collected.kind, response.status, collected.finishReason),
      extra,
    );
  };
}

function abortOutcome(
  signal: AbortSignal,
  hadOutput: boolean | null,
): ModelOutcome {
  // 호출자가 멈췄으면 취소다. 기한이 지났으면 받은 것까지 partial, 아니면 연결 실패다.
  if (signal.aborted) return plainOutcome("cancelled", null, null);
  if (hadOutput === true) return plainOutcome("partial", null, null);
  return {
    kind: "failed",
    code: "temporary",
    retry_at: null,
    finish_reason: null,
    http_status: null,
    provider_code: null,
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
  };
}
