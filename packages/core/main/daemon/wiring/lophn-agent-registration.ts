// projects와 lophn-agent가 서로를 import하지 않으므로 이 wiring file이 둘을 writer·reader Worker 안에서 잇는다.
// Worker가 팀 등록 file로 import한다.
// - project 등록 command가 같은 tx 안에서 부르는 Project Manager 만들기
// - context 쓰기를 하는 agent가 그 project의 Project Manager session인지 보는 판정
// - session을 열고 Router가 session 목록을 읽을 때 쓰는 project, 앱, Operator 조회
import { ok } from "../../../../base/mod.ts";
import { contextAuthorityPort } from "../../../projects/contexts/mod.ts";
import {
  projectInfoOf,
  projectManagerProvisioningPort,
} from "../../../projects/registry/mod.ts";
import { defineTxPort } from "../../../storage/ledger/mod.ts";
import { dataRootOf } from "../../../lophn-agent/agents/store.ts";
import { ensureProjectManager } from "../../../lophn-agent/agents/ensure.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";
import { operatorDirectory } from "../../../lophn-agent/register.ts";
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
  deps: (sql) => ({
    projects: {
      project(id) {
        const found = projectInfoOf(sql, ANY_FOLDER, { id });
        return found.ok ? found.value as never : null;
      },
      projectByName(name) {
        const found = projectInfoOf(sql, ANY_FOLDER, { name });
        return found.ok ? found.value as never : null;
      },
    },
    apps: {
      app: (id) => appOf(sql.get("select * from apps where id = ?", [id])),
      appByName: (name) =>
        appOf(
          sql.get("select * from apps where slug = ? or name = ?", [
            name,
            name,
          ]),
        ),
    },
    operators: operatorDirectory(sql),
  }),
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
  // actor는 `agent:<session>`이다. 그 project의 Project Manager session만 context를 쓴다.
  defineTxPort(contextAuthorityPort, (tx) => ({
    canWrite(actor, project) {
      const session = actor.startsWith("agent:") ? actor.slice(6) : null;
      if (session === null) return false;
      return tx.sql.get(
        `select 1 as found from sessions
         where id = ? and role = 'project_manager' and project = ?`,
        [session, project],
      ) !== undefined;
    },
  })),
];

export function createCoreRegistration() {
  return { ports };
}
