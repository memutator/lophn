// 새 일을 여는 domain event의 공통 handler. reaction 설정이 off면 아무것도 하지 않고, 아니면 연다.
// 여는 일은 Router에 program call을 보내는 것이다.
import { ok, type Result } from "../../../base/mod.ts";
import {
  DEFAULT_REACTION_MODE,
  type ReactionEventType,
} from "../../../protocol/approvals/mod.ts";
import type { SettingsReader } from "../../../protocol/config/mod.ts";
import type { DomainEvent } from "../../../protocol/events/mod.ts";
import type { CallEnvelope } from "../../../protocol/lophn-agent/calls.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import { reactionSettings } from "../../approvals/mod.ts";
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
  router: ReactionRouter;
  settings: SettingsReader;
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
    unattended: false,
    to: { kind: "new_session", agent },
    body:
      `Release ${event.subject} failed to activate (${event.payload.failure.code}).`,
    refs: [{ kind: "ticket", ticket: event.payload.ticket }],
  };
}

// call 보내기의 key는 handler 이름과 근거 seq로 만든다. 같은 event를 다시 받아도 call은 하나다.
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
      const mode = deps.settings.get(reactionSettings[type]) ??
        DEFAULT_REACTION_MODE;
      if (mode === "off") return ok(undefined);
      return await send(deps, event as NewWork);
    },
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
}
