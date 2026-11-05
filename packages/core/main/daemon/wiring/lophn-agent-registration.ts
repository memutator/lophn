// projects와 lophn-agent가 서로를 import하지 않으므로 이 wiring file이 둘을 writer·reader Worker 안에서 잇는다.
// Worker가 팀 등록 file로 import한다.
// - session을 열고 Router가 session 목록을 읽을 때 쓰는 project와 앱 조회
import { projectInfoOf } from "../../../projects/registry/mod.ts";
import { createWorkspaceNameRules } from "../../../agent-workspaces/workspace/session-directory.ts";
import { installWorkspaceEnvironment } from "../../../lophn-agent/workspaces/mod.ts";
import { agentDirectory } from "./lophn-agent-team.ts";

// 열 수 있는지만 보므로 폴더가 있는지는 묻지 않는다.
const ANY_FOLDER = { exists: () => true };

installWorkspaceEnvironment({
  deps: (sql) => {
    const projects = {
      project(id: string) {
        const found = projectInfoOf(sql, ANY_FOLDER, { id });
        return found.ok ? (found.value as never) : null;
      },
      projectByName(name: string) {
        // 받는 쪽은 id, 이름 어느 쪽으로 적어도 같은 project다.
        const byId = projectInfoOf(sql, ANY_FOLDER, { id: name });
        if (byId.ok && byId.value !== null) return byId.value as never;
        const found = projectInfoOf(sql, ANY_FOLDER, { name });
        return found.ok ? (found.value as never) : null;
      },
    };
    const apps = {
      app: (id: string) =>
        appOf(sql.get("select * from apps where id = ?", [id])),
      appByName: (name: string) =>
        appOf(
          sql.get("select * from apps where id = ? or slug = ? or name = ?", [
            name,
            name,
            name,
          ]),
        ),
    };
    const agents = agentDirectory(sql);
    return {
      projects,
      apps,
      agents,
      names: createWorkspaceNameRules({ projects, apps, agents }),
    };
  },
});

function appOf(row: Record<string, unknown> | undefined) {
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    name: String(row["slug"]),
    purpose: String(row["description"]),
    archived: row["status"] === "archived",
    sourceFolder:
      row["source_path"] === null ? null : String(row["source_path"]),
  } as never;
}

export function createCoreRegistration() {
  return { ports: [] };
}
