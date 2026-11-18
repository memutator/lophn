// session lifecycle: 앱에 주는 session 목록·상태·멈추기와 core가 낸 `session.*` event(발행자 `lophn`)다.
// 상태 파생은 lophn-agent/session/state.ts 한 곳이고, 여기는 그 사실을 모으는 port(메모리의 대기 요청·질문, ledger, call 정책, host queue)를
// 꽂고 앱 event 전달(`ctx.eventDelivery`)에 잇는다. 터미널 coding agent는 core의 tracker와 GUI handle이 아는 집합이다
// (`ctx.terminalAgents`의 coding session 목록과 같다).
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  archiveSession,
  renameSession,
  workspaceSessionAppOpen,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  DEFAULT_CALL_POLICY,
  type CallPolicy,
  mayReachWorkspace,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  appSessionsEnd,
  appSessionsList,
  appSessionsOpen,
  appSessionsStatus,
  appSessionsStop,
} from "../../../../protocol/lophn-agent/session-lifecycle.ts";
import { HARNESS_ADAPTER_OF_RUNTIME } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { sessionStatusRead } from "../../../../protocol/lophn-agent/session-status.ts";
import { stopTurn } from "../../../../protocol/lophn-agent/turns.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { workspaceDepsOf } from "../../../lophn-agent/workspaces/mod.ts";
import {
  createSessionLifecycle,
  LIFECYCLE_AGENT_EVENTS,
} from "../../../lophn-agent/session/lifecycle.ts";
import { projectFolderPaths } from "../../../projects/lookups.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import { sessionFoldersOf } from "../workspace-folders-glue.ts";
import { loadSession } from "../../../lophn-agent/session/model.ts";
import { appHandlerFor, routeKey } from "./app-principal.ts";
import type { WiringFactory } from "./context.ts";

// 앱이 멈추라고 한 turn을 StopTurn으로 닫고 상태를 읽는 core 안 자격이다. 앱이 직접 StopTurn을 부르는 것이 아니다:
// 어느 session이 앱 시야 안인지는 이 wiring이 먼저 판정한다.
const LIFECYCLE_PRINCIPAL = "machine:session-lifecycle";
const LIFECYCLE_CONTEXT: AuthenticatedContext = {
  principal: LIFECYCLE_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [stopTurn.name, sessionStatusRead.name],
    targets: {},
  },
  conditions: {},
  credential_ref: LIFECYCLE_PRINCIPAL,
};

// 앱이 session을 끝내거나 이름 붙일 때 쓰는 자격이다. ArchiveSession·RenameSession은 사람 자격(actor user) command라 이 효과를 그 자격으로
// 낸다(annotation 묶음 보내기와 같다). 그 앱의 session인지는 이 wiring이 먼저 판정한다.
const APP_SESSIONS_PRINCIPAL = "machine:app-sessions";
const APP_SESSIONS_CONTEXT: AuthenticatedContext = {
  principal: APP_SESSIONS_PRINCIPAL,
  actor: "user",
  scope: {
    operations: [renameSession.name, archiveSession.name],
    targets: {},
  },
  conditions: {},
  credential_ref: APP_SESSIONS_PRINCIPAL,
};
// `opened_by_app`을 다는 OpenAppSession은 machine 전용이라 사람 자격으로는 표시를 달 수 없다.
const APP_SESSIONS_OPEN_PRINCIPAL = "machine:app-sessions-open";
const APP_SESSIONS_OPEN_CONTEXT: AuthenticatedContext = {
  principal: APP_SESSIONS_OPEN_PRINCIPAL,
  actor: "machine",
  scope: { operations: [workspaceSessionAppOpen.name], targets: {} },
  conditions: {},
  credential_ref: APP_SESSIONS_OPEN_PRINCIPAL,
};

export const sessionLifecycleWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  let unsubscribe: (() => void) | undefined;
  let offTerminals: (() => void) | undefined;
  return {
    name: "session-lifecycle",
    records: () => [
      LIFECYCLE_CONTEXT,
      APP_SESSIONS_CONTEXT,
      APP_SESSIONS_OPEN_CONTEXT,
    ],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const workspace = workspaceDepsOf(sql);
      const policy = (): CallPolicy =>
        ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;

      const lifecycle = createSessionLifecycle({
        sql,
        agent(agent) {
          const described = workspace.names.describe(agent as never);
          return {
            ...described,
            runtime: workspace.agents.agent(agent as never)?.runtime ?? "lophn",
          };
        },
        harnessId: (runtime) =>
          (HARNESS_ADAPTER_OF_RUNTIME as Record<string, string>)[runtime] ??
          runtime,
        waits: (session) => ({
          approval: ctx.approvals.turnRequests(session).length > 0,
          question: ctx.questionWaits.list(session).length > 0,
        }),
        folders: (session) => sessionFoldersOf({ sql }, ctx.root.path, session),
        projectFolders: (project) => projectFolderPaths(sql, project),
        policy,
        emit(name, info, audience) {
          void ctx.eventDelivery
            .publish({
              publisher: "lophn",
              release: null,
              source: "lophn",
              event: name,
              payload: info,
              chain: [],
              parent: null,
              audience: (app) => audience(app),
            })
            .then((published) => {
              if (!published.ok) {
                ctx.telemetry.logger.warn({
                  component: "session-lifecycle",
                  event: "publish_failed",
                  fields: { name, message: published.error.message },
                });
              }
            });
        },
        anySubscriber: () => ctx.eventDelivery.hasSubscribers("lophn"),
        interruptTerminal: (tab) => ctx.terminalAgents.interrupt(tab),
        async stopTurn(turn, stateSeq) {
          const done = await ctx.writer.command(LIFECYCLE_CONTEXT, {
            command: stopTurn.name,
            input: {
              turn,
              request_key: crypto.randomUUID(),
              reason: "user_stopped",
            },
            compare: { state_seq: stateSeq },
            idempotency_key: crypto.randomUUID(),
            prepared: [],
          });
          return done.ok ? ok(undefined) : done;
        },
        async recordAppStop(app, session, title) {
          await ctx.noticeRecorder({
            kind: "session_stopped_by_app",
            app: app as Id<"app">,
            params: {
              session: session.slice(0, 40),
              ...(title === null ? {} : { title: title.slice(0, 40) }),
            },
          });
        },
      });

      unsubscribe = ctx.bus.subscribe(
        [{ types: [...LIFECYCLE_AGENT_EVENTS] }],
        {
          send: (event) => {
            // 같은 event를 받는 다른 구독자(대기 요청·질문의 메모리)가 먼저 갱신되도록 다음 microtask에 본다.
            queueMicrotask(() =>
              lifecycle.onAgentEvent(
                event as { type: string; session?: string },
              ),
            );
          },
          close() {},
        },
      );
      const coding = ctx.terminalAgents.coding;
      offTerminals = coding.onChange(() =>
        lifecycle.reportTerminals(coding.reports()),
      );

      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const sessionCommand = async (
        route: { name: string },
        input: unknown,
        compare: unknown,
        as: AuthenticatedContext = APP_SESSIONS_CONTEXT,
      ): Promise<Result<unknown>> => {
        const done = await ctx.writer.command(as, {
          command: route.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare,
          prepared: [],
        });
        return done.ok ? ok(done.value.result) : done;
      };
      const handler = appHandlerFor(() => ctx.appViews);
      const key = routeKey;

      return ok({
        memory: [
          [
            key(appSessionsList),
            handler(
              (
                app,
                input: {
                  workspace?: never;
                  state?: never;
                  harness?: string;
                  kind?: never;
                  session?: string;
                  app?: string;
                },
              ) => {
                // 한 session만 묻는 길(앱 화면의 ACP 붙이기가 보이는 session인지 본다). 보이면 한 줄, 아니면 빈 목록이다.
                if (input.session !== undefined) {
                  const found = lifecycle.find(app, input.session);
                  return ok({ sessions: found === null ? [] : [found] });
                }
                return ok({ sessions: lifecycle.list(app, input as never) });
              },
            ),
          ],
          [
            key(appSessionsStatus),
            handler(async (app, input: { session: string; app?: string }) => {
              if (lifecycle.find(app, input.session) === null) {
                return err({ code: "not_found", message: "session not found" });
              }
              return await ctx.runtime.readers.read(
                sessionStatusRead,
                LIFECYCLE_CONTEXT,
                { session: input.session },
              );
            }),
          ],
          [
            key(appSessionsStop),
            handler((app, input: { session: string; app?: string }) =>
              lifecycle.stop(app, input.session),
            ),
          ],
          [
            key(appSessionsOpen),
            handler(
              async (
                app,
                input: {
                  agent: string;
                  workspace?: Workspace;
                  title?: string;
                  app?: string;
                },
              ) => {
                const slug = workspace.apps.app(app as Id<"app">);
                if (slug === null || slug.archived) {
                  return err({ code: "not_found", message: "app not found" });
                }
                // workspace를 빼면 그 앱 workspace이고, 주면 그 앱이 call로 닿을 수 있는 workspace(call 정책)에만 연다.
                const target: Workspace = input.workspace ?? {
                  kind: "app",
                  id: app,
                };
                if (
                  !mayReachWorkspace(policy(), { kind: "app", id: app }, target)
                ) {
                  return err({
                    code: "forbidden",
                    message: "the call policy does not allow this workspace",
                  });
                }
                // agent는 handle로 부른다. 그 workspace에서 보이는 agent(전역, 그 workspace의 범위 agent, lophn) 가운데서 푼다.
                const resolved = workspace.names.resolveAddress({
                  agent: input.agent,
                  workspace:
                    target.kind === "project"
                      ? { project: target.id }
                      : { app: target.id },
                });
                if (!resolved.ok) return resolved;
                const opened = await sessionCommand(
                  workspaceSessionAppOpen,
                  {
                    id: ids.newId("ses"),
                    agent: resolved.value.agent,
                    workspace: target,
                    app,
                  },
                  {},
                  APP_SESSIONS_OPEN_CONTEXT,
                );
                if (!opened.ok) return opened;
                const session = (opened.value as { id: string }).id;
                // 제목은 겉모습이라 못 붙여도 session은 이미 열렸다.
                if (input.title !== undefined) {
                  await sessionCommand(
                    renameSession,
                    { session, title: input.title },
                    {
                      state_seq: (opened.value as { state_seq: string })
                        .state_seq,
                    },
                  );
                }
                return ok({ session });
              },
            ),
          ],
          [
            key(appSessionsEnd),
            handler(async (app, input: { session: string; app?: string }) => {
              const row = loadSession({ sql }, input.session);
              if (row === undefined) {
                return err({ code: "not_found", message: "session not found" });
              }
              // 이미 끝난 session은 그 앱이 열었으면 한 번 더 끝내도 그대로다(보이는지는 열린 session만 따진다).
              if (row.opened_by_app === app && row.lifecycle === "archived") {
                return ok({ ended: false });
              }
              if (lifecycle.find(app, input.session) === null) {
                return err({ code: "not_found", message: "session not found" });
              }
              // 앱은 자기가 연 session만 끝낸다. 사람이 연 session을 앱이 끝내지 못한다.
              if (row.opened_by_app !== app) {
                return err({
                  code: "forbidden",
                  message: "only the app that opened a session ends it",
                });
              }
              const ended = await sessionCommand(
                archiveSession,
                { session: row.id },
                { state_seq: row.state_seq },
              );
              return ended.ok ? ok({ ended: true }) : ended;
            }),
          ],
        ],
      });
    },
    closeWork() {
      unsubscribe?.();
      unsubscribe = undefined;
      offTerminals?.();
      offTerminals = undefined;
      connection?.close();
      connection = undefined;
    },
  };
};
