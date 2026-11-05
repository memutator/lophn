import type { AgentWorkspace } from "../../../protocol/lophn-agent/mod.ts";
import {
  parseProjectExtensions,
  type ProjectLayer,
} from "./project-settings.ts";
import { type McpRuntimeServer, runtimeServerOfLayer } from "./mcp-server.ts";

// 모든 project의 MCP 서버 모음. `mcp.` secret 목적지와 MCP OAuth begin이 workspace로 서버를 골라야 하므로
// core가 모든 project 파일의 서버를 한 번에 모아 전역 서버와 함께 둔다. 파일 IO는 비동기 port로 받는다.

export type ProjectServerSource = {
  // 폴더의 바로 아래 이름이다. 폴더가 없으면 null이다.
  list(dir: string): Promise<readonly string[] | null>;
  // 파일 글이다. 없으면 null이다.
  read(path: string): Promise<string | null>;
};

// 서버와 그 서버가 놓인 project다. 같은 이름의 서버가 서로 다른 project에 있어도 따로 남는다.
type ProjectMcpEntry = {
  workspace: AgentWorkspace;
  agent: null;
  server: McpRuntimeServer;
};

// 모든 project의 설정 파일이 가진 서버를 project id 순으로 모은다. 틀린 파일이나 읽지 못한 파일은 그
// project 서버만 빠진다. project 폴더가 아닌 이름은 project가 아니다.
export async function collectProjectMcpEntries(
  root: string,
  source: ProjectServerSource,
  layer: ProjectLayer,
): Promise<ProjectMcpEntry[]> {
  const found: ProjectMcpEntry[] = [];
  let ids: readonly string[] | null;
  try {
    ids = await source.list(layer.settingsFolderArea(root));
  } catch {
    return found;
  }
  for (const id of (ids ?? [])
    .filter((name) => layer.projectIdOfFolder(name) !== null)
    .sort()) {
    try {
      const text = await source.read(layer.extensionsFile(root, id));
      if (text === null) continue;
      const parsed = parseProjectExtensions(text);
      if (!parsed.ok) continue;
      const workspace = { kind: "project", id } as AgentWorkspace;
      for (const server of parsed.value.mcp_servers) {
        found.push({
          workspace,
          agent: null,
          server: runtimeServerOfLayer(server, workspace),
        });
      }
    } catch {
      // 읽지 못한 project는 서버가 없는 것으로 닫는다.
    }
  }
  return found;
}
