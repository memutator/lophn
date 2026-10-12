import { err, ok, type Result } from "../../../base/mod.ts";
import type { McpServerConfig } from "../../../protocol/lophn-agent/mod.ts";
import {
  type AgentPlace,
  mcpServersSetting,
  placeExtensionSettingsRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { settingsGet } from "../../../protocol/config/mod.ts";
import type { ToolDefinition } from "../tools/mod.ts";
import {
  checkMcpConfig,
  createMcpConnections,
  type McpConnections,
  type McpConnectionsDeps,
  type McpSelection,
  type McpToolCall,
  type McpToolEntry,
} from "./mod.ts";
import { type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { McpSourceOptions, McpToolkit } from "../run-loop/prepare.ts";

// 제품 runtime의 외부 MCP tool 등록이다(Q16, T37). 사람의 registry(
// `lophn-agent.extensions.mcp_servers` 설정)와 preset 선택만이 출처이며 연결과
// 재조회는 이 모듈 하나가 소유한다. list_changed 알림과 재연결 뒤 그 server의
// 전체 tool 목록을 다시 읽고, 재조회가 끝날 때까지 그 server tool 호출을 막는다.
// 재조회가 실패하면 옛 정의를 호출 가능으로 두지 않는다(Q16).

// 연결 표의 server 알림은 표 없이 온다(list_changed 알림만 서버 이름을 아는 것).
// 상태는 (assignment, server)마다 하나다.
type RefreshState = "fresh" | "refreshing" | "failed";

export type McpToolkitDeps = {
  // machine 자격의 loopback. 사람의 registry(settings/get)를 읽는다.
  machine: CoreCall;
  connections: McpConnectionsDeps;
  // 연결 관리를 직접 주입하면 주어진 것을 쓴다(테스트). 없으면 deps로 만든다.
  // onListChanged는 이 모듈이 붙인다(Q16).
  create?: (deps: McpConnectionsDeps) => McpConnections;
};

export type McpKit = {
  // run마다 받는 등록 통로다. prepare.ts의 Toolkit.mcp 자리다.
  toolkit(assignment: string): McpToolkit;
  // 데몬 종료다(R18). 모든 연결을 닫는다.
  endAll(): Promise<void>;
};

export function createMcpToolkit(deps: McpToolkitDeps): McpKit {
  // list_changed 알림은 connections가 부른다(Q16). transport가 모르는
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
  const connections = deps.create !== undefined
    // 알림을 떼어 붙인다(Q16): deps 객체를 그대로 넘기고, 만들어진 연결 관리가
    // 서버 알림을 이 모듈로 돌린다.
    ? deps.create({ ...deps.connections, onListChanged })
    : createMcpConnections({ ...deps.connections, onListChanged });

  // (assignment → server name → 재조회 상태)다(Q16). list_changed·재연결 뒤
  // refreshing, 재조회 실패면 failed다. fresh 밖의 서버 tool은 호출 거절과
  // connectionRevision undefined다.
  const refresh = new Map<string, Map<string, RefreshState>>();
  // source가 읽은 서버 설정이다. call이 call_timeout_ms를 읽고 R24 판정 근거의
  // configuration_revision도 여기서 온다.
  const known = new Map<string, Map<string, McpServerConfig>>();

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

  const knownOf = (assignment: string): Map<string, McpServerConfig> => {
    const found = known.get(assignment);
    if (found !== undefined) return found;
    const made = new Map<string, McpServerConfig>();
    known.set(assignment, made);
    return made;
  };

  // 사람의 registry에서 등록 서버 설정을 읽는다(R11). 설정이 없으면 기본([])과 같다.
  async function registeredServers(): Promise<
    Result<readonly McpServerConfig[]>
  > {
    const read = await readOf(deps.machine, settingsGet, {
      keys: [mcpServersSetting.key],
    });
    if (!read.ok) return read;
    const setting = read.value.settings.find((entry) =>
      entry.key === mcpServersSetting.key
    );
    if (setting === undefined || setting.value === null) return ok([]);
    const shaped = mcpServersSetting.value_type.safeParse(setting.value);
    if (!shaped.success) {
      return err({
        code: "unavailable",
        message: "MCP server 설정이 형식을 벗어났다",
      });
    }
    return ok(shaped.data);
  }

  // 이 자리의 agent가 고를 수 있는 서버다: 전역 서버가 먼저고 그 자리 층의 서버가 이어진다(extensions R32).
  // 전역과 이름이 겹치는 자리 서버는 쓰지 않는다(R33). 자리 층을 읽지 못하면 그 층이 없는 것과 같다: 전역
  // 서버만 남긴다(R11: fails closed).
  async function serversOf(
    place: AgentPlace | null,
  ): Promise<Result<readonly McpServerConfig[]>> {
    const global = await registeredServers();
    if (!global.ok || place === null) return global;
    const own = await readOf(deps.machine, placeExtensionSettingsRead, {
      place,
    });
    if (!own.ok) return global;
    const taken = new Set(global.value.map((server) => server.name));
    return ok([
      ...global.value,
      ...own.value.settings.mcp_servers.filter((server) =>
        !taken.has(server.name)
      ),
    ]);
  }

  // 전체 tools/list를 다시 읽는다(Q16). 끝나면 fresh, 못 하면 failed다.
  async function requery(
    assignment: string,
    server: string,
  ): Promise<void> {
    const listed = await connections.toolList(assignment, server);
    setState(assignment, server, listed.ok ? "fresh" : "failed");
  }

  // (assignment, server)의 연결을 얻고 도구 목록을 읽는다. 하나라도 못 하면 그
  // 서버는 failed다(R11: 문제 서버는 연결하지 않는 것과 같은 답).
  async function attach(
    assignment: string,
    server: McpServerConfig,
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
    // 연결 직후 전체 목록을 읽는다(Q16). 이 목록이 끝나기 전까지 그 server의
    // tool은 refresh 상태로 호출이 거절된다.
    setState(assignment, server.name, "refreshing");
    await requery(assignment, server.name);
    return stateOf(assignment, server.name) === "fresh";
  }

  function makeToolkit(assignmentId: string): McpToolkit {
    return {
      async source(assignment: string, options?: McpSourceOptions) {
        const registered = await serversOf(options?.place ?? null);
        if (!registered.ok) return registered;
        const byServer = knownOf(assignment);
        byServer.clear();
        for (const server of registered.value) {
          byServer.set(server.name, server);
        }
        // 설정 검사(mcp-config)로 문제 서버를 골라낸다(R12). enabled=false와
        // 재조회가 실패한 서버는 tool 목록에도 없다(Q16: 옛 정의를 두지 않는다).
        const checked = checkMcpConfig(registered.value);
        if (!checked.ok) return checked;
        const servers = new Map<string, McpServerConfig>();
        const tools: McpToolEntry[] = [];
        for (const server of checked.value.valid) {
          if (!server.enabled) continue;
          // agent 정의가 통째로 끈 서버는 연결하지 않는다(R18, R31).
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

      // preset 판의 MCP 선택(서버+현재 tool 정확한 쌍, R31)과 safe 표시를 골라낸다.
      // 선택이 비어 있으면 null이고 buildMcpTools도 제공도 없다(호출도 없다).
      selection(definition: unknown): McpSelection | null {
        const shape = definition as {
          mcp?: {
            servers: readonly string[];
            tools: readonly { server_name: string; original_tool: string }[];
          } | null;
          safe_tools?:
            | readonly {
              server_name: string;
              original_tool: string;
            }[]
            | null;
        };
        if (
          shape?.mcp === undefined || shape.mcp === null ||
          shape.mcp.servers.length === 0 || shape.mcp.tools.length === 0
        ) return null;
        return {
          servers: [...shape.mcp.servers],
          tools: shape.mcp.tools.map((pair) => ({ ...pair })),
          safe_tools: (shape.safe_tools ?? []).map((pair) => ({ ...pair })),
        };
      },

      // 도구 호출 통로다(Q16). 재조회가 진행·실패 중이면 그 server의 호출은
      // 거절이다. 연결이 살아 있지 않으면 reconnect로 다시 본다(R20).
      call(): McpToolCall {
        return async (invoke) => {
          const state = stateOf(assignmentId, invoke.server);
          if (state !== "fresh") {
            // Q16: 재조회가 끝날 때까지 그 server의 tool 호출을 막는다.
            return err({
              code: "unavailable",
              message: state === "refreshing"
                ? "서버의 tool 목록을 다시 읽는 중이라 호출을 거절한다"
                : "서버의 tool 목록 재조회가 실패해 호출을 거절한다",
            });
          }
          const server = knownOf(assignmentId).get(invoke.server);
          if (server === undefined) {
            // 등록되지 않은 서버는 없는 tool과 같은 답이다(R11).
            return err({
              code: "unavailable",
              message: "서버 설정이 등록되어 있지 않다",
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
              // 뜻하지 않은 끊김이다. 다시 연결하고(Q20) 전체 목록을 다시
              // 읽을 때까지(Q16) 다음 시도도 거절된다. 재연결 한도·인증
              // 거절은 그대로 err다(R20).
              const reconnected = await connections.reconnect(
                assignmentId,
                invoke.server,
              );
              if (!reconnected.ok) {
                setState(assignmentId, invoke.server, "failed");
                return err({
                  code: "unavailable",
                  message: reconnected.error.message,
                });
              }
              setState(assignmentId, invoke.server, "refreshing");
              await requery(assignmentId, invoke.server);
              // 재조회가 실패하면 failed다. 호출은 그래도 거절이다(Q16).
              if (stateOf(assignmentId, invoke.server) !== "fresh") {
                return err({
                  code: "unavailable",
                  message: "서버의 tool 목록 재조회가 실패해 호출을 거절한다",
                });
              }
              continue;
            }
            if (sent.kind === "success") return ok(sent.result);
            // failure다. code는 상한 종류(EXTERNAL_TOOL_ERRORS)다. 서버의
            // tool_error는 호출이 실패한 것이고 나머지는 그대로 온다(R2).
            if (sent.kind === "failure") {
              const code = sent.code === "tool_error"
                ? "unavailable" as const
                : sent.code as
                  | "invalid_input"
                  | "not_found"
                  | "forbidden"
                  | "unavailable";
              return err({ code, message: sent.message });
            }
            // uncertain·not_executed다. 응답은 못 받았거나 설정이 회수됐다.
            // 모두 모른다(R19, R20).
            return err({
              code: "unavailable",
              message: sent.kind === "not_executed"
                ? "서버 설정이 회수됐다"
                : sent.message,
            });
          }
        };
      },

      // 서버의 연결 설정 판이다(판정 근거 mcp_configuration_revision, R24).
      // 등록 서버이고 재조회가 진행·실패 중이 아니면 revision을 건넨다. 등록
      // 밖 서버·재조회 중 서버는 undefined다(Q16).
      connectionRevision(
        definition: ToolDefinition,
      ): { revision: number } | undefined {
        // external 정의에서 서버 이름을 떼어 등록 판을 본다. 등록 밖 서버·
        // 재조회 중 서버는 undefined로 판정이 connection lost다(Q16).
        const name = serverNameOf(definition);
        if (name === undefined) return undefined;
        const server = knownOf(assignmentId).get(name);
        if (server === undefined) return undefined;
        if (stateOf(assignmentId, name) !== "fresh") return undefined;
        return { revision: server.revision };
      },
    };
  }

  const kit: McpKit = {
    toolkit(assignment) {
      return makeToolkit(assignment);
    },
    async endAll() {
      await connections.endAll();
    },
  };
  return kit;
}

// external 정의의 description에서 서버 이름을 뗀다. 정의는
// `MCP tool <original> of server <server>: ...` 모양이다(Q15, T37 모듈).
function serverNameOf(definition: ToolDefinition): string | undefined {
  const match = /of server ([^:]+):/.exec(definition.description);
  if (match === null) return undefined;
  return match[1];
}
