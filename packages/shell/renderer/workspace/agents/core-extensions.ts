// skill·MCP server·instruction·model 기본값을 읽는 부분. agent 설정 화면과 Agents 탭이 같이 쓴다. 전역 층은 settings 읽기와
// skills 읽기에서, project 층은 project 확장 설정에서 온다. 앱 자리에는 project 층이 없다.
import {
  type McpAuthFailure,
  type McpAuthStateName,
  type McpServer,
  workspaceExtensionSettingsChange,
} from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import {
  BUILTIN_SKILLS,
  type SkillEntry,
} from "../../../../protocol/lophn-agent/skill-settings.ts";
import {
  workspaceKindOf,
  type Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { FilesApi } from "../../../ipc/files.ts";
import type {
  InstructionsApi,
  InstructionsWorkspace,
} from "../../../ipc/instructions.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { ReadResult } from "../source.ts";
import { isAppWorkspace } from "./agent-key.ts";
import type { Link } from "./core-link.ts";
import type {
  InstructionsFile,
  McpLayer,
  McpLogin,
  McpRow,
  SkillRow,
} from "./views.ts";

const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

function detailOf(server: McpServer): string {
  return server.transport === "stdio"
    ? server.stdio.executable
    : server.http.url;
}

/** 자리 id에서 계약의 workspace를 만든다. 앱 id가 아니면 project다. */
export const workspaceOf = (workspace: string): Workspace => ({
  kind: isAppWorkspace(workspace) ? "app" : "project",
  id: workspace,
});

/** 이 자리에서 보이는 skill. 내장 skill은 그 workspace 종류가 가진 것만 보인다. */
export async function readSkills(
  link: Link,
  workspace: string | null,
): Promise<ReadResult<SkillRow[]>> {
  const result = await link.read<{ skills: SkillEntry[] }>("skills", "read", {
    ...(workspace === null
      ? {}
      : isAppWorkspace(workspace)
        ? { app: workspace }
        : { project: workspace }),
  });
  if (!result.ok) return result;
  const kind = workspaceKindOf(
    workspace === null ? null : workspaceOf(workspace),
  );
  return {
    ok: true,
    value: result.value.skills
      .filter(
        (skill) =>
          skill.source !== "builtin" ||
          BUILTIN_SKILLS.find(
            (one) => one.name === skill.name,
          )?.workspaces.includes(kind),
      )
      .map((skill) => ({
        name: skill.name,
        detail: skill.description,
        layer: skill.source,
        on: skill.enabled,
        builtIn: skill.source === "builtin",
      })),
  };
}

/** 전역 MCP server. 켜졌는지가 서버 설정의 enabled다. */
async function readGlobalServers(link: Link): Promise<ReadResult<McpServer[]>> {
  const result = await link.memory<{
    settings: { key: string; default?: unknown; chosen?: unknown }[];
  }>("settings", "list", { keys: [MCP_SERVERS] });
  if (!result.ok) return result;
  const entry = result.value.settings.find((one) => one.key === MCP_SERVERS);
  const found = entry?.chosen ?? entry?.default;
  return {
    ok: true,
    value: Array.isArray(found) ? (found as McpServer[]) : [],
  };
}

// 이 자리에서 보이는 server 한 대와 그 층·소유자다. 로그인은 소유자(workspace 또는 agent 정의)로 부르므로 소유자를
// 함께 든다.
interface ServerEntry {
  readonly server: McpServer;
  readonly layer: McpLayer;
  readonly workspace: Workspace | null;
  readonly agent: string | null;
}

function oauthAuthOf(server: McpServer) {
  return server.transport === "http" && server.http.auth.kind === "oauth2"
    ? server.http.auth
    : null;
}

/**
 * OAuth server의 로그인 상태를 소유자와 이름으로 한 번에 묻는다. 읽지 못하면 로그인 정보 없이 그대로 그린다
 * (로그인 단추도 없다). OAuth가 아닌 server는 묻지 않는다.
 */
async function readLogins(
  link: Link,
  entries: readonly ServerEntry[],
): Promise<(McpLogin | undefined)[]> {
  const asked = entries.filter((entry) => oauthAuthOf(entry.server) !== null);
  let states: {
    state: McpAuthStateName;
    reason: McpAuthFailure | null;
  }[] = [];
  if (asked.length > 0) {
    const read = await link.memory<{
      servers: { state: McpAuthStateName; reason: McpAuthFailure | null }[];
    }>("agent-mcp-auth", "state", {
      servers: asked.map((entry) => ({
        name: entry.server.name,
        workspace: entry.workspace,
        agent: entry.agent,
      })),
    });
    if (read.ok) states = read.value.servers;
  }
  return entries.map((entry) => {
    const auth = oauthAuthOf(entry.server);
    if (auth === null) return undefined;
    const state = states[asked.indexOf(entry)];
    return {
      workspace: entry.workspace,
      agent: entry.agent,
      client_id: auth.client_id,
      scopes: auth.scopes,
      state: state?.state ?? "none",
      reason: state?.reason ?? null,
    };
  });
}

async function rowsWithLogins(
  link: Link,
  entries: readonly ServerEntry[],
  enabled: (entry: ServerEntry) => boolean,
): Promise<McpRow[]> {
  const logins = await readLogins(link, entries);
  return entries.map((entry, at) => {
    const { server } = entry;
    const login = logins[at];
    const on = enabled(entry);
    return {
      name: server.name,
      detail: detailOf(server),
      layer: entry.layer,
      on,
      status:
        login === undefined
          ? null
          : login.state === "signed_in"
            ? "connected"
            : "needs-sign-in",
      ...(login === undefined ? {} : { login }),
    } satisfies McpRow;
  });
}

/**
 * agent 정의가 가진 OAuth server의 로그인 상태다. core는 저장한 정의 파일을 읽으므로 여기 서버는 저장된
 * 정의(`detail.definition.mcp_servers`)에서 온다. 저장하지 않은 편집에는 로그인이 없다.
 */
export async function readAgentServerLogins(
  link: Link,
  agent: string,
  servers: readonly McpServer[],
): Promise<Readonly<Record<string, McpLogin>>> {
  const entries = servers.map((server) => ({
    server,
    layer: "agent" as const,
    workspace: null,
    agent,
  }));
  const logins = await readLogins(link, entries);
  return Object.fromEntries(
    entries.flatMap((entry, at) => {
      const login = logins[at];
      return login === undefined ? [] : [[entry.server.name, login] as const];
    }),
  );
}

interface ProjectSettings {
  readonly servers: readonly McpServer[];
  readonly skillsOff: readonly string[];
  readonly mcpOff: readonly string[];
  readonly hash: string | null;
}

async function readProjectSettings(
  link: Link,
  project: string,
): Promise<ReadResult<ProjectSettings>> {
  return await link
    .read<{
      mcp_servers: McpServer[];
      skills_off: string[];
      mcp_off: string[];
      hash: string | null;
    }>("workspace-extension-settings", "read", { workspace: project })
    .then((result) =>
      result.ok
        ? {
            ok: true as const,
            value: {
              servers: result.value.mcp_servers,
              skillsOff: result.value.skills_off,
              mcpOff: result.value.mcp_off,
              hash: result.value.hash,
            },
          }
        : result,
    );
}

/** project 층 설정을 읽어 edit로 고친 새 내용 전체를 쓴다. 읽은 뒤 바뀌었으면 conflict로 거절된다. */
export async function changeProjectSettings(
  link: Link,
  project: string,
  edit: (current: ProjectSettings) => Omit<ProjectSettings, "hash"> | null,
): Promise<ReadResult<null>> {
  const current = await readProjectSettings(link, project);
  if (!current.ok) return current;
  const next = edit(current.value);
  if (next === null) return { ok: false, message: "unavailable" };
  const changed = await link.command(workspaceExtensionSettingsChange, {
    input: {
      workspace: project,
      mcp_servers: next.servers,
      skills_off: next.skillsOff,
      mcp_off: next.mcpOff,
    },
    compare: { hash: current.value.hash },
  });
  return changed.ok
    ? { ok: true, value: null }
    : { ok: false, message: changed.code };
}

/** 이 자리에서 보이는 MCP server: 전역과 project 층(Home·앱은 wui). 전역 server를 project에서 끈 것은 꺼진 것으로 보인다. */
export async function readServers(
  link: Link,
  workspace: string | null,
): Promise<ReadResult<McpRow[]>> {
  const global = await readGlobalServers(link);
  if (!global.ok) return global;
  if (workspace === null || isAppWorkspace(workspace)) {
    return {
      ok: true,
      value: await rowsWithLogins(
        link,
        global.value.map((server) => ({
          server,
          layer: "global" as const,
          workspace: null,
          agent: null,
        })),
        (entry) => entry.server.enabled,
      ),
    };
  }
  const project = await readProjectSettings(link, workspace);
  if (!project.ok) return project;
  const overridden = new Set(project.value.servers.map((one) => one.name));
  const workspaceOfProject: Workspace = { kind: "project", id: workspace };
  return {
    ok: true,
    value: await rowsWithLogins(
      link,
      [
        ...global.value
          .filter((server) => !overridden.has(server.name))
          .map((server) => ({
            server,
            layer: "global" as const,
            workspace: null,
            agent: null,
          })),
        ...project.value.servers.map((server) => ({
          server,
          layer: "project" as const,
          workspace: workspaceOfProject,
          agent: null,
        })),
      ],
      (entry) =>
        entry.server.enabled &&
        (entry.layer !== "global" ||
          !project.value.mcpOff.includes(entry.server.name)),
    ),
  };
}

/**
 * OAuth server 로그인이다. core가 만든 authorize 주소를 OS browser로 열고, 사람이 돌아올 때까지 complete가
 * 기다린다. 주소를 열지 못하면 시작한 로그인을 그만두고 unavailable이다.
 */
export async function signInMcpServer(
  link: Link,
  openLink: OpenExternalApi["openExternal"] | undefined,
  server: { readonly name: string; readonly login: McpLogin },
): Promise<ReadResult<null>> {
  const begun = await link.memory<{ url: string; callback_port: number }>(
    "agent-mcp-auth",
    "begin",
    {
      name: server.name,
      workspace: server.login.workspace,
      agent: server.login.agent,
      client_id: server.login.client_id,
      scopes: [...server.login.scopes],
    },
  );
  if (!begun.ok) return begun;
  let opened = false;
  if (openLink !== undefined) {
    try {
      opened = (await openLink(begun.value.url)).ok;
    } catch {
      opened = false;
    }
  }
  if (!opened) {
    await link.memory("agent-mcp-auth", "cancel", {
      name: server.name,
      workspace: server.login.workspace,
      agent: server.login.agent,
    });
    return { ok: false, message: "unavailable" };
  }
  const done = await link.memory("agent-mcp-auth", "complete", {
    name: server.name,
    workspace: server.login.workspace,
    agent: server.login.agent,
    callback_port: begun.value.callback_port,
  });
  return done.ok ? { ok: true, value: null } : done;
}

/** 기다리는 로그인을 그만둔다. 보관한 token은 건드리지 않는다. */
export function cancelMcpSignIn(
  link: Link,
  server: {
    readonly name: string;
    readonly login: Pick<McpLogin, "workspace" | "agent">;
  },
): Promise<ReadResult<null>> {
  return link.memory("agent-mcp-auth", "cancel", {
    name: server.name,
    workspace: server.login.workspace,
    agent: server.login.agent,
  });
}

/** 전역 기본 model. 아직 고르지 않았으면 null이다. */
export async function readGlobalModel(
  link: Link,
): Promise<ReadResult<ModelChoice | null>> {
  const result = await link.read<{ default: ModelChoice | null }>(
    "model-default",
    "read",
    {},
  );
  return result.ok ? { ok: true, value: result.value.default } : result;
}

/** 지침 파일의 경로를 알려 주는 main 통로(`lophnInstructions`). */
export function windowInstructions(): InstructionsApi | undefined {
  const bridge = (globalThis as { lophnInstructions?: InstructionsApi })
    .lophnInstructions;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

/** 지침 파일을 읽고 쓰는 main file 통로(`lophnFiles`). 파일 편집기와 같은 길이다. */
export function windowFiles(): Pick<FilesApi, "read" | "write"> | undefined {
  const bridge = (globalThis as { lophnFiles?: FilesApi }).lophnFiles;
  return bridge &&
    typeof bridge.read === "function" &&
    typeof bridge.write === "function"
    ? bridge
    : undefined;
}

async function instructionsPath(
  instructions: InstructionsApi | undefined,
  target: InstructionsWorkspace,
): Promise<string | null> {
  if (instructions === undefined) return null;
  const opened = await instructions.open({ target });
  return opened.ok ? opened.value.path : null;
}

/**
 * 지침 파일(전역·project의 LOPHN.md)의 글과 hash. 경로는 main(`instructions.open`)이 알려 주고 글은 shell main의
 * file read로 읽는다. 파일이 아직 없으면 빈 글과 null hash다(첫 저장이 만든다).
 */
export async function readInstructions(
  instructions: InstructionsApi | undefined,
  files: Pick<FilesApi, "read"> | undefined,
  target: InstructionsWorkspace,
): Promise<ReadResult<InstructionsFile>> {
  if (files === undefined) return { ok: false, message: "unavailable" };
  try {
    const path = await instructionsPath(instructions, target);
    if (path === null) return { ok: false, message: "unavailable" };
    const read = await files.read({ path });
    if (read.ok) {
      return {
        ok: true,
        value: { text: read.value.text, hash: read.value.hash },
      };
    }
    return read.code === "not_found"
      ? { ok: true, value: { text: "", hash: null } }
      : { ok: false, message: read.code };
  } catch {
    return { ok: false, message: "unavailable" };
  }
}

/**
 * 지침 파일을 통째로 쓴다. hash는 읽을 때 받은 값이고 디스크가 그사이 바뀌었으면 main이 `conflict`로 거절하고
 * 디스크는 그대로다. hash가 null이면 파일을 새로 만들고, 이미 있으면 `conflict`다.
 */
export async function writeInstructions(
  instructions: InstructionsApi | undefined,
  files: Pick<FilesApi, "write"> | undefined,
  target: InstructionsWorkspace,
  text: string,
  hash: string | null,
): Promise<ReadResult<InstructionsFile>> {
  if (files === undefined) return { ok: false, message: "unavailable" };
  try {
    const path = await instructionsPath(instructions, target);
    if (path === null) return { ok: false, message: "unavailable" };
    const written = await files.write({ path, base_hash: hash, text });
    return written.ok
      ? { ok: true, value: { text, hash: written.value.hash } }
      : { ok: false, message: written.code };
  } catch {
    return { ok: false, message: "unavailable" };
  }
}
