// 새 일을 여는 domain event의 공통 handler. reaction grant를 보고 끄거나(off), 열고 묻지 않거나(open),
// 보류 request를 만든다(ask). 여는 일은 Router에 program call을 보내는 것이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ApplyResult,
  Intent,
  PendingApproval,
  ReactionEventType,
} from "../../../protocol/approvals/mod.ts";
import {
  type DomainEvent,
  domainEventSchema,
} from "../../../protocol/events/mod.ts";
import type { CallEnvelope } from "../../../protocol/lophn-agent/calls.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Approvals } from "../../approvals/ports.ts";
import { reactionIdempotencyKey } from "../../storage/ledger/reaction.ts";
import type { Reactor, ReactorHandler } from "../ports.ts";

// Router를 부르는 입구. Router는 core/router에 살고 구현은 wiring이 끼운다.
// idempotencyKey가 같으면 두 번 보내도 call은 하나다.
export type ReactionRouter = {
  send(
    call: Omit<CallEnvelope, "call">,
    idempotencyKey: string,
  ): Promise<Result<void>>;
};

type NewWorkDeps = {
  approvals: Pick<Approvals, "judge" | "createPending" | "registerApplier">;
  router: ReactionRouter;
  // 근거 seq의 events 행. 보류 request가 허락된 뒤 event를 다시 읽는다.
  events: { at(seq: string): Promise<Result<unknown | null>> };
  // 앱을 받는 event는 그 앱의 App Engineer를 부른다. 앱이 없으면 not_found다. wiring이 ledger 연결로 꽂는다.
  agentOfApp(app: string): Result<AgentRef>;
};

type NewWork = Extract<DomainEvent, { type: ReactionEventType }>;

const newWorkHandlerName = (type: ReactionEventType) => `new-work:${type}`;

// program이 쓴 글이다. 앱이나 agent가 쓴 글을 섞지 않는다. 받는 agent는 그 앱의 App Engineer다.
function callOf(
  event: NewWork,
  agent: AgentRef,
): Omit<CallEnvelope, "call"> {
  return {
    from: { kind: "program", event_seq: event.seq },
    reply: "none",
    reply_to: null,
    dedup: null,
    options: null,
    to: { kind: "new_session", agent },
    body:
      `Release ${event.subject} failed to activate (${event.payload.failure.code}).`,
    refs: [{ kind: "ticket", ticket: event.payload.ticket }],
  };
}

function intentOf(event: NewWork): Intent {
  return {
    kind: "reaction",
    actor: { kind: "program", seq: event.seq },
    target: { kind: "reaction", event: event.type },
    effect: "read",
    input: {},
    origin: { kind: "event", seq: event.seq },
  };
}

// call 보내기의 key는 handler 이름과 근거 seq로 만든다. handler 경로와 허락 뒤 applier 경로가 같은 key를 쓴다.
async function sendKey(event: NewWork): Promise<Result<string>> {
  return await reactionIdempotencyKey({
    subscriber: newWorkHandlerName(event.type),
    cause_seq: event.seq,
    reaction: "send",
  });
}

async function send(deps: NewWorkDeps, event: NewWork): Promise<Result<void>> {
  const key = await sendKey(event);
  if (!key.ok) return key;
  const agent = deps.agentOfApp(event.payload.app);
  if (!agent.ok) return agent;
  return await deps.router.send(callOf(event, agent.value), key.value);
}

function handlerFor<T extends ReactionEventType>(
  type: T,
  deps: NewWorkDeps,
): ReactorHandler<T> {
  return {
    name: newWorkHandlerName(type),
    async handle(event) {
      const intent = intentOf(event as NewWork);
      const verdict = await deps.approvals.judge(intent);
      if (!verdict.ok) return verdict;
      if (verdict.value.verdict === "deny") return ok(undefined);
      if (verdict.value.verdict === "run") {
        return await send(deps, event as NewWork);
      }
      const pending = await deps.approvals.createPending(intent);
      return pending.ok ? ok(undefined) : pending;
    },
  };
}

// 허락된 보류 request를 다시 검사하고 같은 call을 보낸다.
function applier(deps: NewWorkDeps) {
  const failed = (
    code: Extract<ApplyResult, { state: "failed" }>["code"],
    message: string,
  ): Result<ApplyResult> => ok({ state: "failed", code, message });
  return async (request: PendingApproval): Promise<Result<ApplyResult>> => {
    const { target, origin } = request.intent;
    if (target.kind !== "reaction" || origin.kind !== "event") {
      return err({ code: "invalid_input", message: "not a reaction" });
    }
    const row = await deps.events.at(origin.seq);
    if (!row.ok) return row;
    const parsed = domainEventSchema.safeParse(row.value);
    if (!parsed.success || parsed.data.type !== target.event) {
      return failed("not_found", "the event of this request is gone");
    }
    const event = parsed.data as NewWork;
    const verdict = await deps.approvals.judge(intentOf(event));
    if (!verdict.ok) return verdict;
    if (verdict.value.verdict === "deny") {
      return failed("forbidden", "the reaction was turned off");
    }
    const sent = await send(deps, event);
    return sent.ok
      ? ok({ state: "applied" })
      : failed(sent.error.code, sent.error.message);
  };
}

export function registerNewWorkHandlers(
  reactor: Reactor,
  deps: NewWorkDeps,
): void {
  reactor.on(
    "ReleaseActivationFailed",
    handlerFor("ReleaseActivationFailed", deps),
  );
  deps.approvals.registerApplier("reaction", applier(deps));
}
