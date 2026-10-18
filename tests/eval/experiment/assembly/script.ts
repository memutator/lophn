import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import type { Reply } from "../../../support/fake-server/mod.ts";
import type { TrialRecord } from "../../types.ts";

export type ReplayScript = {
  session: string;
  requests: unknown[];
  replies: Reply[];
};

type Block = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

const refuse = (message: string) =>
  err({ code: "invalid_input" as const, message });

// call k의 답은 call k+1 요청의 마지막 assistant message에 들어 있다(history에 붙는다).
function replyFrom(next: unknown): Reply {
  const messages =
    (next as { messages?: { role?: string; content?: unknown }[] })
      .messages ?? [];
  const last = messages.findLast((m) => m.role === "assistant");
  const content = last?.content;
  const blocks: Block[] = typeof content === "string"
    ? [{ type: "text", text: content }]
    : Array.isArray(content)
    ? content as Block[]
    : [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "")
    .join("");
  const calls = blocks.filter((b) => b.type === "tool_use").map((b) => ({
    id: b.id ?? "",
    name: b.name ?? "",
    arguments: JSON.stringify(b.input ?? {}),
  }));
  if (calls.length > 0) {
    return text === ""
      ? { kind: "tool", calls }
      : { kind: "tool", calls, text };
  }
  return { kind: "text", text: text === "" ? "(empty)" : text };
}

// 재생할 수 있는 trial이면 fake에 줄 답을 만든다. 아니면 이유를 err로 낸다.
export function scriptOf(trial: TrialRecord): Result<ReplayScript> {
  if (trial.settle.kind !== "idle") {
    return refuse(`trial did not settle idle (${trial.settle.kind})`);
  }
  const sessions = trial.sessions.filter((s) => s.model_calls.length > 0);
  if (sessions.length !== 1) {
    // 요청에 session을 가르는 값이 없어 fake가 어느 session의 요청인지 모른다.
    return refuse(
      `${sessions.length} sessions got model calls; replay needs exactly one`,
    );
  }
  const session = sessions[0];
  for (const { call, request } of session.model_calls) {
    const bad = call.purpose !== "judgment"
      ? `purpose ${call.purpose}`
      : call.state !== "finished" || call.outcome?.kind !== "complete"
      ? `outcome ${call.outcome?.kind ?? call.state}`
      : call.attempt_kind !== "initial"
      ? "retry attempt"
      : request === null
      ? "request body not collected"
      : null;
    if (bad !== null) return refuse(`call ${call.id}: ${bad}`);
  }
  const requests = session.model_calls.map((c) => c.request);
  if (requests.length < 2) {
    return refuse("only one model call; nothing to compare with");
  }
  const replies: Reply[] = requests.map((_, k) =>
    k + 1 < requests.length
      ? replyFrom(requests[k + 1])
      : { kind: "text", text: "done" }
  );
  return ok({ session: session.session, requests, replies });
}
