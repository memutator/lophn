import { err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  loginRequestAsk,
  loginRequestCancel,
  loginRequestDone,
  loginRequestHold,
  loginRequestRead,
} from "../../../../protocol/lophn-agent/login-request.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { TurnMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import { loginOriginSchema } from "../../../../protocol/secrets/logins.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

// agent의 login 요청(`lophn login request`)의 core 쪽이다. 대기열은 `ask`와 같은 questionWaits이고, 여기는 입구 route와
// origin 재기, once 값의 알려진 값 등록을 맡는다. 값은 이 파일에서 저장하지 않는다.
const LOGIN_REQUEST_PRINCIPAL = "machine:login-request";

const LOGIN_REQUEST_CONTEXT: AuthenticatedContext = {
  principal: LOGIN_REQUEST_PRINCIPAL,
  actor: "machine",
  scope: { operations: [turnRead.name], targets: {} },
  conditions: {},
  credential_ref: LOGIN_REQUEST_PRINCIPAL,
};

// shell이 없을 때 origin 재기가 영원히 기다리지 않게 하는 감시 간격이다(host-queue 입구와 같다).
const WATCH_MS = 1000;

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const loginRequestWiring: WiringFactory = () => {
  let abandonAll: (() => void) | undefined;
  return {
    name: "login-request",
    records: () => [LOGIN_REQUEST_CONTEXT],
    build(ctx) {
      const queue = ctx.hostQueue;
      const waits = ctx.questionWaits;
      // session마다 그 session이 끝날 때까지 알려진 값으로 붙든 once 값이다.
      const held = new Map<string, string[]>();
      const inflight = new Set<() => void>();
      abandonAll = () => {
        for (const abandon of [...inflight]) abandon();
      };
      ctx.bus.subscribe([{ types: ["SessionEnded"] }], {
        send(event) {
          if (!("session" in event)) return;
          const values = held.get(event.session);
          if (values === undefined) return;
          held.delete(event.session);
          void ctx.secretStore.release(values);
        },
        close() {},
      });

      const modeOf = async (turn: string): Promise<Result<TurnMode>> => {
        const found = await ctx.runtime.readers.read(
          turnRead,
          LOGIN_REQUEST_CONTEXT,
          { turn },
        );
        return found.ok
          ? ok((found.value as { turn: { mode: TurnMode } }).turn.mode)
          : found;
      };

      // ref 요소가 든 frame의 origin을 shell main이 CDP로 잰다. agent가 적은 글이 아니다.
      const measure = async (
        tab: Id<"tab">,
        view: "browser" | "preview" | "artifact",
        ref: string,
      ): Promise<Result<{ origin: string; title: string }>> => {
        if (!queue.attached()) {
          return err({
            code: "unavailable",
            message: "the shell is not attached",
          });
        }
        const sent = queue.callBrowser({
          tab,
          view,
          action: { kind: "frame_origin", ref },
        });
        const abandon = () => queue.abandon(sent.id);
        inflight.add(abandon);
        const watch = setInterval(() => {
          if (!queue.attached()) abandon();
          else queue.expire();
        }, WATCH_MS);
        try {
          const result = await sent.result;
          if (!result.ok) return result;
          const first = result.value[0];
          const measured =
            first?.type === "text"
              ? (JSON.parse(first.text) as {
                  origin?: unknown;
                  title?: unknown;
                })
              : {};
          const parsed = loginOriginSchema.safeParse(measured.origin);
          return parsed.success
            ? ok({
                origin: parsed.data,
                title:
                  typeof measured.title === "string"
                    ? measured.title.slice(0, 200)
                    : "",
              })
            : err({
                code: "internal",
                message: "the shell returned no origin for this ref",
              });
        } finally {
          clearInterval(watch);
          inflight.delete(abandon);
        }
      };

      const ask: MemoryHandler = async (who, body) => {
        const session = who.conditions.session;
        if (!who.actor.startsWith("agent:") || session === undefined) {
          return err({ code: "forbidden", message: "only an agent session" });
        }
        const input = loginRequestAsk.input.parse(body);
        const turn = who.conditions.turn ?? "";
        if (turn !== "") {
          const mode = await modeOf(turn);
          if (!mode.ok) return mode;
          if (mode.value === "unattended") return ok({ unattended: true });
        }
        const found = queue.browserTab(
          input.tab as Id<"tab">,
          session as Id<"ses">,
        );
        if (!found.ok) return found;
        const origin = await measure(
          input.tab as Id<"tab">,
          found.value.view,
          input.ref,
        );
        if (!origin.ok) return origin;
        return await waits.askLogin(
          { session, turn },
          {
            tab: input.tab as Id<"tab">,
            view: found.value.view,
            ref: input.ref,
            mode: input.mode,
            label: input.label ?? new URL(origin.value.origin).host,
            origin: origin.value.origin,
            title: origin.value.title,
          },
        );
      };

      const humanOnly = (who: AuthenticatedContext): Result<void> =>
        who.actor === "user"
          ? ok(undefined)
          : err({ code: "forbidden", message: "only the user answers" });
      const read: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = loginRequestRead.input.parse(body);
        return waits.readLogin(input.session, input.tool_call);
      };
      const cancel: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = loginRequestCancel.input.parse(body);
        const done = waits.finishLogin(
          input.session,
          input.tool_call,
          ok({ cancelled: true }),
        );
        return done.ok ? ok({}) : done;
      };
      const hold: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = loginRequestHold.input.parse(body);
        const open = waits.readLogin(input.session, input.tool_call);
        if (!open.ok) return open;
        if (open.value.mode !== "once") {
          return err({
            code: "invalid_input",
            message: "only a once request holds a value",
          });
        }
        // 값을 알려진 값으로 올린 뒤에야 shell main이 친다. 파일·ledger에는 쓰지 않는다.
        const values = held.get(input.session) ?? [];
        values.push(input.value);
        held.set(input.session, values);
        const kept = await ctx.secretStore.hold([input.value]);
        return kept.ok ? ok({}) : kept;
      };
      const done: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = loginRequestDone.input.parse(body);
        const { result } = input;
        const finished = waits.finishLogin(
          input.session,
          input.tool_call,
          "error" in result ? err(result.error) : ok(result),
        );
        return finished.ok ? ok({}) : finished;
      };

      return ok({
        memory: [
          [key(loginRequestAsk), ask],
          [key(loginRequestRead), read],
          [key(loginRequestCancel), cancel],
          [key(loginRequestHold), hold],
          [key(loginRequestDone), done],
        ],
      });
    },
    closeIntake() {
      abandonAll?.();
    },
  };
};
