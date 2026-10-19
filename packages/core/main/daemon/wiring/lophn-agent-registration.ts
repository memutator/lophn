// projects와 lophn-agent가 서로를 import하지 않으므로 이 wiring file이 둘을 writer·reader Worker 안에서 잇는다.
// Worker가 팀 등록 file로 import한다.
// - project 등록 command가 같은 tx 안에서 부르는 Project Manager 만들기
// - session을 열고 Router가 session 목록을 읽을 때 쓰는 project, 앱, Operator 조회
import { ok } from "../../../../base/mod.ts";
import {
  projectInfoOf,
  projectManagerProvisioningPort,
} from "../../../projects/registry/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
} from "../../../storage/ledger/mod.ts";
import { dataRootOf } from "../../../lophn-agent/agents/store.ts";
import { ensureProjectManager } from "../../../agent-roles/agents/ensure.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import { createPlaceRoleRules } from "../../../agent-roles/place/session-directory.ts";
import { operatorDirectory } from "./lophn-agent-team.ts";
import { installPlaceEnvironment } from "../../../lophn-agent/places/mod.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../../lophn-agent/agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeAgentFiles } = await import(NODE_AGENT_FILES) as {
  createNodeAgentFiles(): AgentFileSystem;
};
const files = createNodeAgentFiles();

// 열 수 있는지만 보므로 폴더가 있는지는 묻지 않는다.
const ANY_FOLDER = { exists: () => true };

installPlaceEnvironment({
  deps: (sql) => {
    const projects = {
      project(id: string) {
        const found = projectInfoOf(sql, ANY_FOLDER, { id });
        return found.ok ? found.value as never : null;
      },
      projectByName(name: string) {
        // 받는 쪽은 id, 이름 어느 쪽으로 적어도 같은 project다.
        const byId = projectInfoOf(sql, ANY_FOLDER, { id: name });
        if (byId.ok && byId.value !== null) return byId.value as never;
        const found = projectInfoOf(sql, ANY_FOLDER, { name });
        return found.ok ? found.value as never : null;
      },
    };
    const apps = {
      app: (id: string) =>
        appOf(sql.get("select * from apps where id = ?", [id])),
      appByName: (name: string) =>
        appOf(
          sql.get(
            "select * from apps where id = ? or slug = ? or name = ?",
            [name, name, name],
          ),
        ),
    };
    const operators = operatorDirectory(sql);
    return {
      projects,
      apps,
      operators,
      roles: createPlaceRoleRules({ projects, apps, operators }),
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
    sourceFolder: row["source_path"] === null
      ? null
      : String(row["source_path"]),
  } as never;
}

// 정의는 파일이라 tx에 묶이지 않는다. 파일을 만들지 못하면 등록도 되돌리고, 이미 만든 파일이 있으면 그대로 둔다.
const ports = [
  defineTxPort(projectManagerProvisioningPort, () => ({
    create(tx, project) {
      const root = dataRootOf(tx.sql, undefined);
      if (!root.ok) return root;
      const ensured = ensureProjectManager(
        { files, root: root.value },
        project,
      );
      return ensured.ok ? ok(undefined) : ensured;
    },
  })),
];

export function createReaderRegistration(): ReaderRegistration {
  return { reads: [], ports: new Map() };
}

export function createCoreRegistration() {
  return { ports };
}
