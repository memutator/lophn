// 사람의 결정을 route로 보낸다. 항목을 목록에서 빼는 것은 이 호출이 아니라 PermissionResolved·QuestionResolved와
// snapshot 읽기다. 대화 쪽 core source도 같은 호출을 쓴다.
import {
  approvalsDecide,
  approvalsDecideTurn,
  type PendingApproval,
  type TurnChoice,
} from "../../../../../protocol/approvals/mod.ts";
import {
  type AskAnswer,
  askAnswer,
  type AskQuestion,
  askRead,
} from "../../../../../protocol/lophn-agent/ask-tool.ts";
import type { CoreSource } from "../connection.ts";
import type { WaitingEntry } from "../events/waiting-store.ts";

export type WaitingChoice = TurnChoice["kind"];

/** 결정 직후 남는 줄의 상태. 접수와 적용 성공을 구별한다. */
export type SettledState =
  | "accepted"
  | "applied"
  | "failed"
  | "denied"
  | "cancelled";

export type DecideResult =
  | { readonly ok: true; readonly state: SettledState }
  | { readonly ok: false; readonly code: string };

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

function settledOfPending(request: PendingApproval): SettledState {
  if (request.status === "reject") return "denied";
  if (request.status === "cancelled") return "cancelled";
  if (request.applied?.state === "applied") return "applied";
  if (request.applied?.state === "failed") return "failed";
  return "accepted";
}

/**
 * 권한 요청과 보류 request(activation, reaction)의 결정. turn 안 request는 memory route로,
 * 보류 request는 command로 보낸다. 선택지가 request의 것인지는 core가 가른다.
 */
export async function decideWaiting(
  core: CoreSource,
  entry: WaitingEntry,
  choice: WaitingChoice,
  reason?: string,
): Promise<DecideResult> {
  const trimmed = reason?.trim();
  const rejected = choice === "reject"
    ? { kind: "reject" as const, ...(trimmed ? { reason: trimmed } : {}) }
    : null;
  if (entry.kind === "permission") {
    const reply = await core.call({
      kind: "memory",
      resource: approvalsDecideTurn.resource,
      method: approvalsDecideTurn.method,
      body: {
        session: entry.request.session,
        request: entry.id,
        choice: rejected ?? { kind: choice },
      },
    }).catch(() => null);
    if (!reply) return UNAVAILABLE;
    if (!reply.ok) {
      return { ok: false, code: reply.error?.code ?? "unavailable" };
    }
    const parsed = approvalsDecideTurn.output.safeParse(reply.value);
    if (!parsed.success) return UNAVAILABLE;
    const outcome = parsed.data.outcome.outcome;
    return {
      ok: true,
      state: outcome === "allow"
        ? "applied"
        : outcome === "reject"
        ? "denied"
        : "cancelled",
    };
  }
  if (entry.kind === "activation" || entry.kind === "reaction") {
    const reply = await core.call({
      kind: "command",
      resource: approvalsDecide.resource,
      method: approvalsDecide.method,
      body: {
        request: entry.id,
        choice: rejected ?? { kind: "allow" },
      },
    }).catch(() => null);
    if (!reply) return UNAVAILABLE;
    if (!reply.ok) {
      return { ok: false, code: reply.error?.code ?? "unavailable" };
    }
    const parsed = approvalsDecide.output.safeParse(reply.value);
    if (!parsed.success) return UNAVAILABLE;
    return { ok: true, state: settledOfPending(parsed.data.request) };
  }
  // coding agent의 물음과 질문은 이 길로 결정하지 않는다.
  return UNAVAILABLE;
}

/** 대기 중인 질문 묶음의 질문 목록. 풀렸거나 읽지 못하면 null이다. */
export async function readQuestions(
  core: CoreSource,
  entry: WaitingEntry & { kind: "question" },
): Promise<readonly AskQuestion[] | null> {
  const reply = await core.call({
    kind: "memory",
    resource: askRead.resource,
    method: askRead.method,
    body: { session: entry.session, tool_call: entry.request.tool_call },
  }).catch(() => null);
  if (!reply?.ok) return null;
  const parsed = askRead.output.safeParse(reply.value);
  return parsed.success ? parsed.data.questions : null;
}

/** 질문 하나에 선택지 하나로 답한다. 풀린 묶음은 conflict다. */
export async function answerQuestion(
  core: CoreSource,
  entry: WaitingEntry & { kind: "question" },
  answers: readonly AskAnswer[],
): Promise<DecideResult> {
  const reply = await core.call({
    kind: "memory",
    resource: askAnswer.resource,
    method: askAnswer.method,
    body: {
      session: entry.session,
      tool_call: entry.request.tool_call,
      answers,
    },
  }).catch(() => null);
  if (!reply) return UNAVAILABLE;
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "unavailable" };
  return { ok: true, state: "applied" };
}
