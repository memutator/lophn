// Settings › Agents와 Tools and skills의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. lophn 둘째 화면은
// Agents 탭의 fake source(workspace/agents)와 같은 것을 쓴다. 전역 model·skill·MCP는 wireframe과 같은 data로 시작한다.
import {
  createFakeAgentsSource,
  FAKE_GRANTS,
  GLOBAL_LOPHN_MD,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
} from "../../../../workspace/agents/fake-source.ts";
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  ExtensionsView,
  McpRow,
  ModelChoice,
  SkillRow,
  SourceResult,
} from "../settings-source.ts";

type AgentsCall =
  | readonly ["change-model", ModelChoice]
  | readonly ["instructions"]
  | readonly ["add-skill"]
  | readonly ["skill", string, boolean]
  | readonly ["add-server"]
  | readonly ["create-server", string]
  | readonly ["server", string, boolean];

type Failing =
  | "read"
  | "change-model"
  | "instructions"
  | "extensions"
  | "add-skill"
  | "skill"
  | "add-server"
  | "create-server"
  | "server";

interface FakeAgentsOptions {
  view?: AgentsSettingsView;
  extensions?: ExtensionsView;
  /** 이 이름의 호출은 이 code로 실패한다. */
  failing?: Partial<Record<Failing, string>>;
}

const grants = FAKE_GRANTS.lophn ?? [];

const VIEW: AgentsSettingsView = {
  defaultModel: GLOBAL_MODEL,
  lophn: {
    name: "lophn",
    model: null,
    apps: grants.filter((entry) => entry.kind === "app").length,
    agents: grants.filter((entry) => entry.kind === "agent").length,
    mayChangeSettings: grants.some((entry) => entry.kind === "settings"),
  },
  instructionsPreview: GLOBAL_LOPHN_MD,
};

const EXTENSIONS: ExtensionsView = {
  skills: GLOBAL_SKILLS,
  servers: GLOBAL_MCP,
};

export function fakeAgents(options: FakeAgentsOptions = {}) {
  let view = options.view ?? VIEW;
  let skills: readonly SkillRow[] = (options.extensions ?? EXTENSIONS).skills;
  let servers: readonly McpRow[] = (options.extensions ?? EXTENSIONS).servers;
  const calls: AgentsCall[] = [];
  const failing = options.failing ?? {};
  const counts = { reads: 0 };
  const ok = (): SourceResult<null> => ({ ok: true, value: null });
  const fail = (name: Failing): SourceResult<null> | null =>
    failing[name] === undefined ? null : { ok: false, code: failing[name]! };

  const source: AgentsSettingsSource = {
    editor: createFakeAgentsSource(),
    read() {
      counts.reads += 1;
      return Promise.resolve(
        failing.read === undefined
          ? { ok: true, value: view } as const
          : { ok: false, code: failing.read } as const,
      );
    },
    changeDefaultModel(choice) {
      calls.push(["change-model", choice]);
      const failed = fail("change-model");
      if (failed) return Promise.resolve(failed);
      view = { ...view, defaultModel: choice };
      return Promise.resolve(ok());
    },
    openInstructions() {
      calls.push(["instructions"]);
      return Promise.resolve(fail("instructions") ?? ok());
    },
    addServer() {
      calls.push(["add-server"]);
      return Promise.resolve(fail("add-server") ?? ok());
    },
    readExtensions() {
      const failed = fail("extensions");
      return Promise.resolve(
        failed === null
          ? { ok: true, value: { skills, servers } } as const
          : failed as SourceResult<never>,
      );
    },
    addSkill() {
      calls.push(["add-skill"]);
      return Promise.resolve(fail("add-skill") ?? ok());
    },
    setSkillEnabled(name, enabled) {
      calls.push(["skill", name, enabled]);
      const failed = fail("skill");
      if (failed) return Promise.resolve(failed);
      skills = skills.map((row) =>
        row.name === name ? { ...row, on: enabled } : row
      );
      return Promise.resolve(ok());
    },
    createServer(server) {
      calls.push(["create-server", server.name]);
      const failed = fail("create-server");
      if (failed) return Promise.resolve(failed);
      servers = [...servers, {
        name: server.name,
        detail: server.transport === "stdio"
          ? server.stdio.executable
          : server.http.url,
        layer: "global",
        on: true,
        status: "connected",
      }];
      return Promise.resolve(ok());
    },
    setServerEnabled(name, enabled) {
      calls.push(["server", name, enabled]);
      const failed = fail("server");
      if (failed) return Promise.resolve(failed);
      servers = servers.map((row) =>
        row.name === name ? { ...row, on: enabled } : row
      );
      return Promise.resolve(ok());
    },
  };
  return { source, calls, counts };
}
