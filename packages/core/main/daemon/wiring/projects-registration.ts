// project 등록 command가 같은 tx 안에서 부르는 Project Manager 만들기를 writer Worker에 끼운다. projects와
// lophn-agent는 서로를 import하지 않으므로 이 wiring file이 둘을 잇는다. Worker가 팀 등록 file로 import한다.
import { ok } from "../../../../base/mod.ts";
import { projectManagerProvisioningPort } from "../../../projects/registry/ports.ts";
import { defineTxPort } from "../../../storage/ledger/mod.ts";
import { dataRootOf } from "../../../lophn-agent/agents/store.ts";
import { ensureProjectManager } from "../../../lophn-agent/agents/ensure.ts";
import type { AgentFileSystem } from "../../../lophn-agent/agents/ports.ts";

// 동기 file API는 core 프로세스의 module graph에 정적으로 두지 않는다. adapter는 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../../lophn-agent/agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeAgentFiles } = await import(NODE_AGENT_FILES) as {
  createNodeAgentFiles(): AgentFileSystem;
};
const files = createNodeAgentFiles();

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

export function createCoreRegistration() {
  return { ports };
}
