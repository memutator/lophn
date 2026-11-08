import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentWorkspace } from "../../../protocol/lophn-agent/mod.ts";
import { createExtensionRegistry } from "../../lophn-agent/extensions/registry.ts";
import { PROJECT_LAYER } from "./project-layer.ts";

const calendar = { kind: "app", id: "app_calendar" } as const;
const other = { kind: "app", id: "app_other" } as const;
const project = { kind: "project", id: "prj_work" } as const;

const server = {
  name: "cal-mcp",
  enabled: true,
  call_timeout_ms: 60_000,
  transport: "stdio",
  stdio: { executable: "/bin/cal", args: [], cwd: null, env: {} },
};

test("calendar 앱 extensions.json의 MCP server는 그 앱 session에만 실리고 다른 workspace와 Home에는 실리지 않는다", () => {
  const files = new Map([
    [
      PROJECT_LAYER.extensionsFile("/r", calendar),
      JSON.stringify({ mcp_servers: [server], skills_off: [], mcp_off: [] }),
    ],
  ]);
  const registry = createExtensionRegistry({
    root: "/r",
    projectLayer: PROJECT_LAYER,
    files: { read: (path) => files.get(path) ?? null, writeAtomic: () => {} },
    skillFiles: { list: () => null, kind: () => null, read: () => null },
    sourceFolder: () => null,
    global: {
      servers: [],
      skills: { bundled: null, registered: [], personal: null },
      skillsOff: [],
    },
  });
  const names = (workspace: AgentWorkspace | null) =>
    registry.mcpServers(workspace).map((one) => one.name);

  assert.deepEqual(names(calendar), ["cal-mcp"]);
  assert.deepEqual(names(other), []);
  assert.deepEqual(names(project), []);
  assert.deepEqual(names(null), []);
  // 파일 자리는 workspace마다 다르고 Home은 다른 최상위 이름과 겹치지 않는다.
  assert.equal(
    PROJECT_LAYER.extensionsFile("/r", null),
    "/r/home/extensions.json",
  );
  assert.ok(PROJECT_LAYER.isExtensionsFile("/r", "/r/home/extensions.json"));
  assert.ok(!PROJECT_LAYER.isExtensionsFile("/r", "/r/home/x/extensions.json"));
});
