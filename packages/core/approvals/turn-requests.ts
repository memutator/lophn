// turn 안 request. 물음이 나온 turn이 기다리고, 메모리에만 둔다.
// 꺼졌다 켜지면 비어 있고 다시 열지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { Clock, IdSource } from "../../base/mod.ts";
import type {
  ShellRuleLayers,
  TurnRequest,
  TurnRequestChoice,
  TurnRequestOutcome,
} from "../../protocol/approvals/mod.ts";
import type { Place } from "../../protocol/lophn-agent/places.ts";
import type { Bus } from "../events/ports.ts";
import { alwaysPatterns } from "./gate/mod.ts";
import type { AlwaysEffect, TurnOrigin } from "./ports.ts";

type Cancelled = Extract<TurnRequestOutcome, { outcome: "cancelled" }>;

type Entry = {
  request: TurnRequest;
  place: Place | null;
  // 결정을 받는 중이거나 끝났으면 true. 같은 request를 두 번 결정하지 못하게 한다.
  closed: boolean;
  outcome: TurnRequestOutcome | null;
  waiters: ((outcome: TurnRequestOutcome) => void)[];
};

type TurnRequestsDeps = {
  shellRules(place: Place | null): ShellRuleLayers;
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

function cancelledFor(cause: Cancelled["cause"]): Cancelled {
  return { outcome: "cancelled", cause };
}

export function createTurnRequests(deps: TurnRequestsDeps) {
  const entries = new Map<string, Entry>();

  function resolve(entry: Entry, outcome: TurnRequestOutcome): void {
    entry.closed = true;
    entry.outcome = outcome;
    for (const waiter of entry.waiters) waiter(outcome);
    entry.waiters = [];
    deps.bus.publish({
      session: entry.request.session,
      type: "TurnRequestClosed",
      at: deps.clock.now(),
      payload: { request: entry.request.id, outcome: outcome.outcome },
    });
  }

  return {
    open(
      origin: TurnOrigin,
      subject: TurnRequest["subject"],
    ): Result<TurnRequest> {
      const request: TurnRequest = {
        id: deps.ids.newId("apr"),
        session: origin.session,
        turn: origin.turn,
        tool_call: origin.tool_call,
        subject,
        always_patterns: subject.kind === "shell"
          ? alwaysPatterns(deps.shellRules(origin.place), subject.command)
          : [],
        created_at: deps.clock.now(),
      };
      entries.set(request.id, {
        request,
        place: origin.place,
        closed: false,
        outcome: null,
        waiters: [],
      });
      deps.bus.publish({
        session: request.session,
        type: "TurnRequestOpened",
        at: request.created_at,
        payload: { request },
      });
      return ok(request);
    },

    wait(id: string): Promise<TurnRequestOutcome> {
      const entry = entries.get(id);
      if (entry === undefined) {
        return Promise.resolve(cancelledFor("turn_ended"));
      }
      if (entry.outcome !== null) return Promise.resolve(entry.outcome);
      return new Promise((resolve) => entry.waiters.push(resolve));
    },

    // 사람의 결정. 호출 자격이 사람인지는 route가 정한다.
    async decide(
      session: string,
      id: string,
      choice: TurnRequestChoice,
      effects: ReadonlyMap<string, AlwaysEffect>,
    ): Promise<Result<{ outcome: TurnRequestOutcome }>> {
      const entry = entries.get(id);
      if (entry === undefined || entry.request.session !== session) {
        return err({
          code: "not_found",
          message: "the request does not exist",
        });
      }
      if (entry.closed) {
        return err({
          code: "conflict",
          message: "the request is already decided",
        });
      }
      let outcome: TurnRequestOutcome;
      if (choice.kind === "reject") {
        entry.closed = true;
        outcome = { outcome: "reject", reason: choice.reason ?? null };
      } else if (choice.kind === "always") {
        const effect = effects.get(entry.request.subject.kind);
        if (entry.request.always_patterns.length === 0 || !effect) {
          return err({
            code: "invalid_input",
            message: "this request cannot be allowed always",
          });
        }
        // 아래 await 동안 다른 결정이 끼어들지 못하게 먼저 닫는다.
        entry.closed = true;
        const done = await effect(entry.request, entry.place);
        if (!done.ok) {
          entry.closed = false;
          return done;
        }
        if (entry.outcome !== null) {
          return err({
            code: "conflict",
            message: "the request was cancelled",
          });
        }
        outcome = { outcome: "allow", scope: "always" };
      } else {
        entry.closed = true;
        outcome = { outcome: "allow", scope: "once" };
      }
      resolve(entry, outcome);
      return ok({ outcome });
    },

    // turn이 끝나거나 session이 닫히거나 시작 때 정리한다. 기다리던 쪽은 거절과 구별해 cancelled를 받는다.
    cancel(session: string, cause: Cancelled["cause"]): void {
      for (const [id, entry] of entries) {
        if (entry.request.session !== session) continue;
        if (entry.outcome === null) resolve(entry, cancelledFor(cause));
        entries.delete(id);
      }
    },

    list(session: string): TurnRequest[] {
      return [...entries.values()]
        .filter((entry) => entry.request.session === session && !entry.closed)
        .map((entry) => entry.request);
    },
  };
}
