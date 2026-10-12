import { ok, type Result } from "../../packages/base/mod.ts";
import {
  type AgentPlace,
  type McpServerConfig,
  mcpServersSetting,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  collectPlaceMcpEntries,
  mergeMcpServers,
  type PlaceServerSource,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";

// 등록한 MCP server의 snapshot 재료다(extensions R11, R32). 전역 설정 위에 모든 자리의 `mcp-servers.json`을
// 더한다. agent-runtime child의 `--allow-run`·`--allow-net`과 MCP OAuth begin의 서버 조회가 같은 snapshot을
// 읽는다. 전역과 이름이 같은 자리 서버는 쓰지 않는다(R33).

// 전역(Workspace) 서버다. ledger 경로의 setting_choices 행을 readOnly로 열어 형식 검사를 지난 server 목록으로
// 옮긴다(credentials 열기와 별개다). 읽지 못하면 빈 목록이다.
function globalMcpServers(ledgerPath: string): Result<McpServerConfig[]> {
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
    return ok(shaped.success ? shaped.data : []);
  } catch {
    return ok([]);
  } finally {
    opened.value.close();
  }
}

// core 프로세스의 비동기 file API다. 동기 file API는 core module graph에 두지 않는다.
const denoPlaceSource: PlaceServerSource = {
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
  // 테스트가 바꿔 끼운다. 기본은 ledger의 설정 행과 data root의 자리 폴더다.
  global?: () => Result<McpServerConfig[]>;
  places?: PlaceServerSource;
};

// 서버와 그 서버가 등록된 자리다. 전역(Workspace) 서버는 자리가 null이다.
export type RegisteredMcpServer = {
  place: AgentPlace | null;
  server: McpServerConfig;
};

// 전역 서버가 먼저고 자리 서버가 자리 id 순으로 따른다. 전역과 이름이 같은 자리 서버는 쓰지 않으므로 빠진다(R33).
// 서로 다른 자리의 같은 이름은 둘 다 남고 `place`로 가른다: OAuth 시작이 입력의 자리로 서버를 고른다(R16).
export async function registeredMcpServers(
  ledgerPath: string,
  deps: McpSnapshotDeps = {},
): Promise<Result<RegisteredMcpServer[]>> {
  const global = deps.global?.() ?? globalMcpServers(ledgerPath);
  if (!global.ok) return global;
  const root = ledgerPath.slice(0, ledgerPath.lastIndexOf("/"));
  const places = await collectPlaceMcpEntries(
    root,
    deps.places ?? denoPlaceSource,
  );
  // 겹침 규칙(R33)은 mergeMcpServers 하나다: 살아남은 서버만 자리와 함께 남긴다.
  const kept = new Set(mergeMcpServers(
    global.value,
    places.map((entry) => entry.server),
  ));
  return ok([
    ...global.value.map((server) => ({ place: null, server })),
    ...places.filter((entry) => kept.has(entry.server)),
  ]);
}

export async function mcpServerSnapshot(
  ledgerPath: string,
  deps: McpSnapshotDeps = {},
): Promise<Result<McpServerConfig[]>> {
  const registered = await registeredMcpServers(ledgerPath, deps);
  if (!registered.ok) return registered;
  return ok(registered.value.map((entry) => entry.server));
}
