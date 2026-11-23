// core 밖 SDK helper: 실패한 Outcome을 on-demand fallback agent에게 넘겨
// retry | substitute | throw | escalate 중 하나를 결정하고 실행한다.
import type {
  AgentAddress,
  AgentRequest,
  EscalateRequest,
  Outcome,
  SoftOutput,
} from "./wire.ts";

export type FallbackDecision<T> =
  | { action: "retry"; input?: unknown; reason?: string }
  | { action: "substitute"; result: T; reason?: string }
  | { action: "throw"; message?: string }
  | { action: "escalate"; step?: string; reason?: string };

export type WithFallbackOptions<T> = {
  fallbackAgent: AgentAddress;
  context?: string | Record<string, unknown>;
  retry?: (hint?: unknown) => Promise<Outcome<T>> | Outcome<T>;
  step?: string;
  key?: string;
  signal?: AbortSignal;
};

export type FallbackDeps = {
  agent: (req: AgentRequest) => Promise<Outcome<SoftOutput>>;
  escalate: (req: EscalateRequest) => Promise<Outcome<void>>;
};

const FALLBACK_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["retry", "substitute", "throw", "escalate"],
    },
    input: {},
    result: {},
    message: { type: "string" },
    step: { type: "string" },
    reason: { type: "string" },
  },
};

const FALLBACK_PROMPT = [
  "A workflow primitive failed. Inspect the failed outcome and context in Input and decide how to recover.",
  'Reply with a single JSON object with "action" set to one of:',
  '- "retry": retry the operation (optional "input" hint, only when canRetry is true).',
  '- "substitute": return a replacement value in "result".',
  '- "throw": abort the flow by throwing an error (optional "message").',
  '- "escalate": pause for a human decision (optional "step" and "reason").',
].join("\n");

function parseDecisionObject<T>(raw: unknown): FallbackDecision<T> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const action = obj["action"];
  if (action === "retry") {
    return {
      action: "retry",
      ...("input" in obj ? { input: obj["input"] } : {}),
      ...(typeof obj["reason"] === "string" ? { reason: obj["reason"] } : {}),
    };
  }
  if (action === "substitute" && "result" in obj) {
    return {
      action: "substitute",
      result: obj["result"] as T,
      ...(typeof obj["reason"] === "string" ? { reason: obj["reason"] } : {}),
    };
  }
  if (action === "throw") {
    return {
      action: "throw",
      ...(typeof obj["message"] === "string"
        ? { message: obj["message"] }
        : {}),
    };
  }
  if (action === "escalate") {
    return {
      action: "escalate",
      ...(typeof obj["step"] === "string" ? { step: obj["step"] } : {}),
      ...(typeof obj["reason"] === "string" ? { reason: obj["reason"] } : {}),
    };
  }
  return null;
}

function extractDecision<T>(output: SoftOutput): FallbackDecision<T> | null {
  if (output.data !== undefined) {
    const fromData = parseDecisionObject<T>(output.data);
    if (fromData !== null) return fromData;
  }
  const text = output.summary.trim();
  if (text === "") return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1]?.trim(), text].filter(
    (s): s is string => s !== undefined && s !== "",
  );
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const decision = parseDecisionObject<T>(parsed);
      if (decision !== null) return decision;
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(candidate.slice(start, end + 1));
          const decision = parseDecisionObject<T>(parsed);
          if (decision !== null) return decision;
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

export async function runWithFallback<T>(
  deps: FallbackDeps,
  outcome: Outcome<T>,
  opts: WithFallbackOptions<T>,
): Promise<Outcome<T>> {
  if (outcome.ok) return outcome;

  const decisionOutcome = await deps.agent({
    agent: opts.fallbackAgent,
    mode: "turn",
    prompt: FALLBACK_PROMPT,
    input: {
      failed: {
        reason: outcome.reason,
        message: outcome.message,
        ...(outcome.session !== undefined ? { session: outcome.session } : {}),
      },
      ...(opts.context !== undefined ? { context: opts.context } : {}),
      canRetry: opts.retry !== undefined,
    },
    schema: FALLBACK_SCHEMA,
    ...(opts.key !== undefined ? { key: opts.key } : {}),
    ...(opts.step !== undefined ? { step: opts.step } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });

  if (!decisionOutcome.ok) return decisionOutcome;

  const decision = extractDecision<T>(decisionOutcome.result);
  if (decision === null) {
    return {
      ok: false,
      reason: "invalid_input",
      message: "fallback agent returned an invalid recovery decision",
    };
  }

  switch (decision.action) {
    case "retry": {
      if (opts.retry === undefined) {
        return {
          ok: false,
          reason: outcome.reason,
          message: `fallback chose retry without a retry handler: ${outcome.message}`,
          ...(outcome.session !== undefined
            ? { session: outcome.session }
            : {}),
        };
      }
      return await opts.retry(decision.input);
    }
    case "substitute":
      return { ok: true, result: decision.result };
    case "throw":
      throw new Error(decision.message ?? outcome.message);
    case "escalate": {
      const reason = decision.reason ?? outcome.message;
      const step = decision.step ?? opts.step ?? "fallback";
      const escalated = await deps.escalate({ step, reason });
      if (!escalated.ok) return escalated;
      return {
        ok: false,
        reason: outcome.reason,
        message: reason,
        ...(outcome.session !== undefined ? { session: outcome.session } : {}),
      };
    }
  }
}
