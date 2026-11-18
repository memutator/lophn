// 앱 화면이 A2A의 한쪽이 되는 입구(`app_calls.*`, `app_agents.list`)다(view-first: 앱 process에는 이 길이 없다). shell main이 정한 앱으로 Router를 쓰는 writer command(`calls.app-send`,
// `calls.app-cancel`)를 core 안 machine 자격으로 부른다. 읽기는 같은 ledger를 읽는 main thread 연결로 한다. 앱이 보는 call은 이 앱이
// 보낸 것과 보이는 session이 받은 것이고, 보이는지는 call 정책(앱 workspace에서 닿을 수 있는 workspace)이 정한다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import {
  DEFAULT_CALL_POLICY,
  type CallPolicy,
  mayReachWorkspace,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  appAgentsList,
  appCallsCancel,
  appCallsList,
  appCallsRead,
  appCallsSend,
  type AppCallRow,
} from "../../../../protocol/lophn-agent/app-calls.ts";
import type { AgentCallRow } from "../../../../protocol/lophn-agent/calls.ts";
import { agentCards } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { appStatusOf } from "../../../apps/lookups.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import {
  callsAppCancel,
  callsAppSend,
  callsOfSession,
  readCall,
} from "../../../router/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import { appHandlerFor, routeKey } from "./app-principal.ts";
import type { WiringFactory } from "./context.ts";

const APP_CALLS_PRINCIPAL = "machine:app-calls";
const APP_CALLS_CONTEXT: AuthenticatedContext = {
  principal: APP_CALLS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [callsAppSend.name, callsAppCancel.name, agentCards.name],
    targets: {},
  },
  conditions: {},
  credential_ref: APP_CALLS_PRINCIPAL,
};

const LIST_LIMIT = 50;

export const appCallsWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  return {
    name: "app-calls",
    records: () => [APP_CALLS_CONTEXT],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const policy = (): CallPolicy =>
        ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;

      const activeApp = (app: string): Result<void> => {
        const status = appStatusOf(sql, app);
        return status === null
          ? err({ code: "not_found", message: "app not found" })
          : status === "archived"
            ? err({ code: "conflict", message: "the app is archived" })
            : ok(undefined);
      };
      // 앱이 볼 수 있는 session인가(앱 workspace에서 call로 닿을 수 있는 workspace의 session).
      const visible = (app: string, session: string): boolean => {
        const row = loadSession({ sql }, session);
        return (
          row !== undefined &&
          mayReachWorkspace(
            policy(),
            { kind: "app", id: app } as never,
            workspaceOf(row),
          )
        );
      };
      const rowOf = (app: string, record: AgentCallRow): AppCallRow => ({
        call: record.call,
        from: record.from,
        to: record.to,
        receiver_session: record.receiver_session,
        reply: record.reply,
        state: record.state,
        fail_reason: record.fail_reason,
        // 남이 보낸 call의 답 글은 이 앱의 것이 아니다.
        result:
          record.from.kind === "app" && record.from.app === app
            ? record.result
            : null,
        created_at: record.created_at,
        state_changed_at: record.state_changed_at,
      });
      const command = async (
        route: { name: string },
        input: unknown,
      ): Promise<Result<unknown>> => {
        const done = await ctx.writer.command(APP_CALLS_CONTEXT, {
          command: route.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        return done.ok ? ok(done.value.result) : done;
      };

      const appHandler = appHandlerFor(() => ctx.appViews);
      return ok({
        memory: [
          [
            routeKey(appCallsSend),
            appHandler(
              (
                app,
                input: {
                  to: never;
                  reply: "none" | "result";
                  text: string;
                  key?: string;
                  app?: string;
                },
              ) =>
                command(callsAppSend, {
                  app,
                  to: input.to,
                  reply: input.reply,
                  body: textBlocks(input.text),
                  ...(input.key === undefined ? {} : { key: input.key }),
                }),
            ),
          ],
          [
            routeKey(appCallsRead),
            appHandler((app, input: { call: never; app?: string }) => {
              const read = readCall({ sql }, input.call);
              if (!read.ok) return read;
              const record = read.value;
              // 이 앱이 보낸 call만 읽는다. 남의 call은 없는 call과 같다.
              if (
                record === null ||
                record.from.kind !== "app" ||
                record.from.app !== app
              ) {
                return err({ code: "not_found", message: "call not found" });
              }
              return ok({ call: rowOf(app, record) });
            }),
          ],
          [
            routeKey(appCallsCancel),
            appHandler(
              (app, input: { call: never; reason?: string; app?: string }) =>
                command(callsAppCancel, { app, ...input }),
            ),
          ],
          [
            routeKey(appCallsList),
            appHandler((app, input: { session: string; app?: string }) => {
              if (!visible(app, input.session)) {
                return err({ code: "not_found", message: "session not found" });
              }
              return ok({
                calls: callsOfSession(
                  { sql },
                  input.session as never,
                  LIST_LIMIT,
                ).map((record) => rowOf(app, record)),
              });
            }),
          ],
          [
            routeKey(appAgentsList),
            appHandler(async (app) => {
              const active = activeApp(app);
              if (!active.ok) return active;
              const read = await ctx.runtime.readers.read(
                agentCards,
                APP_CALLS_CONTEXT,
                { workspace: { kind: "app", id: app } },
              );
              if (!read.ok) return read;
              return ok({
                agents: (read.value as { cards: unknown[] }).cards,
              });
            }),
          ],
        ],
      });
    },
    closeWork() {
      connection?.close();
      connection = undefined;
    },
  };
};
