// turn 안 request. 물음이 나온 turn이 기다리고, 메모리에만 둔다.
// 꺼졌다 켜지면 비어 있고 다시 열지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { Clock, IdSource } from "../../base/mod.ts";
import {
  choicesFor,
  type Intent,
  type RequestChoice,
  type TurnChoice,
  type TurnDecision,
  type TurnPermissionRequest,
} from "../../protocol/approvals/mod.ts";
import type { Bus } from "../events/ports.ts";
import { allowanceKey } from "./grants/mod.ts";
import { choiceOffered, intentFingerprint } from "./model.ts";
import type { Grants, SessionAllowances } from "./ports.ts";

type Cancelled = Extract<TurnDecision, { outcome: "cancelled" }>;

type Entry = {
  request: TurnPermissionRequest;
  // 결정을 받는 중이거나 끝났으면 true. 같은 request를 두 번 결정하지 못하게 한다.
  closed: boolean;
  decision: TurnDecision | null;
  // 허락이 이미 쓰였는지.
  used: boolean;
  waiters: ((decision: TurnDecision) => void)[];
};

type TurnRequestsDeps = {
  grants: Grants;
  allowances: SessionAllowances;
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

function cancelledFor(cause: Cancelled["cause"]): Cancelled {
  return { outcome: "cancelled", cause };
}

export function createTurnRequests(deps: TurnRequestsDeps) {
  const entries = new Map<string, Entry>();

  function resolve(entry: Entry, decision: TurnDecision): void {
    entry.closed = true;
    entry.decision = decision;
    for (const waiter of entry.waiters) waiter(decision);
    entry.waiters = [];
    deps.bus.publish({
      session: entry.request.session,
      type: "PermissionResolved",
      at: deps.clock.now(),
      payload: { request: entry.request.id, outcome: decision.outcome },
    });
  }

  return {
    open(intent: Intent): Result<TurnPermissionRequest> {
      if (intent.origin.kind !== "turn") {
        return err({
          code: "invalid_input",
          message: "only a turn can wait for a permission",
        });
      }
      const request: TurnPermissionRequest = {
        id: deps.ids.newId("apr"),
        session: intent.origin.session,
        turn: intent.origin.turn,
        tool_call: intent.origin.tool_call,
        intent,
        choices: [...choicesFor(intent.kind)],
        fingerprint: intentFingerprint(intent),
        created_at: deps.clock.now(),
      };
      entries.set(request.id, {
        request,
        closed: false,
        decision: null,
        used: false,
        waiters: [],
      });
      deps.bus.publish({
        session: request.session,
        type: "PermissionRequested",
        at: request.created_at,
        payload: { request },
      });
      return ok(request);
    },

    wait(id: string): Promise<TurnDecision> {
      const entry = entries.get(id);
      if (entry === undefined) {
        return Promise.resolve(cancelledFor("turn_ended"));
      }
      if (entry.decision !== null) return Promise.resolve(entry.decision);
      return new Promise((resolve) => entry.waiters.push(resolve));
    },

    // 사람의 결정. 호출 자격이 사람인지는 route가 정한다.
    async decide(
      session: string,
      id: string,
      choice: TurnChoice,
    ): Promise<Result<{ outcome: TurnDecision }>> {
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
      const offered = choiceOffered(
        entry.request.choices,
        choice.kind as RequestChoice,
      );
      if (!offered.ok) return offered;
      // 아래 await 동안 다른 결정이 끼어들지 못하게 먼저 닫는다.
      entry.closed = true;
      const { intent } = entry.request;
      let decision: TurnDecision;
      if (choice.kind === "reject") {
        decision = { outcome: "reject", reason: choice.reason ?? null };
      } else if (choice.kind === "session") {
        const key = allowanceKey(intent);
        if (key === null) {
          entry.closed = false;
          return err({
            code: "invalid_input",
            message: "this request has no session allowance",
          });
        }
        deps.allowances.allow(session, key);
        decision = { outcome: "allow", scope: "session" };
      } else if (choice.kind === "always") {
        if (intent.actor.kind !== "agent") {
          entry.closed = false;
          return err({
            code: "invalid_input",
            message: "only an agent grant can be set to always",
          });
        }
        const set = await deps.grants.setAlways(
          intent.actor.agent,
          intent.target,
        );
        if (!set.ok) {
          entry.closed = false;
          return set;
        }
        if (entry.decision !== null) {
          return err({
            code: "conflict",
            message: "the request was cancelled",
          });
        }
        decision = { outcome: "allow", scope: "always" };
      } else {
        decision = { outcome: "allow", scope: "once" };
      }
      resolve(entry, decision);
      return ok({ outcome: decision });
    },

    // 허락은 그 intent에 한 번만 쓰인다. 쓰기 직전에 intent가 같은지 다시 본다.
    consume(id: string, current: Intent): Promise<Result<void>> {
      const entry = entries.get(id);
      if (entry === undefined) {
        return Promise.resolve(
          err({ code: "not_found", message: "the request does not exist" }),
        );
      }
      if (entry.decision?.outcome !== "allow") {
        return Promise.resolve(
          err({ code: "conflict", message: "the request was not allowed" }),
        );
      }
      if (entry.used) {
        return Promise.resolve(
          err({ code: "conflict", message: "the allowance was already used" }),
        );
      }
      // 다른 intent로 부른 시도도 이 허락을 쓴 것으로 친다.
      entry.used = true;
      if (intentFingerprint(current) !== entry.request.fingerprint) {
        return Promise.resolve(
          err({
            code: "conflict",
            message: "the intent changed after the decision",
          }),
        );
      }
      return Promise.resolve(ok(undefined));
    },

    // turn이 끝나거나 session이 닫히거나 시작 때 정리한다. 기다리던 쪽은 거절과 구별해 cancelled를 받는다.
    cancel(session: string, cause: Cancelled["cause"]): void {
      for (const [id, entry] of entries) {
        if (entry.request.session !== session) continue;
        if (entry.decision === null) resolve(entry, cancelledFor(cause));
        entries.delete(id);
      }
      if (cause === "session_closed") deps.allowances.clear(session);
    },

    list(session: string): TurnPermissionRequest[] {
      return [...entries.values()]
        .filter((entry) => entry.request.session === session && !entry.closed)
        .map((entry) => entry.request);
    },
  };
}
