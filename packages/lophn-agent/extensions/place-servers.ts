import type {
  AgentPlace,
  McpServerConfig,
} from "../../protocol/lophn-agent/mod.ts";
import { parsePlaceMcpFile, PLACE_MCP_FILE } from "./place-store.ts";

// 모든 자리의 MCP 서버 모음(concern lophn-agent/extensions R32, R33). agent-runtime child의 Deno 권한
// (`--allow-run`·`--allow-net`)은 띄울 때 정해지므로 core가 모든 자리 파일의 서버를 한 번에 모아 전역 서버와 함께
// 권한 목록을 만든다. 권한은 서버가 선언한 실행 파일과 host:port만이다. 파일 IO는 비동기 port로 받는다.

export type PlaceServerSource = {
  // 폴더의 바로 아래 이름이다. 폴더가 없으면 null이다.
  list(dir: string): Promise<readonly string[] | null>;
  // 파일 글이다. 없으면 null이다.
  read(path: string): Promise<string | null>;
};

const PLACE_ID = /^(prj|app)_[0-9a-z]+$/;

// 서버와 그 서버가 등록된 자리다. 같은 이름의 서버가 서로 다른 자리에 있어도 따로 남는다.
export type PlaceMcpEntry = { place: AgentPlace; server: McpServerConfig };

// `<root>/projects/*`와 `<root>/apps/*`의 `mcp-servers.json`이 가진 서버를 자리 id 순으로 모은다. 틀린 파일이나
// 읽지 못한 파일은 그 자리 서버만 빠진다(R12). 자리 id 모양이 아닌 폴더는 자리가 아니다.
export async function collectPlaceMcpServers(
  root: string,
  source: PlaceServerSource,
): Promise<McpServerConfig[]> {
  return (await collectPlaceMcpEntries(root, source)).map((entry) =>
    entry.server
  );
}

// collectPlaceMcpServers와 같되 서버마다 등록된 자리를 붙인다. OAuth 시작이 자리로 서버를 고른다(R16).
export async function collectPlaceMcpEntries(
  root: string,
  source: PlaceServerSource,
): Promise<PlaceMcpEntry[]> {
  const found: PlaceMcpEntry[] = [];
  for (const area of ["projects", "apps"] as const) {
    let ids: readonly string[] | null;
    try {
      ids = await source.list(`${root}/${area}`);
    } catch {
      continue;
    }
    for (const id of (ids ?? []).filter((name) => PLACE_ID.test(name)).sort()) {
      try {
        const text = await source.read(
          `${root}/${area}/${id}/${PLACE_MCP_FILE}`,
        );
        if (text === null) continue;
        const parsed = parsePlaceMcpFile(text);
        if (!parsed.ok) continue;
        const place = {
          kind: area === "projects" ? "project" : "app",
          id,
        } as AgentPlace;
        for (const server of parsed.value.mcp_servers) {
          found.push({ place, server });
        }
      } catch {
        // 읽지 못한 자리는 서버가 없는 것으로 닫는다.
      }
    }
  }
  return found;
}

// 전역 서버가 먼저고, 전역과 이름이 같은 자리 서버는 쓰지 않는다(R33). 서로 다른 자리의 같은 이름은 둘 다
// 남는다: 자리마다 다른 서버이고 권한은 둘 다 필요하다.
export function mergeMcpServers(
  global: readonly McpServerConfig[],
  place: readonly McpServerConfig[],
): McpServerConfig[] {
  const taken = new Set(global.map((server) => server.name));
  return [...global, ...place.filter((server) => !taken.has(server.name))];
}
