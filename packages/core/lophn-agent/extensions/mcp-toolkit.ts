import { err, ok, type Result } from "../../../base/mod.ts";
import { settingsList } from "../../../protocol/config/mod.ts";
import {
  type AgentId,
  type AgentWorkspace,
  agentRead,
  type McpServer,
  type McpToolServer,
  workspaceExtensionSettingsRead,
  workspaceKeyOf,
} from "../../../protocol/lophn-agent/mod.ts";
import { createListSettingsReader } from "../../config/mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { McpSourceOptions, McpToolkit } from "../run-loop/prepare.ts";
import {
  type McpRuntimeServer,
  mcpMissingSlot,
  mergeMcpLayers,
  runtimeServerOfLayer,
} from "./mcp-server.ts";
import { mcpToolEffect } from "./mcp-tools.ts";
import {
  checkMcpConfig,
  createMcpConnections,
  type McpConnections,
  type McpConnectionsDeps,
  type McpSelection,
  type McpToolCall,
  type McpToolEntry,
} from "./mod.ts";
import { globalMcpServersSetting } from "./settings.ts";

// 제품 runtime의 외부 MCP tool 등록이다. 서버는 전역 설정(`lophn-agent.extensions.mcp_servers`), workspace 층(Home,
// project, 앱), agent 정의 층에서 온다. 같은 이름은 마지막 층이 덮고 이름이 다르면 모두 쓴다. 연결과 재조회는 이 모듈 하나가
// 소유한다. list_changed 알림과 재연결 뒤 그 server의
// 전체 tool 목록을 다시 읽고, 재조회가 끝날 때까지 그 server tool 호출을 막는다.
// 재조회가 실패하면 옛 정의를 호출 가능으로 두지 않는다.

// 연결 표의 server 알림은 표 없이 온다(list_changed 알림만 서버 이름을 아는 것).
// 상태는 (assignment, server)마다 하나다.
type RefreshState = "fresh" | "refreshing" | "failed";

type McpToolkitDeps = {
  // machine 자격의 loopback. 사람의 registry(settings/get)를 읽는다.
  machine: CoreCall;
  connections: McpConnectionsDeps;
  // 연결 관리를 직접 주입하면 주어진 것을 쓴다(테스트). 없으면 deps로 만든다.
  // onListChanged는 이 모듈이 붙인다.
  create?: (deps: McpConnectionsDeps) => McpConnections;
};

export type McpKit = {
  // turn마다 받는 등록 통로다. prepare.ts의 Toolkit.mcp다.
  toolkit(assignment: string): McpToolkit;
  // Grants 화면이 읽는 서버별 tool 목록이다. workspace가 null이면 Home이다. turn의 등록·재조회 상태와 따로 이 호출 전용 연결로 읽는다.
  // agent가 있으면 그 정의 층의 서버를 마지막 층으로 더한다. 그 agent의 mcp_off는 적용하지 않는다:
  // 끈 server도 목록에 보여야 사람이 tool을 assign해 둘 수 있고, 끄기는 turn 준비가 맡는다.
  listTools(
    workspace: AgentWorkspace | null,
    agent: AgentId | null,
  ): Promise<Result<McpToolServer[]>>;
  // 데몬 종료다. 모든 연결을 닫는다.
  endAll(): Promise<void>;
};

// Home 층 서버의 소유자다. 전역(null)과 OAuth token 이름이 겹치지 않는다.
const HOME_OWNER = { kind: "home" } as const;

const TOOL_DESCRIPTION_MAX = 500;
// Grants 읽기에서 서버 하나에 주는 시간이다. core가 답을 기다리는 기한(15초)보다 짧아야 한다.
const LIST_SERVER_MAX_MS = 10_000;

export function createMcpToolkit(deps: McpToolkitDeps): McpKit {
  // list_changed 알림은 connections가 부른다. transport가 모르는
  // assignment는 상태 표로 찾는다: 해당하는 (assignment, server)를
  // fresh → refreshing으로 바꾸고 전체 목록을 다시 읽는다. 끝나면 fresh,
  // 못 하면 failed라 그 server의 호출은 계속 거절이다.
  const onListChanged = (server: string): void => {
    for (const [assignment, byServer] of refresh) {
      if (byServer.get(server) !== "fresh") continue;
      setState(assignment, server, "refreshing");
      void requery(assignment, server);
    }
  };
  const connections =
    deps.create !== undefined
      ? // 알림을 떼어 붙인다: deps 객체를 그대로 넘기고, 만들어진 연결 관리가
        // 서버 알림을 이 모듈로 돌린다.
        deps.create({ ...deps.connections, onListChanged })
      : createMcpConnections({ ...deps.connections, onListChanged });

  // (assignment → server name → 재조회 상태)다. list_changed·재연결 뒤
  // refreshing, 재조회 실패면 failed다. fresh 밖의 서버 tool은 호출이 거절된다.
  const refresh = new Map<string, Map<string, RefreshState>>();
  // source가 읽은 서버 설정이다. call이 call_timeout_ms를 읽고 판정 근거의
  // configuration_revision도 여기서 온다.
  const known = new Map<string, Map<string, McpRuntimeServer>>();
  // source가 받은 options다. call이 지금 설정을 다시 읽을 때 같은 workspace·agent 층으로 읽는다.
  const sourced = new Map<string, McpSourceOptions | undefined>();

  const stateOf = (assignment: string, server: string): RefreshState =>
    refresh.get(assignment)?.get(server) ?? "fresh";

  const setState = (
    assignment: string,
    server: string,
    state: RefreshState,
  ): void => {
    const byServer = refresh.get(assignment) ?? new Map();
    byServer.set(server, state);
    refresh.set(assignment, byServer);
  };

  const knownOf = (assignment: string): Map<string, McpRuntimeServer> => {
    const found = known.get(assignment);
    if (found !== undefined) return found;
    const made = new Map<string, McpRuntimeServer>();
    known.set(assignment, made);
    return made;
  };

  // 사람의 registry에서 등록 서버 설정을 읽는다. 설정이 없으면 기본([])과 같다.
  async function registeredServers(): Promise<
    Result<readonly McpRuntimeServer[]>
  > {
    const read = await readOf(deps.machine, settingsList, {
      keys: [globalMcpServersSetting.key],
    });
    if (!read.ok) return read;
    const servers = createListSettingsReader(read.value.settings).get(
      globalMcpServersSetting,
    );
    return ok(
      (servers ?? []).map((server) => runtimeServerOfLayer(server, null)),
    );
  }

  // 이 workspace(null은 Home)의 agent가 쓸 수 있는 서버다: 전역에 workspace 층, agent 정의 층이 차례로 덮인다. 하위 층을
  // 읽지 못하면 그 층이 없는 것과 같다: 위 층만 남긴다(fails closed).
  async function serversOf(
    workspace: AgentWorkspace | null,
    agent: McpSourceOptions["agent"],
  ): Promise<Result<readonly McpRuntimeServer[]>> {
    const global = await registeredServers();
    if (!global.ok) return global;
    const layers = [{ servers: global.value, off: [] as readonly string[] }];
    const own = await readOf(deps.machine, workspaceExtensionSettingsRead, {
      workspace: workspaceKeyOf(workspace),
    });
    if (own.ok) {
      const owner = workspace ?? HOME_OWNER;
      layers.push({
        servers: own.value.mcp_servers.map((server) =>
          runtimeServerOfLayer(server, owner),
        ),
        off: own.value.mcp_off,
      });
    }
    if (agent !== undefined) {
      layers.push({
        servers: agent.servers.map((server) =>
          runtimeServerOfLayer(server, null, agent.id),
        ),
        off: agent.off,
      });
    }
    return ok(mergeMcpLayers(layers));
  }

  // agent 정의 층이다. 정의를 읽지 못했거나 틀렸으면 그 층이 없는 것과 같다(fails closed).
  async function agentLayer(
    agent: AgentId,
  ): Promise<McpSourceOptions["agent"]> {
    const read = await readOf(deps.machine, agentRead, { agent });
    if (!read.ok || read.value.issues.length > 0) return undefined;
    const definition = read.value.definition as {
      mcp_servers?: readonly McpServer[];
    } | null;
    return { id: agent, servers: definition?.mcp_servers ?? [], off: [] };
  }

  // 전체 tools/list를 다시 읽는다. 끝나면 fresh, 못 하면 failed다.
  async function requery(assignment: string, server: string): Promise<void> {
    const listed = await connections.toolList(assignment, server);
    setState(assignment, server, listed.ok ? "fresh" : "failed");
  }

  // (assignment, server)의 연결을 얻고 도구 목록을 읽는다. 하나라도 못 하면 그
  // 서버는 failed다(문제 서버는 연결하지 않는 것과 같은 답).
  async function attach(
    assignment: string,
    server: McpRuntimeServer,
  ): Promise<boolean> {
    const acquired = await connections.acquire(
      assignment,
      server,
      new AbortController().signal,
    );
    if (!acquired.ok) {
      setState(assignment, server.name, "failed");
      return false;
    }
    // 연결 직후 전체 목록을 읽는다. 이 목록이 끝나기 전까지 그 server의
    // tool은 refresh 상태로 호출이 거절된다.
    setState(assignment, server.name, "refreshing");
    await requery(assignment, server.name);
    return stateOf(assignment, server.name) === "fresh";
  }

  // 서버 하나의 tool 목록이다. 호출마다 새 assignment라 turn의 연결과 상태를 공유하지 않는다. 상한이 지나면
  // 연결 중이어도 끊고 unreachable로 돌려준다.
  async function readServerTools(
    server: McpRuntimeServer,
  ): Promise<McpToolServer> {
    const unreachable = (reason: McpToolServer["reason"]): McpToolServer => ({
      name: server.name,
      tools: [],
      reason,
      trust: server.trust,
    });
    if (!server.enabled) return unreachable("disabled");
    const assignment = `grants-${crypto.randomUUID()}`;
    const cut = new AbortController();
    const timer = new AbortController();
    void deps.connections
      .deadline(LIST_SERVER_MAX_MS, timer.signal)
      .then((how) => {
        if (how === "elapsed") cut.abort();
      });
    const timedOut = new Promise<McpToolServer>((resolve) => {
      cut.signal.addEventListener(
        "abort",
        () => resolve(unreachable("unreachable")),
        { once: true },
      );
    });
    const read = async (): Promise<McpToolServer> => {
      const acquired = await connections.acquire(
        assignment,
        server,
        cut.signal,
      );
      const listed = acquired.ok
        ? await connections.toolList(assignment, server.name)
        : acquired;
      if (listed.ok) {
        return {
          name: server.name,
          tools: listed.value.tools.map((tool) => ({
            tool: tool.original,
            description: (tool.description ?? "").slice(
              0,
              TOOL_DESCRIPTION_MAX,
            ),
            effect: mcpToolEffect(tool),
          })),
          reason: null,
          trust: server.trust,
        };
      }
      const needsSignIn = connections
        .views()
        .some(
          (view) =>
            view.owner[0] === assignment && view.state === "failed_auth",
        );
      return unreachable(needsSignIn ? "sign_in" : "unreachable");
    };
    try {
      return await Promise.race([read(), timedOut]);
    } finally {
      timer.abort();
      await connections.endAssignment(assignment);
    }
  }

  function makeToolkit(assignmentId: string): McpToolkit {
    return {
      async source(assignment: string, options?: McpSourceOptions) {
        const registered = await serversOf(
          options?.workspace ?? null,
          options?.agent,
        );
        if (!registered.ok) return registered;
        sourced.set(assignment, options);
        const byServer = knownOf(assignment);
        byServer.clear();
        for (const server of registered.value) {
          byServer.set(server.name, server);
        }
        // 설정 검사(mcp-config)로 문제 서버를 골라낸다. enabled=false와
        // 재조회가 실패한 서버는 tool 목록에도 없다(옛 정의를 두지 않는다).
        const checked = checkMcpConfig(registered.value);
        if (!checked.ok) return checked;
        const servers = new Map<string, McpRuntimeServer>();
        const tools: McpToolEntry[] = [];
        for (const server of checked.value.valid) {
          if (!server.enabled) continue;
          // agent 정의가 통째로 끈 서버는 연결하지 않는다.
          if (options?.skip?.has(server.name)) continue;
          if (options?.only !== undefined && !options.only.has(server.name)) {
            continue;
          }
          if (stateOf(assignment, server.name) === "failed") continue;
          const attached = await attach(assignment, server);
          if (!attached) continue;
          servers.set(server.name, server);
          const listed = await connections.toolList(assignment, server.name);
          if (!listed.ok) continue;
          for (const tool of listed.value.tools) tools.push(tool);
        }
        return ok({ servers, tools });
      },

      // 모델에 내보일 MCP 선택(서버+현재 tool 정확한 쌍)을 골라낸다. 선택이 비어 있으면 null이고
      // buildMcpTools도 제공도 없다(호출도 없다).
      selection(definition: unknown): McpSelection | null {
        const shape = definition as {
          mcp?: {
            servers: readonly string[];
            tools: readonly { server_name: string; original_tool: string }[];
          } | null;
        };
        if (
          shape?.mcp === undefined ||
          shape.mcp === null ||
          shape.mcp.servers.length === 0 ||
          shape.mcp.tools.length === 0
        )
          return null;
        return {
          servers: [...shape.mcp.servers],
          tools: shape.mcp.tools.map((pair) => ({ ...pair })),
        };
      },

      // 도구 호출 통로다. 재조회가 진행·실패 중이면 그 server의 호출은
      // 거절이다. 연결이 살아 있지 않으면 reconnect로 다시 본다.
      call(): McpToolCall {
        // 호출을 거절하는 이유가 값 없음이나 인증 거절이면 빈 자리를 싣는다(agent가 `lophn ask secret`에 넘긴다).
        const refused = (
          serverName: string,
          message: string,
          override?: { state: string; missing_secret: string | null },
        ): Result<never> => {
          const server = knownOf(assignmentId).get(serverName);
          const connection =
            override ??
            connections
              .views?.()
              .find(
                (one) =>
                  one.owner[0] === assignmentId && one.owner[1] === serverName,
              );
          const slot =
            server === undefined || connection === undefined
              ? undefined
              : mcpMissingSlot(server, connection);
          return err({
            code: "unavailable",
            message,
            ...(slot === undefined ? {} : { details: { missing: slot } }),
          });
        };
        return async (invoke) => {
          const state = stateOf(assignmentId, invoke.server);
          if (state !== "fresh") {
            // 재조회가 끝날 때까지 그 server의 tool 호출을 막는다.
            return refused(
              invoke.server,
              state === "refreshing"
                ? "서버의 tool 목록을 다시 읽는 중이라 호출을 거절한다"
                : "서버의 tool 목록 재조회가 실패해 호출을 거절한다",
            );
          }
          const server = knownOf(assignmentId).get(invoke.server);
          if (server === undefined) {
            // 등록되지 않은 서버는 없는 tool과 같은 답이다.
            return err({
              code: "unavailable",
              message: "서버 설정이 등록되어 있지 않다",
            });
          }
          // 도는 turn 안에서 사람이 끈 server는 연결이 살아 있어도 부르지 않는다. 읽기가 실패해도 거절이다.
          // agent 정의 층의 off는 turn 시작 때 정한 값이라 여기서 바뀌지 않는다.
          const options = sourced.get(assignmentId);
          const now = await serversOf(
            options?.workspace ?? null,
            options?.agent,
          );
          const live = now.ok
            ? now.value.find((s) => s.name === invoke.server)
            : undefined;
          if (
            live === undefined ||
            !live.enabled ||
            options?.skip?.has(invoke.server)
          ) {
            return err({
              code: "unavailable",
              message: "the MCP server was turned off, so the call is rejected",
            });
          }
          for (;;) {
            const sent = await connections.call(
              assignmentId,
              invoke.server,
              invoke.original,
              invoke.input,
              new AbortController().signal,
              server.call_timeout_ms,
            );
            if (sent.kind === "no_connection") {
              // 뜻하지 않은 끊김이다. 다시 연결하고 전체 목록을 다시
              // 읽을 때까지 다음 시도도 거절된다. 재연결 한도·인증
              // 거절은 그대로 err다.
              const reconnected = await connections.reconnect(
                assignmentId,
                invoke.server,
              );
              if (!reconnected.ok) {
                setState(assignmentId, invoke.server, "failed");
                return refused(invoke.server, reconnected.error.message);
              }
              setState(assignmentId, invoke.server, "refreshing");
              await requery(assignmentId, invoke.server);
              // 재조회가 실패하면 failed다. 호출은 그래도 거절이다.
              if (stateOf(assignmentId, invoke.server) !== "fresh") {
                return refused(
                  invoke.server,
                  "서버의 tool 목록 재조회가 실패해 호출을 거절한다",
                );
              }
              continue;
            }
            if (sent.kind === "auth_failed") {
              setState(assignmentId, invoke.server, "failed");
              return refused(invoke.server, sent.message, {
                state: "failed_auth",
                missing_secret: null,
              });
            }
            if (sent.kind === "success") {
              return ok({ kind: "answered", result: sent.result });
            }
            // 보낸 뒤 답이 없다. 효과가 났을 수 있어 model이 알아야 한다.
            if (sent.kind === "uncertain") return ok({ kind: "uncertain" });
            // not_executed다. 설정이 회수돼 서버에 닿지 않았다.
            return err({
              code: "unavailable",
              message: "서버 설정이 회수됐다",
            });
          }
        };
      },
    };
  }

  const kit: McpKit = {
    toolkit(assignment) {
      return makeToolkit(assignment);
    },
    async listTools(workspace, agent) {
      const registered = await serversOf(
        workspace,
        agent === null ? undefined : await agentLayer(agent),
      );
      if (!registered.ok) return registered;
      const checked = checkMcpConfig(registered.value);
      if (!checked.ok) return checked;
      // 느린 서버 하나가 다른 서버의 목록을 막지 않도록 나란히 읽고, 서버마다 core 기한보다 짧은 상한을 둔다.
      return ok(await Promise.all(checked.value.valid.map(readServerTools)));
    },
    async endAll() {
      await connections.endAll();
    },
  };
  return kit;
}
