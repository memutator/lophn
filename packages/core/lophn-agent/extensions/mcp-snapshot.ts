import { readdir, readFile } from "node:fs/promises";
import { errorCode, ok, type Result } from "../../../base/mod.ts";
import type {
  AgentId,
  McpOwnerWorkspace,
} from "../../../protocol/lophn-agent/mod.ts";
import { type McpRuntimeServer, runtimeServerOfLayer } from "./mcp-server.ts";
import { createFileSettingsReader } from "../../config/mod.ts";
import { globalMcpServersSetting } from "./settings.ts";
import {
  collectProjectMcpEntries,
  type ProjectServerSource,
} from "./project-servers.ts";
import type { ProjectLayer } from "./project-settings.ts";

// 등록한 MCP server의 snapshot 재료다. 전역 설정 위에 Home과 모든 project·앱의 `extensions.json`과 모든 agent 정의의
// 서버를 더한다. `mcp.` secret 목적지와 MCP OAuth begin의 서버 조회가 이 snapshot을 읽는다.
// agent 정의가 가진 서버는 정의 파일에 있어 조립이 `agents`로 넘긴다.

// 전역 서버다. 설정 파일에서 읽는다. 읽지 못하면 빈 목록이다.
function globalMcpServers(root: string): Result<McpRuntimeServer[]> {
  const servers = createFileSettingsReader(root).get(globalMcpServersSetting);
  return ok(
    (servers ?? []).map((server) => runtimeServerOfLayer(server, null)),
  );
}

// core 프로세스의 비동기 file API다. 동기 file API는 core module graph에 두지 않는다.
const fsProjectSource: ProjectServerSource = {
  async list(dir) {
    try {
      const names: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        names.push(entry.name);
      }
      return names;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  },
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  },
};

type McpSnapshotDeps = {
  // workspace 폴더 규칙이다. workspace 층의 값을 조립이 넘긴다.
  projectLayer: ProjectLayer;
  // 테스트가 바꿔 끼운다. 기본은 설정 파일과 data root의 workspace 폴더다.
  global?: () => Result<McpRuntimeServer[]>;
  projects?: ProjectServerSource;
  // 모든 agent 정의 층의 서버다. harness는 agent-workspaces를 모르므로 조립이 읽어 넘긴다. 없으면 빈 목록이다.
  agents?: () => Promise<Result<readonly AgentMcpEntry[]>>;
};

// agent 정의 층 서버와 그 agent id다.
export type AgentMcpEntry = {
  agent: AgentId;
  server: McpRuntimeServer;
};

// 서버와 그 서버가 놓인 곳이다. 전역 서버는 workspace와 agent가 모두 null이고, Home·project·app 서버는
// workspace만, agent 정의 층 서버는 agent만 있다.
export type RegisteredMcpServer = {
  workspace: McpOwnerWorkspace | null;
  agent: AgentId | null;
  server: McpRuntimeServer;
};

// 전역 서버가 먼저고 Home, project·앱 서버가 id 순으로, agent 정의 층 서버가 마지막으로 따른다. 서로 다른
// 소유자의 같은 이름은 모두 남고 `workspace`·`agent`로 가른다: OAuth 시작이 입력의 소유자로 서버를 고른다.
export async function registeredMcpServers(
  ledgerPath: string,
  deps: McpSnapshotDeps,
): Promise<Result<RegisteredMcpServer[]>> {
  const root = ledgerPath.slice(0, ledgerPath.lastIndexOf("/"));
  const global = deps.global?.() ?? globalMcpServers(root);
  if (!global.ok) return global;
  const projects = await collectProjectMcpEntries(
    root,
    deps.projects ?? fsProjectSource,
    deps.projectLayer,
  );
  const agents = (await deps.agents?.()) ?? ok([]);
  if (!agents.ok) return agents;
  return ok([
    ...global.value.map((server) => ({
      workspace: null,
      agent: null,
      server,
    })),
    ...projects,
    ...agents.value.map(({ agent, server }) => ({
      workspace: null,
      agent,
      server,
    })),
  ]);
}

export async function mcpServerSnapshot(
  ledgerPath: string,
  deps: McpSnapshotDeps,
): Promise<Result<McpRuntimeServer[]>> {
  const registered = await registeredMcpServers(ledgerPath, deps);
  if (!registered.ok) return registered;
  return ok(registered.value.map((entry) => entry.server));
}
