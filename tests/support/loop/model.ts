import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type {
  ModelAttempt,
  ModelCallRequest,
  TurnPorts,
} from "../../../packages/core/lophn-agent/run-loop/mod.ts";
import type { ModelOutcome } from "../../../packages/protocol/lophn-agent/mod.ts";

// loop의 model 자리에 끼는 scripted model이다. provider wire를 모르고 정규화한 결과를 순서대로 낸다.
// model 호출은 loop의 judgment 하나뿐이다(요약·제목은 loop 밖에서 부른다). 그래서 줄이 하나다.

type ToolCall = { id: string; name: string; args: string };
type FailureCode = NonNullable<ModelOutcome["code"]>;
type VerdictPath = NonNullable<
  NonNullable<ModelOutcome["evidence"]>["verdict_path"]
>;

export type Step =
  | { kind: "answer"; text: string }
  | { kind: "tools"; calls: ToolCall[]; text: string }
  | {
      kind: "partial";
      text: string;
      finish_reason: string | null;
      calls: ToolCall[];
    }
  | {
      kind: "failed";
      code: FailureCode;
      retry_at: string | null;
      verdict_path: VerdictPath | null;
    }
  | { kind: "hang" };

export const answer = (text: string): Step => ({ kind: "answer", text });

export const tools = (calls: ToolCall[], text = ""): Step => ({
  kind: "tools",
  calls,
  text,
});

// calls는 실제 adapter가 내지 않는 모양이다. loop가 무시하는지 보려고 허용한다.
export const partial = (
  opts: { text?: string; finish_reason?: string; calls?: ToolCall[] } = {},
): Step => ({
  kind: "partial",
  text: opts.text ?? "",
  finish_reason: opts.finish_reason ?? null,
  calls: opts.calls ?? [],
});

export const failed = (opts: {
  code: FailureCode;
  retry_at?: string;
  verdict_path?: VerdictPath;
}): Step => ({
  kind: "failed",
  code: opts.code,
  retry_at: opts.retry_at ?? null,
  verdict_path: opts.verdict_path ?? null,
});

// signal이 중단될 때만 cancelled로 돌아온다.
export const hang = (): Step => ({ kind: "hang" });

function outcome(
  kind: ModelOutcome["kind"],
  extra: Partial<ModelOutcome> = {},
): ModelOutcome {
  return {
    kind,
    code: null,
    retry_at: null,
    finish_reason: null,
    http_status: null,
    provider_code: null,
    ...extra,
  };
}

export type ScriptedModel = ReturnType<typeof scriptedModel>;

export function scriptedModel(steps: readonly Step[]) {
  const requests: ModelCallRequest[] = [];
  const signals: AbortSignal[] = [];
  const waiters: { n: number; resolve: () => void }[] = [];
  let overflow = 0;
  let availableNow = true;

  function attemptOf(
    n: number,
    result: ModelOutcome,
    text = "",
    toolCalls: ToolCall[] = [],
  ): Result<ModelAttempt> {
    return ok({ id: `mcl_${n}`, outcome: result, text, toolCalls });
  }

  const port: TurnPorts["model"] = {
    pack: (request) => ({ body: request, opaque_bytes: 0 }),
    available: () => Promise.resolve(availableNow),
    call(request, signal) {
      const n = requests.length;
      requests.push(structuredClone(request));
      signals.push(signal);
      for (const waiter of waiters) if (waiter.n <= n + 1) waiter.resolve();
      const step = steps[n];
      if (step === undefined) {
        overflow += 1;
        return Promise.resolve(
          err({ code: "internal", message: "scripted model has no step left" }),
        );
      }
      switch (step.kind) {
        case "answer":
          return Promise.resolve(
            attemptOf(
              n,
              outcome("complete", { finish_reason: "end_turn" }),
              step.text,
            ),
          );
        case "tools":
          return Promise.resolve(
            attemptOf(
              n,
              outcome("complete", { finish_reason: "tool_use" }),
              step.text,
              step.calls,
            ),
          );
        case "partial":
          return Promise.resolve(
            attemptOf(
              n,
              outcome("partial", { finish_reason: step.finish_reason }),
              step.text,
              step.calls,
            ),
          );
        case "failed":
          return Promise.resolve(
            attemptOf(
              n,
              outcome("failed", {
                code: step.code,
                retry_at: step.retry_at,
                ...(step.verdict_path === null
                  ? {}
                  : {
                      evidence: {
                        verdict_path: step.verdict_path,
                        content_type: null,
                        request_id: null,
                        unknown_events: [],
                      },
                    }),
              }),
            ),
          );
        case "hang":
          return new Promise((resolve) => {
            const cancel = () => resolve(attemptOf(n, outcome("cancelled")));
            if (signal.aborted) cancel();
            else signal.addEventListener("abort", cancel, { once: true });
          });
      }
    },
  };

  const messagesOf = (i: number) => requests[i].prompt.request.messages;

  return {
    port,
    requests,
    signals,
    setAvailable(on: boolean) {
      availableNow = on;
    },
    // n번째(1부터) 호출이 들어온 때 풀린다. 무응답 중에 멈춤을 걸 때 sleep 대신 쓴다.
    arrived(n: number): Promise<void> {
      if (requests.length >= n) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ n, resolve }));
    },
    toolNames(i: number): string[] {
      return requests[i].prompt.request.tools.map((tool) => tool.name);
    },
    systemText(i: number): string {
      return requests[i].prompt.request.system
        .map((block) => block.text)
        .join("\n");
    },
    lastToolResult(i: number): { id: string; text: string } | undefined {
      const results = messagesOf(i).flatMap((message) =>
        message.parts.flatMap((part) =>
          part.kind === "tool_result" ? [{ id: part.id, text: part.text }] : [],
        ),
      );
      return results[results.length - 1];
    },
    userTexts(i: number): string[] {
      return messagesOf(i).flatMap((message) =>
        message.role !== "user"
          ? []
          : message.parts.flatMap((part) =>
              part.kind === "text" ? [part.text] : [],
            ),
      );
    },
    // step이 남았거나 호출이 더 왔으면 실패한다.
    finish(): void {
      if (requests.length - overflow < steps.length) {
        throw new Error(
          `scripted model: ${
            steps.length - (requests.length - overflow)
          } step(s) left unused`,
        );
      }
      if (overflow > 0) {
        throw new Error(
          `scripted model: ${overflow} call(s) beyond the script`,
        );
      }
    },
  };
}
