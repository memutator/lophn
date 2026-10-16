import type { AgentPlace } from "../../../protocol/lophn-agent/mod.ts";
import {
  parseProjectExtensions,
  PROJECT_EXTENSIONS_FILE,
} from "./project-settings.ts";
import { type McpRuntimeServer, runtimeServerOfLayer } from "./mcp-server.ts";

// 모든 project의 MCP 서버 모음. agent-runtime child의 Deno 권한
// (`--allow-run`·`--allow-net`)은 띄울 때 정해지므로 core가 모든 project 파일의 서버를 한 번에 모아 전역 서버와 함께
// 권한 목록을 만든다. 권한은 서버가 선언한 실행 파일과 host:port만이다. 파일 IO는 비동기 port로 받는다.

export type ProjectServerSource = {
  // 폴더의 바로 아래 이름이다. 폴더가 없으면 null이다.
  list(dir: string): Promise<readonly string[] | null>;
  // 파일 글이다. 없으면 null이다.
  read(path: string): Promise<string | null>;
};

const PROJECT_ID = /^prj_[0-9a-z]+$/;

// 서버와 그 서버가 놓인 project다. 같은 이름의 서버가 서로 다른 project에 있어도 따로 남는다.
type ProjectMcpEntry = { place: AgentPlace; server: McpRuntimeServer };

// `<root>/projects/*/extensions.json`이 가진 서버를 project id 순으로 모은다. 틀린 파일이나 읽지 못한 파일은 그
// project 서버만 빠진다. project id 모양이 아닌 폴더는 project가 아니다.
export async function collectProjectMcpEntries(
  root: string,
  source: ProjectServerSource,
): Promise<ProjectMcpEntry[]> {
  const found: ProjectMcpEntry[] = [];
  let ids: readonly string[] | null;
  try {
    ids = await source.list(`${root}/projects`);
  } catch {
    return found;
  }
  for (const id of (ids ?? []).filter((name) => PROJECT_ID.test(name)).sort()) {
    try {
      const text = await source.read(
        `${root}/projects/${id}/${PROJECT_EXTENSIONS_FILE}`,
      );
      if (text === null) continue;
      const parsed = parseProjectExtensions(text);
      if (!parsed.ok) continue;
      const place = { kind: "project", id } as AgentPlace;
      for (const server of parsed.value.mcp_servers) {
        found.push({ place, server: runtimeServerOfLayer(server, place) });
      }
    } catch {
      // 읽지 못한 project는 서버가 없는 것으로 닫는다.
    }
  }
  return found;
}
