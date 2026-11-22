// agent가 다른 컴퓨터에서 부를 수 있는 것을 읽는 route(`a2a/sessions|agents`, `machines/sessions|agents`)를 memory로 낸다.
// 받는 쪽은 같은 ledger를 읽는 main thread 연결로 열린 session과 project·앱을 읽고, 명함은 reader의 `agents/cards`를 이 wiring의
// machine 자격으로 읽는다. 명단과 link는 remote wiring이 늦게 낸다(`ctx.machineLinks`).
import { ok } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { LOPHN_AGENT_HANDLE } from "../../../../protocol/lophn-agent/agent-values.ts";
import {
  type AgentCard,
  agentCards,
} from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  a2aAgents,
  a2aSessions,
  machinesAgents,
  machinesSessions,
} from "../../../../protocol/lophn-agent/a2a.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../../protocol/server/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { sessionStateOf } from "../../../lophn-agent/session/state.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { projectByIdentity } from "../../../projects/lookups.ts";
import { loadProject } from "../../../projects/registry/mod.ts";
import {
  type A2aListsDeps,
  createA2aLists,
} from "../../../remote/a2a-lists.ts";
import { remoteReach, remoteWorkspaceOf } from "../../../router/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import { routeKey } from "./app-principal.ts";
import type { WiringFactory } from "./context.ts";

const A2A_LISTS_PRINCIPAL = "machine:a2a-lists";
const A2A_LISTS_CONTEXT: AuthenticatedContext = {
  principal: A2A_LISTS_PRINCIPAL,
  actor: "machine",
  scope: { operations: [agentCards.name], targets: {} },
  conditions: {},
  credential_ref: A2A_LISTS_PRINCIPAL,
};

type ReadSql = Pick<Sql, "get" | "all">;

// 받는 쪽이 이 기계의 ledger에서 읽는 것. 열린 session은 Router의 session 목록과 같은 규칙(받는지, 상태)으로 읽는다.
export function a2aListsReads(
  sql: ReadSql,
): Pick<
  A2aListsDeps,
  "openSessions" | "project" | "projectByIdentity" | "app"
> {
  const workspaces = workspaceDepsOf(sql);
  return {
    openSessions: () =>
      createSessionDirectory({
        ...workspaces,
        // 읽기만 한다. session을 열지 않는다.
        publish: () => {},
        sql: () => sql,
      })
        .listOpen()
        .map((one) => ({
          session: one.session,
          handle: one.handle,
          name: one.name,
          title: one.title,
          workspace: one.agent.workspace,
          accepting: one.accepting,
          opened_by_machine: one.opened_by_machine,
          spawned_by: one.spawned_by,
          state: sessionStateOf(sql, one.session).state,
          last_active_at: one.last_active_at,
        })),
    project(id) {
      const loaded = loadProject(sql, id);
      if (!loaded.ok || loaded.value === null) return null;
      const { name, identity, status } = loaded.value;
      return { name, identity, archived: status === "archived" };
    },
    projectByIdentity: (identity) => projectByIdentity(sql, identity),
    app(id) {
      const app = workspaces.apps.app(id as Id<"app">);
      return app === null ? null : { name: app.name, archived: app.archived };
    },
  };
}

export const a2aListsWiring: WiringFactory = () => {
  let connection: LedgerConnection | undefined;
  return {
    name: "a2a-lists",
    records: () => [A2A_LISTS_CONTEXT],
    build(ctx) {
      const opened = openConnection(ctx.ledgerPath);
      if (!opened.ok) return opened;
      connection = opened.value;
      const { sql } = opened.value;
      const policy = () =>
        ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;
      const lists = createA2aLists({
        policy,
        computers: () => ctx.machineLinks.computers(),
        resolve: (ref) => ctx.machineLinks.resolve(ref),
        call: (device, call, by) => ctx.machineLinks.call(device, call, by),
        ...a2aListsReads(sql),
        async cards(workspace, withoutApps) {
          const read = await ctx.runtime.readers.read(
            agentCards,
            A2A_LISTS_CONTEXT,
            { workspace, without_apps: [...withoutApps] },
          );
          return read.ok
            ? ok((read.value as { cards: AgentCard[] }).cards)
            : read;
        },
        sender(session) {
          const reach = remoteReach(sql, session, policy());
          if (!reach.ok) return reach;
          const { name } = workspaceDepsOf(sql).names.describe(
            reach.value.agent,
          );
          return ok({ ...reach.value, name });
        },
        // 이름이 없으면 부른 session의 workspace다(handle `lophn`의 규칙).
        remoteWorkspace: (name, caller) =>
          remoteWorkspaceOf(sql, name, LOPHN_AGENT_HANDLE, caller),
      });
      return ok({
        memory: [
          [
            routeKey(a2aSessions),
            (who: AuthenticatedContext) => lists.sessions(who),
          ],
          [
            routeKey(a2aAgents),
            (who: AuthenticatedContext, input: unknown) =>
              lists.agents(who, input as never),
          ],
          [
            routeKey(machinesSessions),
            (who: AuthenticatedContext, input: unknown) =>
              lists.machineSessions(who, input as never),
          ],
          [
            routeKey(machinesAgents),
            (who: AuthenticatedContext, input: unknown) =>
              lists.machineAgents(who, input as never),
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
