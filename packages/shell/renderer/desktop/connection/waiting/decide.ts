// 사람의 결정을 route로 보낸다. 항목을 목록에서 빼는 것은 이 호출이 아니라 TurnRequestClosed·
// ActivationConsentClosed·QuestionResolved와 snapshot 읽기다. 대화 쪽 core source도 같은 호출을 쓴다.
import {
  type TurnRequest,
  type TurnRequestChoice,
  turnRequestDecide,
} from "../../../../../protocol/approvals/turn-request.ts";
import { activationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import { shareRequestDecide } from "../../../../../protocol/approvals/share-request.ts";
import {
  jobApprove,
  jobDecideHold,
} from "../../../../../protocol/jobs/jobs.ts";
import {
  type AskAnswer,
  askAnswer,
  type AskQuestion,
  askRead,
} from "../../../../../protocol/lophn-agent/ask-tool.ts";
import { commandCall } from "../../../command-call.ts";
import type { CoreSource } from "../connection.ts";
import type { WaitingEntry } from "../events/waiting-store.ts";

/** once·always·reject는 turn request의 선택지이고 allow는 activation 동의만 쓴다. */
export type WaitingChoice = TurnRequestChoice["kind"] | "allow";

/** 거절 이유는 한 줄 500자 안으로 맞춘다. 비면 이유가 없다. */
function reasonOf(reason: string | undefined): string | undefined {
  const one = reason?.replace(/\s+/g, " ").trim().slice(0, 500);
  return one === undefined || one === "" ? undefined : one;
}

/** 사람이 고른 허락 범위나 거절을 route의 choice로 바꾼다. 대기 목록과 대화 화면의 결정이 같은 값을 보낸다. */
export function turnChoiceOf(
  choice: TurnRequestChoice["kind"],
  reason?: string,
): TurnRequestChoice {
  if (choice !== "reject") return { kind: choice };
  const why = reasonOf(reason);
  return why === undefined
    ? { kind: "reject" }
    : { kind: "reject", reason: why };
}

/** 카드가 둘 단추. always는 더해질 규칙 줄(shell request만 가진다)이 있을 때만 있다. 대화 화면도 이것으로 고른다. */
export function turnChoicesOf(
  request: Pick<TurnRequest, "always_patterns">,
): readonly TurnRequestChoice["kind"][] {
  return request.always_patterns.length > 0
    ? ["once", "always", "reject"]
    : ["once", "reject"];
}

/** 결정 직후 남는 줄의 상태. */
export type SettledState = "allowed" | "denied" | "cancelled";

type DecideResult =
  | { readonly ok: true; readonly state: SettledState }
  | { readonly ok: false; readonly code: string };

const UNAVAILABLE = { ok: false, code: "unavailable" } as const;

/**
 * 권한 요청(turn request)과 activation 동의의 결정. turn request는 memory route로, activation 동의는
 * command로 보낸다.
 */
export async function decideWaiting(
  core: CoreSource,
  entry: WaitingEntry,
  choice: WaitingChoice,
  reason?: string,
): Promise<DecideResult> {
  if (entry.kind === "permission") {
    if (choice === "allow") return UNAVAILABLE;
    const reply = await core
      .call({
        kind: "memory",
        resource: turnRequestDecide.resource,
        method: turnRequestDecide.method,
        body: {
          session: entry.request.session,
          request: entry.id,
          choice: turnChoiceOf(choice, reason),
        },
      })
      .catch(() => null);
    if (!reply) return UNAVAILABLE;
    if (!reply.ok) {
      return { ok: false, code: reply.error?.code ?? "unavailable" };
    }
    const parsed = turnRequestDecide.output.safeParse(reply.value);
    if (!parsed.success) return UNAVAILABLE;
    const outcome = parsed.data.outcome.outcome;
    return {
      ok: true,
      state:
        outcome === "allow"
          ? "allowed"
          : outcome === "reject"
            ? "denied"
            : "cancelled",
    };
  }
  if (entry.kind === "activation") {
    if (choice !== "allow" && choice !== "reject") return UNAVAILABLE;
    // command는 입력을 봉투에 담아 보낸다. 같은 동의의 같은 결정은 같은 key라 core가 한 번만 접수한다.
    const reply = await core
      .call(
        commandCall(activationConsent, {
          input: { release: entry.request.release, choice },
          compare: { requested_at: entry.request.requested_at },
          key: `activation-consent-${entry.request.release}-${choice}`,
        }),
      )
      .catch(() => null);
    if (!reply) return UNAVAILABLE;
    if (!reply.ok) {
      return { ok: false, code: reply.error?.code ?? "unavailable" };
    }
    const parsed = activationConsent.output.safeParse(reply.value);
    if (!parsed.success) return UNAVAILABLE;
    return {
      ok: true,
      state: parsed.data.outcome === "allow" ? "allowed" : "denied",
    };
  }
  // coding agent의 물음과 질문은 이 길로 결정하지 않는다.
  return UNAVAILABLE;
}

/**
 * job의 놓친 차례를 정한다. 항목은 JobChanged 뒤 다시 읽을 때 빠진다. key는 누를 때마다 새로 만든다:
 * 같은 key는 core가 이전 결과를 돌려줘서, conflict로 막힌 뒤 앞 차례가 끝나고 다시 눌러도 옛 conflict가 온다.
 */
export async function decideJobHold(
  core: CoreSource,
  entry: WaitingEntry & { kind: "job_hold" },
  choice: "run_now" | "skip",
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly code: string }
> {
  const reply = await core
    .call(
      commandCall(jobDecideHold, {
        input: { job_run: entry.id, choice },
        compare: {},
        key: `job-hold-${entry.id}-${choice}-${crypto.randomUUID()}`,
      }),
    )
    .catch(() => null);
  if (!reply) return UNAVAILABLE;
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "unavailable" };
  return jobDecideHold.output.safeParse(reply.value).success
    ? { ok: true }
    : UNAVAILABLE;
}

/** job 등록을 승인하거나 거절한다(거절은 job을 지운다). 항목은 JobChanged 뒤 다시 읽을 때 빠진다. */
export async function decideJobApproval(
  core: CoreSource,
  entry: WaitingEntry & { kind: "job_approval" },
  choice: "approve" | "reject",
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly code: string }
> {
  const reply = await core
    .call(
      commandCall(jobApprove, {
        input: { job: entry.id, choice },
        compare: {},
        key: `job-approve-${entry.id}-${choice}-${crypto.randomUUID()}`,
      }),
    )
    .catch(() => null);
  if (!reply) return UNAVAILABLE;
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "unavailable" };
  return jobApprove.output.safeParse(reply.value).success
    ? { ok: true }
    : UNAVAILABLE;
}

/** 앱 공유 요청을 승인하거나 거절한다. 항목은 ShareRequestClosed가 목록에서 뺀다. */
export async function decideShare(
  core: CoreSource,
  entry: WaitingEntry & { kind: "share" },
  choice: "approve" | "reject",
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly code: string }
> {
  const reply = await core
    .call(
      commandCall(shareRequestDecide, {
        input: { app: entry.request.app, choice },
        compare: { requested_at: entry.request.requested_at },
        key: `share-${entry.request.app}-${entry.request.requested_at}-${choice}`,
      }),
    )
    .catch(() => null);
  if (!reply) return UNAVAILABLE;
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "unavailable" };
  return shareRequestDecide.output.safeParse(reply.value).success
    ? { ok: true }
    : UNAVAILABLE;
}

/** 대기 중인 질문 묶음의 질문 목록. 풀렸거나 읽지 못하면 null이다. */
export async function readQuestions(
  core: CoreSource,
  entry: WaitingEntry & { kind: "question" },
): Promise<readonly AskQuestion[] | null> {
  const reply = await core
    .call({
      kind: "memory",
      resource: askRead.resource,
      method: askRead.method,
      body: { session: entry.session, tool_call: entry.request.tool_call },
    })
    .catch(() => null);
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
  const reply = await core
    .call({
      kind: "memory",
      resource: askAnswer.resource,
      method: askAnswer.method,
      body: {
        session: entry.session,
        tool_call: entry.request.tool_call,
        answers,
      },
    })
    .catch(() => null);
  if (!reply) return UNAVAILABLE;
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "unavailable" };
  return { ok: true, state: "allowed" };
}
