// Settings › Agents와 Tools and skills의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. lophn 둘째 화면은
// Agents 탭의 fake source(workspace/agents)와 같은 것을 쓴다. 전역 model·skill·MCP는 wireframe과 같은 data로 시작한다.
import {
  createFakeAgentsSource,
  FAKE_GRANTS,
  type FakeAgentsOptions as FakeEditorOptions,
  GLOBAL_LOPHN_MD,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
} from "../../../../workspace/agents/fake-source.ts";
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  CallPolicyView,
  ExtensionsView,
  InstructionsFile,
  McpRow,
  ModelChoice,
  SkillRow,
  SourceResult,
} from "../settings-source.ts";

type AgentsCall =
  | readonly ["call-policy"]
  | readonly ["change-model", ModelChoice]
  | readonly ["instructions", string]
  | readonly ["add-skill"]
  | readonly ["skill", string, boolean]
  | readonly ["add-server"]
  | readonly ["create-server", string]
  | readonly ["server", string, boolean]
  | readonly ["sign-in", string]
  | readonly ["cancel-sign-in", string];

type Failing =
  | "read"
  | "call-policy"
  | "change-model"
  | "instructions"
  | "extensions"
  | "add-skill"
  | "skill"
  | "add-server"
  | "create-server"
  | "server"
  | "sign-in"
  | "cancel-sign-in";

interface FakeAgentsOptions {
  view?: AgentsSettingsView;
  /** 전역 기본 model을 아직 고르지 않은 상태로 시작한다. */
  noDefaultModel?: boolean;
  /** picker와 Manage models 창이 읽는 provider·model 상태. */
  editor?: FakeEditorOptions;
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
    apps: grants.length,
  },
  instructions: { text: GLOBAL_LOPHN_MD, hash: "1".padStart(64, "0") },
};

const CALL_POLICY: CallPolicyView = {
  private: {
    options: [
      { value: "project:prj_a", label: "Project A" },
      { value: "project:prj_b", label: "Project B" },
    ],
    chosen: [],
  },
  workspaces: {
    options: [
      { value: "home", label: "Home" },
      { value: "project:prj_a", label: "Project A" },
      { value: "project:prj_b", label: "Project B" },
    ],
    rules: [],
  },
  agents: {
    options: [
      { value: "lophn", label: "lophn" },
      { value: "agt_images", label: "Image Generator" },
    ],
    rules: [],
  },
};

const EXTENSIONS: ExtensionsView = {
  skills: GLOBAL_SKILLS,
  servers: GLOBAL_MCP,
};

export function fakeAgents(options: FakeAgentsOptions = {}) {
  let view =
    options.view ??
    (options.noDefaultModel ? { ...VIEW, defaultModel: null } : VIEW);
  let skills: readonly SkillRow[] = (options.extensions ?? EXTENSIONS).skills;
  let servers: readonly McpRow[] = (options.extensions ?? EXTENSIONS).servers;
  const calls: AgentsCall[] = [];
  const failing = options.failing ?? {};
  const counts = { reads: 0 };
  const ok = (): SourceResult<null> => ({ ok: true, value: null });
  const fail = (name: Failing): SourceResult<null> | null =>
    failing[name] === undefined ? null : { ok: false, code: failing[name]! };

  let callPolicy = CALL_POLICY;
  const source: AgentsSettingsSource = {
    editor: createFakeAgentsSource(options.editor),
    callPolicy: {
      read: () => Promise.resolve({ ok: true, value: callPolicy }),
      write(next) {
        calls.push(["call-policy"]);
        const failed = fail("call-policy");
        if (failed) return Promise.resolve(failed);
        callPolicy = {
          private: { ...callPolicy.private, chosen: next.private },
          workspaces: { ...callPolicy.workspaces, rules: next.workspaces },
          agents: { ...callPolicy.agents, rules: next.agents },
        };
        return Promise.resolve(ok());
      },
    },
    read() {
      counts.reads += 1;
      return Promise.resolve(
        failing.read === undefined
          ? ({ ok: true, value: view } as const)
          : ({ ok: false, code: failing.read } as const),
      );
    },
    changeDefaultModel(choice) {
      calls.push(["change-model", choice]);
      const failed = fail("change-model");
      if (failed) return Promise.resolve(failed);
      view = { ...view, defaultModel: choice };
      return Promise.resolve(ok());
    },
    readInstructions() {
      return Promise.resolve({ ok: true, value: view.instructions });
    },
    writeInstructions(text, hash) {
      calls.push(["instructions", text]);
      const failed = fail("instructions");
      if (failed) return Promise.resolve(failed as SourceResult<never>);
      if (hash !== view.instructions.hash) {
        return Promise.resolve({ ok: false, code: "conflict" });
      }
      const written: InstructionsFile = {
        text,
        hash: String(Number(hash ?? "0") + 1).padStart(64, "0"),
      };
      view = { ...view, instructions: written };
      return Promise.resolve({ ok: true, value: written });
    },
    addServer() {
      calls.push(["add-server"]);
      return Promise.resolve(fail("add-server") ?? ok());
    },
    readExtensions() {
      const failed = fail("extensions");
      return Promise.resolve(
        failed === null
          ? ({ ok: true, value: { skills, servers } } as const)
          : (failed as SourceResult<never>),
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
        row.name === name ? { ...row, on: enabled } : row,
      );
      return Promise.resolve(ok());
    },
    createServer(server) {
      calls.push(["create-server", server.name]);
      const failed = fail("create-server");
      if (failed) return Promise.resolve(failed);
      servers = [
        ...servers,
        {
          name: server.name,
          detail:
            server.transport === "stdio"
              ? server.stdio.executable
              : server.http.url,
          layer: "global",
          on: true,
          status: "connected",
        },
      ];
      return Promise.resolve(ok());
    },
    signInServer(row) {
      calls.push(["sign-in", row.name]);
      const failed = fail("sign-in");
      if (failed) return Promise.resolve(failed);
      servers = servers.map((one) =>
        one.name === row.name && one.login !== undefined
          ? {
              ...one,
              status: "connected",
              login: { ...one.login, state: "signed_in", reason: null },
            }
          : one,
      );
      return Promise.resolve(ok());
    },
    cancelServerSignIn(row) {
      calls.push(["cancel-sign-in", row.name]);
      const failed = fail("cancel-sign-in");
      if (failed) return Promise.resolve(failed);
      servers = servers.map((one) =>
        one.name === row.name && one.login !== undefined
          ? {
              ...one,
              status: "needs-sign-in",
              login: { ...one.login, state: "none", reason: null },
            }
          : one,
      );
      return Promise.resolve(ok());
    },
    setServerEnabled(name, enabled) {
      calls.push(["server", name, enabled]);
      const failed = fail("server");
      if (failed) return Promise.resolve(failed);
      servers = servers.map((row) =>
        row.name === name ? { ...row, on: enabled } : row,
      );
      return Promise.resolve(ok());
    },
  };
  return { source, calls, counts };
}
