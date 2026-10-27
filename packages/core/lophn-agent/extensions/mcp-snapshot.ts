import { readdir, readFile } from "node:fs/promises";
import { errorCode, ok, type Result } from "../../../base/mod.ts";
import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import { type McpRuntimeServer, runtimeServerOfLayer } from "./mcp-server.ts";
import { createFileSettingsReader } from "../../config/mod.ts";
import { globalMcpServersSetting } from "./settings.ts";
import {
  collectProjectMcpEntries,
  type ProjectServerSource,
} from "./project-servers.ts";
import type { ProjectLayer } from "./project-settings.ts";

// 등록한 MCP server의 snapshot 재료다. 전역 설정 위에 모든 project의 `extensions.json`을 더한다.
// `mcp.` secret 목적지와 MCP OAuth begin의 서버 조회가 이 snapshot을 읽는다.
// Operator 정의가 가진 서버는 정의 파일에 있어 조립이 `operators`로 넘긴다. `registeredMcpServers`에는 섞지 않는다:
// OAuth begin은 place로 서버를 고르는데 Operator 층 서버는 로그인 길이 없다.

// 전역(Workspace) 서버다. 설정 파일에서 읽는다. 읽지 못하면 빈 목록이다.
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
  // project 폴더 규칙이다. role 층의 값을 조립이 넘긴다.
  projectLayer: ProjectLayer;
  // 테스트가 바꿔 끼운다. 기본은 설정 파일과 data root의 project 폴더다.
  global?: () => Result<McpRuntimeServer[]>;
  projects?: ProjectServerSource;
  // 모든 Operator 정의 층의 서버다. harness는 agent-roles를 모르므로 조립이 읽어 넘긴다. 없으면 빈 목록이다.
  operators?: () => Promise<Result<readonly OperatorMcpEntry[]>>;
};

// Operator 정의 층 서버와 그 Operator가 놓인 곳이다.
export type OperatorMcpEntry = {
  place: AgentPlace;
  server: McpRuntimeServer;
};

// 서버와 그 서버가 놓인 곳이다. 전역(Workspace) 서버는 place가 null이다.
export type RegisteredMcpServer = {
  place: AgentPlace | null;
  server: McpRuntimeServer;
};

// 전역 서버가 먼저고 project 서버가 project id 순으로 따른다. 서로 다른 place의 같은 이름은 모두 남고 `place`로
// 가른다: OAuth 시작이 입력의 place로 서버를 고른다.
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
  return ok([
    ...global.value.map((server) => ({ place: null, server })),
    ...projects,
  ]);
}

export async function mcpServerSnapshot(
  ledgerPath: string,
  deps: McpSnapshotDeps,
): Promise<Result<McpRuntimeServer[]>> {
  const registered = await registeredMcpServers(ledgerPath, deps);
  if (!registered.ok) return registered;
  const operators = (await deps.operators?.()) ?? ok([]);
  if (!operators.ok) return operators;
  return ok([
    ...registered.value.map((entry) => entry.server),
    ...operators.value.map((entry) => entry.server),
  ]);
}
