import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { appGet } from "../../../../protocol/apps/apps.ts";
import { appGrantsList } from "../../../../protocol/apps/grants.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  inputRequestAnswerSecret,
  inputRequestAsk,
  inputRequestCancel,
  inputRequestDone,
  inputRequestHold,
  inputRequestRead,
} from "../../../../protocol/lophn-agent/input-request.ts";
import {
  providerDefinitions,
  providerList,
} from "../../../../protocol/lophn-agent/providers.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { TurnMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import { PHONE_TAB_TEXT } from "../../../../protocol/phone/drive.ts";
import { loginOriginSchema } from "../../../../protocol/secrets/logins.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import { registeredMcpServers } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { readAgentMcp } from "./agent-mcp.ts";
import { createSecretSlots } from "./secret-slot.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import {
  createKeyConnect,
  secretAnswerHandler,
} from "../../../lophn-agent/providers/connect-key.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

// agent의 입력 요청(`lophn login request`, `lophn ask secret`)의 core 쪽이다. 대기열은 `ask`와 같은 questionWaits이고,
// 여기는 입구 route와 login의 origin 재기·once 값의 알려진 값 등록, secret 자리의 해석, secret 요청의 답(값을 그 자리에
// 넣고 새 provider면 잇기)을 맡는다. 값은 secret 저장소에만 가고 결과·오류·event·log에 없다.
const INPUT_REQUEST_PRINCIPAL = "machine:input-request";

const INPUT_REQUEST_CONTEXT: AuthenticatedContext = {
  principal: INPUT_REQUEST_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      turnRead.name,
      appGet.name,
      appGrantsList.name,
      providerDefinitions.name,
      providerList.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: INPUT_REQUEST_PRINCIPAL,
};

// shell이 없을 때 origin 재기가 영원히 기다리지 않게 하는 감시 간격이다(host-queue 입구와 같다).
const WATCH_MS = 1000;

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

export const inputRequestWiring: WiringFactory = () => {
  let abandonAll: (() => void) | undefined;
  return {
    name: "input-request",
    records: () => [INPUT_REQUEST_CONTEXT],
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
        const found = await readAs<{ turn: { mode: TurnMode } }>(turnRead, {
          turn,
        });
        return found.ok ? ok(found.value.turn.mode) : found;
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

      // reader pool이 아니라 core의 read 표로 읽는다. `providers/definitions`는 pool 밖 api read라 pool로는 not_found다.
      const readAs = async <T>(
        route: { resource: string; method: string },
        input: unknown,
      ): Promise<Result<T>> => {
        const handler = ctx.runtime.reads.get(key(route));
        if (handler === undefined) {
          return err({ code: "unavailable", message: "read not served" });
        }
        return (await handler(INPUT_REQUEST_CONTEXT, input)) as Result<T>;
      };
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });

      const slots = createSecretSlots({
        read: readAs,
        newProviderId: () => ids.newId("pvd"),
        configured: (name) => ctx.secretStore.get(name).ok,
        mcpServers: () =>
          registeredMcpServers(ctx.ledgerPath, {
            projectLayer: PROJECT_LAYER,
            agents: () => readAgentMcp(ctx.ledgerPath),
          }),
      });

      const ask: MemoryHandler = async (who, body) => {
        const session = who.conditions.session;
        if (!who.actor.startsWith("agent:") || session === undefined) {
          return err({ code: "forbidden", message: "only an agent session" });
        }
        const input = inputRequestAsk.input.parse(body);
        const turn = who.conditions.turn ?? "";
        if (turn !== "") {
          const mode = await modeOf(turn);
          if (!mode.ok) return mode;
          if (mode.value === "unattended") return ok({ unattended: true });
        }
        if (input.kind === "secret") {
          const row = ledgerSnapshot(ctx.ledgerPath, (lookup) =>
            loadSession(lookup, session),
          );
          if (!row.ok || row.value === undefined) {
            return err({ code: "not_found", message: "the session is gone" });
          }
          const here = workspaceOf(row.value);
          const content = await slots.resolve(
            here,
            row.value.agent,
            input.slot,
          );
          if (!content.ok) return content;
          return await waits.askRequest({ session, turn }, content.value);
        }
        const found = queue.browserTab(
          input.tab as Id<"tab">,
          session as Id<"ses">,
        );
        if (!found.ok) return found;
        if (found.value.view === "phone") {
          return err({
            code: "invalid_input",
            message: PHONE_TAB_TEXT.unsupported("a login request"),
          });
        }
        const origin = await measure(
          input.tab as Id<"tab">,
          found.value.view,
          input.ref,
        );
        if (!origin.ok) return origin;
        return await waits.askRequest(
          { session, turn },
          {
            kind: "login",
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
        const input = inputRequestRead.input.parse(body);
        return waits.readRequest(input.session, input.tool_call);
      };
      const cancel: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = inputRequestCancel.input.parse(body);
        const done = waits.finishRequest(
          input.session,
          input.tool_call,
          ok({ cancelled: true }),
        );
        return done.ok ? ok({}) : done;
      };
      const hold: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = inputRequestHold.input.parse(body);
        const open = waits.readRequest(input.session, input.tool_call);
        if (!open.ok) return open;
        if (open.value.kind !== "login" || open.value.mode !== "once") {
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
        const input = inputRequestDone.input.parse(body);
        const { result } = input;
        // sign_in 요청은 로그인 결과(signed_in이나 오류)만, 다른 요청은 signed_in을 받지 않는다.
        const open = waits.readRequest(input.session, input.tool_call);
        if (!open.ok) return open;
        const signedIn = "signed_in" in result;
        if (
          !("error" in result) &&
          signedIn !== (open.value.kind === "sign_in")
        ) {
          return err({
            code: "invalid_input",
            message: "the result does not fit this request",
          });
        }
        const finished = waits.finishRequest(
          input.session,
          input.tool_call,
          "error" in result ? err(result.error) : ok(result),
        );
        return finished.ok ? ok({}) : finished;
      };

      // 사람이 보호 입력(desktop의 보호 창, 폰의 native 입력)에서 넣은 secret 요청의 값이다.
      const answerSecret = secretAnswerHandler({
        keys: createKeyConnect({
          writer: () => ctx.writer,
          secrets: ctx.secretStore,
          newKey: () => crypto.randomUUID(),
          tail: () => ids.newId("stg").slice("stg_".length),
        }),
        secrets: ctx.secretStore,
        requests: waits,
      });

      return ok({
        uploads: [[key(inputRequestAnswerSecret), answerSecret]],
        memory: [
          [key(inputRequestAsk), ask],
          [key(inputRequestRead), read],
          [key(inputRequestCancel), cancel],
          [key(inputRequestHold), hold],
          [key(inputRequestDone), done],
        ],
      });
    },
    closeIntake() {
      abandonAll?.();
    },
  };
};
