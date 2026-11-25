// Settings › Agents와 Tools and skills의 가짜 통로. core를 부르지 않고 부른 것을 모두 기록한다. model picker는
// Agents 탭의 fake source(workspace/agents)와 같은 것을 쓴다. 화면이 읽는 기본 model·호출 정책·skill·MCP server는
// 가짜 core의 답이고 wireframe과 같은 data로 시작한다.
import { appList } from "../../../../../../protocol/apps/apps.ts";
import { agentList } from "../../../../../../protocol/lophn-agent/agent-definitions.ts";
import { CALL_POLICY_SETTING_KEY } from "../../../../../../protocol/lophn-agent/call-policy.ts";
import {
  type McpTrust,
  mcpAuthState,
} from "../../../../../../protocol/lophn-agent/mcp-settings.ts";
import { modelDefaultRead } from "../../../../../../protocol/lophn-agent/models.ts";
import { skillsRead } from "../../../../../../protocol/lophn-agent/skill-settings.ts";
import { lophnIdOf } from "../../../../../../protocol/lophn-agent/workspaces.ts";
import {
  createFakeAgentsSource,
  type FakeAgentsOptions as FakeEditorOptions,
  GLOBAL_LOPHN_MD,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
} from "../../../../workspace/agents/fake-source.ts";
import { fakeAnswer } from "../../../connection/events/fake-source.ts";
import {
  type AuthStateValue,
  MCP_SERVERS,
  type McpServerValue,
} from "../../extension-settings.ts";
import {
  FAKE_PROJECTS,
  type FakeCore,
  fakeCore,
} from "../../testdata/fake-core.ts";
import { callPolicyValueOf } from "../core-source.ts";
import type {
  AgentsSettingsSource,
  InstructionsFile,
  ModelChoice,
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
  | readonly ["server-trust", string, McpTrust]
  | readonly ["sign-in", string]
  | readonly ["cancel-sign-in", string]
  | readonly ["enter-secret", string, string];

type Failing =
  | "call-policy"
  | "change-model"
  | "instructions"
  | "add-skill"
  | "skill"
  | "add-server"
  | "create-server"
  | "server"
  | "sign-in"
  | "cancel-sign-in";

interface FakeAgentsOptions {
  /** 전역 기본 model을 아직 고르지 않은 상태로 시작한다. */
  noDefaultModel?: boolean;
  /** picker와 Manage models 창이 읽는 provider·model 상태. */
  editor?: FakeEditorOptions;
  /** 이 이름의 호출은 이 code로 실패한다. */
  failing?: Partial<Record<Failing, string>>;
  /** 읽기 답을 둘 가짜 core. 없으면 새로 만든다. */
  core?: FakeCore;
}

/** 화면 확인용 전역 MCP server: key를 넣은 web server, 끈 실행 파일 server, 로그인하지 않은 OAuth server. */
const SERVERS: readonly McpServerValue[] = [
  {
    name: "fetch",
    enabled: true,
    transport: "http",
    http: {
      url: "https://mcp.fetch.example/mcp",
      auth: { kind: "bearer", credential: { secret: "mcp.global.fetch" } },
    },
  },
  {
    name: "calendar",
    enabled: false,
    transport: "stdio",
    stdio: { executable: "calendar-mcp" },
  },
  {
    name: "notion",
    enabled: true,
    transport: "http",
    http: {
      url: "https://mcp.notion.com/mcp",
      auth: { kind: "oauth2", client_id: "notion-client", scopes: ["read"] },
    },
  },
];

/** 호출 정책이 고르는 agent: workspace마다의 lophn 둘과 사람이 만든 agent 하나. */
const AGENTS = [
  { agent: lophnIdOf(null), name: "lophn" },
  {
    agent: lophnIdOf({ kind: "project", id: FAKE_PROJECTS[0]!.id }),
    name: "lophn",
  },
  { agent: "agt_images", name: "Image Generator" },
];

const NO_POLICY = { private: [], workspaces: [], agents: [] };

export function fakeAgents(options: FakeAgentsOptions = {}) {
  const core = options.core ?? fakeCore();
  let defaultModel: ModelChoice | null = options.noDefaultModel
    ? null
    : GLOBAL_MODEL;
  let instructions: InstructionsFile = {
    text: GLOBAL_LOPHN_MD,
    hash: "1".padStart(64, "0"),
  };
  let skills = GLOBAL_SKILLS.map((row) => ({
    name: row.name,
    description: row.detail,
    source: row.builtIn ? "builtin" : "global",
    enabled: row.on,
    can_disable: true,
  }));
  let servers: readonly McpServerValue[] = SERVERS;
  const logins = new Map<string, AuthStateValue>();
  core.set(MCP_SERVERS, servers);
  core.set(CALL_POLICY_SETTING_KEY, NO_POLICY);
  core.secret("mcp.global.fetch", true);
  core.answers.push(
    fakeAnswer(modelDefaultRead, () => ({
      as_of_seq: "0",
      next_cursor: null,
      default: defaultModel as never,
    })),
    fakeAnswer(skillsRead, () => ({
      as_of_seq: "0",
      next_cursor: null,
      skills: skills as never,
      skills_off: skills.filter((one) => !one.enabled).map((one) => one.name),
    })),
    fakeAnswer(mcpAuthState, (input) => ({
      servers: input.servers.map((one) => ({
        name: one.name,
        workspace: null,
        agent: null,
        state: logins.get(one.name)?.state ?? "none",
        reason: logins.get(one.name)?.reason ?? null,
      })),
    })),
    fakeAnswer(appList, {
      as_of_seq: "0",
      next_cursor: null,
      apps: [],
    } as never),
    fakeAnswer(agentList, {
      as_of_seq: "0",
      next_cursor: null,
      agents: AGENTS,
    } as never),
  );
  const calls: AgentsCall[] = [];
  const failing = options.failing ?? {};
  const ok = (): SourceResult<null> => ({ ok: true, value: null });
  const fail = (name: Failing): SourceResult<null> | null =>
    failing[name] === undefined ? null : { ok: false, code: failing[name]! };
  const setServers = (next: readonly McpServerValue[]) => {
    servers = next;
    core.set(MCP_SERVERS, next);
    core.changed("settings");
  };

  const source: AgentsSettingsSource = {
    editor: createFakeAgentsSource(options.editor),
    callPolicy: {
      write(next) {
        calls.push(["call-policy"]);
        const failed = fail("call-policy");
        if (failed) return Promise.resolve(failed);
        core.set(CALL_POLICY_SETTING_KEY, callPolicyValueOf(next));
        core.changed("settings");
        return Promise.resolve(ok());
      },
    },
    readDefaultModel() {
      return Promise.resolve({ ok: true, value: defaultModel });
    },
    changeDefaultModel(choice) {
      calls.push(["change-model", choice]);
      const failed = fail("change-model");
      if (failed) return Promise.resolve(failed);
      defaultModel = choice;
      core.changed("models");
      return Promise.resolve(ok());
    },
    readInstructions() {
      return Promise.resolve({ ok: true, value: instructions });
    },
    writeInstructions(text, hash) {
      calls.push(["instructions", text]);
      const failed = fail("instructions");
      if (failed) return Promise.resolve(failed as SourceResult<never>);
      if (hash !== instructions.hash) {
        return Promise.resolve({ ok: false, code: "conflict" });
      }
      instructions = {
        text,
        hash: String(Number(hash ?? "0") + 1).padStart(64, "0"),
      };
      return Promise.resolve({ ok: true, value: instructions });
    },
    addServer() {
      calls.push(["add-server"]);
      return Promise.resolve(fail("add-server") ?? ok());
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
        row.name === name ? { ...row, enabled } : row,
      );
      core.changed("settings");
      return Promise.resolve(ok());
    },
    createServer(server) {
      calls.push(["create-server", server.name]);
      const failed = fail("create-server");
      if (failed) return Promise.resolve(failed);
      setServers([...servers, { ...server, enabled: true } as McpServerValue]);
      return Promise.resolve(ok());
    },
    signInServer(row) {
      calls.push(["sign-in", row.name]);
      const failed = fail("sign-in");
      if (failed) return Promise.resolve(failed);
      logins.set(row.name, { state: "signed_in", reason: null });
      core.changed("secrets");
      return Promise.resolve(ok());
    },
    cancelServerSignIn(row) {
      calls.push(["cancel-sign-in", row.name]);
      const failed = fail("cancel-sign-in");
      if (failed) return Promise.resolve(failed);
      logins.delete(row.name);
      core.changed("secrets");
      return Promise.resolve(ok());
    },
    enterServerSecret(row, secret) {
      calls.push(["enter-secret", row.name, secret.name]);
      core.secret(secret.name, true);
      core.changed("secrets");
      return Promise.resolve(ok());
    },
    setServerEnabled(name, enabled) {
      calls.push(["server", name, enabled]);
      const failed = fail("server");
      if (failed) return Promise.resolve(failed);
      setServers(
        servers.map((row) => (row.name === name ? { ...row, enabled } : row)),
      );
      return Promise.resolve(ok());
    },
    setServerTrust(name, trust) {
      calls.push(["server-trust", name, trust]);
      const failed = fail("server");
      if (failed) return Promise.resolve(failed);
      setServers(
        servers.map((row) => (row.name === name ? { ...row, trust } : row)),
      );
      return Promise.resolve(ok());
    },
  };
  return { source, calls, core };
}
