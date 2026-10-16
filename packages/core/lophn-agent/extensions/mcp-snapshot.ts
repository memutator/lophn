import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentPlace,
  mcpServersSetting,
} from "../../../protocol/lophn-agent/mod.ts";
import { type McpRuntimeServer, runtimeServerOfSetting } from "./mcp-server.ts";
import {
  collectProjectMcpEntries,
  type ProjectServerSource,
} from "./project-servers.ts";
import { openConnection } from "../../storage/ledger/mod.ts";

// 등록한 MCP server의 snapshot 재료다. 전역 설정 위에 모든 project의 `extensions.json`을 더한다.
// agent-runtime child의 `--allow-run`·`--allow-net`과 MCP OAuth begin의 서버 조회가 같은 snapshot을 읽는다.
// agent 정의가 가진 서버는 정의 파일에 있어 여기 없다.

// 전역(Workspace) 서버다. ledger 경로의 setting_choices 행을 readOnly로 열어 형식 검사를 지난 server 목록으로
// 옮긴다(credentials 열기와 별개다). 읽지 못하면 빈 목록이다.
function globalMcpServers(ledgerPath: string): Result<McpRuntimeServer[]> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const rows = opened.value.sql.all(
      "select layer, key, value from setting_choices where key = ?",
      [mcpServersSetting.key],
    );
    if (rows.length === 0) return ok([]);
    const shaped = mcpServersSetting.value_type.safeParse(
      JSON.parse(String(rows[0]["value"])),
    );
    return ok(shaped.success ? shaped.data.map(runtimeServerOfSetting) : []);
  } catch {
    return ok([]);
  } finally {
    opened.value.close();
  }
}

// core 프로세스의 비동기 file API다. 동기 file API는 core module graph에 두지 않는다.
const denoProjectSource: ProjectServerSource = {
  async list(dir) {
    try {
      const names: string[] = [];
      for await (const entry of Deno.readDir(dir)) names.push(entry.name);
      return names;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
  async read(path) {
    try {
      return await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  },
};

export type McpSnapshotDeps = {
  // 테스트가 바꿔 끼운다. 기본은 ledger의 설정 행과 data root의 project 폴더다.
  global?: () => Result<McpRuntimeServer[]>;
  projects?: ProjectServerSource;
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
  deps: McpSnapshotDeps = {},
): Promise<Result<RegisteredMcpServer[]>> {
  const global = deps.global?.() ?? globalMcpServers(ledgerPath);
  if (!global.ok) return global;
  const root = ledgerPath.slice(0, ledgerPath.lastIndexOf("/"));
  const projects = await collectProjectMcpEntries(
    root,
    deps.projects ?? denoProjectSource,
  );
  return ok([
    ...global.value.map((server) => ({ place: null, server })),
    ...projects,
  ]);
}

export async function mcpServerSnapshot(
  ledgerPath: string,
  deps: McpSnapshotDeps = {},
): Promise<Result<McpRuntimeServer[]>> {
  const registered = await registeredMcpServers(ledgerPath, deps);
  if (!registered.ok) return registered;
  return ok(registered.value.map((entry) => entry.server));
}
