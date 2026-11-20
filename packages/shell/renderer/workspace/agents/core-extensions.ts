// skill·MCP server·instruction·memory·model 기본값을 읽는 부분. agent 설정 화면과 Agents 탭이 같이 쓴다. 전역 층은 settings 읽기와
// skills 읽기에서, workspace(Home, project, 앱) 층은 workspace 확장 설정에서 온다.
import {
  type McpAuthFailure,
  type McpAuthStateName,
  type McpOwnerWorkspace,
  type McpServer,
  workspaceExtensionSettingsChange,
} from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import {
  BUILTIN_SKILLS,
  type SkillEntry,
} from "../../../../protocol/lophn-agent/skill-settings.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { FilesApi } from "../../../ipc/files.ts";
import type {
  EditorReply,
  InstructionsApi,
  InstructionsWorkspace,
} from "../../../ipc/instructions.ts";
import type {
  MemoryApi,
  MemoryTarget as MemoryOpen,
} from "../../../ipc/memory.ts";
import type { OAuthHandoffApi } from "../../../ipc/oauth-handoff.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import { windowOAuthHandoff } from "../../desktop/settings/core-call.ts";
import type { ReadResult } from "../source.ts";
import { isAppWorkspace, kindOfWorkspace } from "./agent-key.ts";
import type { Link } from "./core-link.ts";
import { secretsOf } from "./mcp-secrets.ts";
import type {
  InstructionsFile,
  McpLayer,
  McpLogin,
  McpRow,
  MemoryTarget,
  SkillRow,
} from "./views.ts";

const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

function detailOf(server: McpServer): string {
  return server.transport === "stdio"
    ? server.stdio.executable
    : server.http.url;
}

/** 자리 열쇠에서 계약의 workspace를 만든다. Home("home")은 workspace가 아니라 null이고, 앱 id가 아니면 project다. */
export const workspaceOf = (workspace: string): Workspace | null =>
  workspace === "home"
    ? null
    : { kind: isAppWorkspace(workspace) ? "app" : "project", id: workspace };

/** 이 자리에서 보이는 skill. 내장 skill은 그 workspace 종류가 가진 것만 보인다. null은 Settings(전역만)다. */
export async function readSkills(
  link: Link,
  workspace: string | null,
): Promise<ReadResult<SkillRow[]>> {
  const result = await link.read<{ skills: SkillEntry[] }>(
    "skills",
    "read",
    workspace === null ? {} : { workspace },
  );
  if (!result.ok) return result;
  const kind = workspace === null ? "home" : kindOfWorkspace(workspace);
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
  readonly workspace: McpOwnerWorkspace | null;
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
    const secrets = secretsOf(server);
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
      ...(secrets.length === 0 ? {} : { secrets }),
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

interface WorkspaceSettings {
  readonly servers: readonly McpServer[];
  readonly skillsOff: readonly string[];
  readonly mcpOff: readonly string[];
  readonly hash: string | null;
}

async function readWorkspaceSettings(
  link: Link,
  workspace: string,
): Promise<ReadResult<WorkspaceSettings>> {
  return await link
    .read<{
      mcp_servers: McpServer[];
      skills_off: string[];
      mcp_off: string[];
      hash: string | null;
    }>("workspace-extension-settings", "read", { workspace })
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

/** workspace 층 설정을 읽어 edit로 고친 새 내용 전체를 쓴다. 읽은 뒤 바뀌었으면 conflict로 거절된다. */
export async function changeWorkspaceSettings(
  link: Link,
  workspace: string,
  edit: (current: WorkspaceSettings) => Omit<WorkspaceSettings, "hash"> | null,
): Promise<ReadResult<null>> {
  const current = await readWorkspaceSettings(link, workspace);
  if (!current.ok) return current;
  const next = edit(current.value);
  if (next === null) return { ok: false, message: "unavailable" };
  const changed = await link.command(workspaceExtensionSettingsChange, {
    input: {
      workspace,
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

/** 이 자리에서 보이는 MCP server: 전역과 workspace(Home, project, 앱) 층. 전역 server를 workspace에서 끈 것은 꺼진 것으로 보인다. */
export async function readServers(
  link: Link,
  workspace: string | null,
): Promise<ReadResult<McpRow[]>> {
  const global = await readGlobalServers(link);
  if (!global.ok) return global;
  if (workspace === null) {
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
  const own = await readWorkspaceSettings(link, workspace);
  if (!own.ok) return own;
  const overridden = new Set(own.value.servers.map((one) => one.name));
  const owner: McpOwnerWorkspace = workspaceOf(workspace) ?? { kind: "home" };
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
        ...own.value.servers.map((server) => ({
          server,
          layer: "workspace" as const,
          workspace: owner,
          agent: null,
        })),
      ],
      (entry) =>
        entry.server.enabled &&
        (entry.layer !== "global" ||
          !own.value.mcpOff.includes(entry.server.name)),
    ),
  };
}

// 진행 중인 원격 MCP OAuth의 로컬 loopback listener id. 취소·재시작 시 닫는다.
const mcpHandoffs = new Map<string, string>();
const mcpHandoffKey = (server: {
  readonly name: string;
  readonly login: Pick<McpLogin, "workspace" | "agent">;
}) =>
  `${JSON.stringify(server.login.workspace)}\0${server.login.agent ?? ""}\0${server.name}`;

function stopMcpLocalListener(
  key: string,
  handoffApi:
    | OAuthHandoffApi["oauthHandoff"]
    | undefined = windowOAuthHandoff(),
): void {
  const id = mcpHandoffs.get(key);
  if (id === undefined) return;
  mcpHandoffs.delete(key);
  if (handoffApi !== undefined) void handoffApi({ action: "cancel", id });
}

/**
 * OAuth server 로그인이다. core가 만든 authorize 주소를 OS browser로 열고, 사람이 돌아올 때까지 complete가
 * 기다린다. 다른 컴퓨터의 로그인(`remote_handoff`)이면 이 컴퓨터에서 임시 loopback listener를 열어 돌아온 주소를
 * `agent-mcp-auth/callback`으로 넘긴다. 주소를 열지 못하면 시작한 로그인을 그만두고 unavailable이다.
 */
export async function signInMcpServer(
  link: Link,
  openLink: OpenExternalApi["openExternal"] | undefined,
  server: {
    readonly name: string;
    readonly login: Pick<
      McpLogin,
      "workspace" | "agent" | "client_id" | "scopes"
    >;
  },
  handoffApi:
    | OAuthHandoffApi["oauthHandoff"]
    | undefined = windowOAuthHandoff(),
): Promise<ReadResult<null>> {
  const key = mcpHandoffKey(server);
  stopMcpLocalListener(key, handoffApi);
  const begun = await link.memory<{
    url: string;
    callback_port: number;
    callback_mode?: "local" | "remote_handoff";
    redirect_uri?: string;
  }>("agent-mcp-auth", "begin", {
    name: server.name,
    workspace: server.login.workspace,
    agent: server.login.agent,
    client_id: server.login.client_id,
    scopes: [...server.login.scopes],
  });
  if (!begun.ok) return begun;
  const isHandoff =
    begun.value.callback_mode === "remote_handoff" &&
    begun.value.redirect_uri !== undefined;
  let handoffId: string | null = null;
  if (isHandoff) {
    if (handoffApi === undefined) {
      await link.memory("agent-mcp-auth", "cancel", {
        name: server.name,
        workspace: server.login.workspace,
        agent: server.login.agent,
      });
      return { ok: false, message: "unavailable" };
    }
    let state: string | null = null;
    try {
      state = new URL(begun.value.url).searchParams.get("state");
    } catch {
      state = null;
    }
    if (state === null) {
      await link.memory("agent-mcp-auth", "cancel", {
        name: server.name,
        workspace: server.login.workspace,
        agent: server.login.agent,
      });
      return { ok: false, message: "unavailable" };
    }
    const id = crypto.randomUUID();
    const started = await handoffApi({
      action: "start",
      id,
      redirectUri: begun.value.redirect_uri!,
      state,
    });
    if (!started.ok) {
      await link.memory("agent-mcp-auth", "cancel", {
        name: server.name,
        workspace: server.login.workspace,
        agent: server.login.agent,
      });
      return { ok: false, message: started.code };
    }
    handoffId = id;
    mcpHandoffs.set(key, id);
  }
  let opened = false;
  if (openLink !== undefined) {
    try {
      opened = (await openLink(begun.value.url)).ok;
    } catch {
      opened = false;
    }
  }
  if (!opened) {
    stopMcpLocalListener(key, handoffApi);
    await link.memory("agent-mcp-auth", "cancel", {
      name: server.name,
      workspace: server.login.workspace,
      agent: server.login.agent,
    });
    return { ok: false, message: "unavailable" };
  }
  if (isHandoff && handoffId !== null && handoffApi !== undefined) {
    const captured = await handoffApi({ action: "wait", id: handoffId });
    if (mcpHandoffs.get(key) === handoffId) mcpHandoffs.delete(key);
    if (!captured.ok || captured.callbackUrl === undefined) {
      return {
        ok: false,
        message: captured.ok ? "unavailable" : captured.code,
      };
    }
    const done = await link.memory("agent-mcp-auth", "callback", {
      name: server.name,
      workspace: server.login.workspace,
      agent: server.login.agent,
      callback_url: captured.callbackUrl,
    });
    return done.ok ? { ok: true, value: null } : done;
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
  handoffApi:
    | OAuthHandoffApi["oauthHandoff"]
    | undefined = windowOAuthHandoff(),
): Promise<ReadResult<null>> {
  stopMcpLocalListener(mcpHandoffKey(server), handoffApi);
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

/** memory 파일의 경로를 알려 주는 main 통로(`lophnMemory`). */
export function windowMemory(): MemoryApi | undefined {
  const bridge = (globalThis as { lophnMemory?: MemoryApi }).lophnMemory;
  return bridge && typeof bridge.open === "function" ? bridge : undefined;
}

/** 화면의 MemoryTarget을 main이 받는 꼴로 바꾼다. */
export function memoryOpenOf(target: MemoryTarget): MemoryOpen {
  if (target.kind === "agent") return { kind: "agent", agent: target.agent };
  const kind = kindOfWorkspace(target.workspace);
  return kind === "home"
    ? { kind: "home" }
    : { kind, workspace: target.workspace };
}

/** 지침 파일의 target을 main이 받는 꼴로 바꾼다. */
export function instructionsTargetOf(workspace: string): InstructionsWorkspace {
  const kind = kindOfWorkspace(workspace);
  return kind === "home" ? { layer: "home" } : { layer: kind, workspace };
}

/** 파일 경로를 알려 주는 main 통로. 지침과 memory가 같은 길로 읽고 쓴다. */
interface PathOpener<T> {
  open(input: { target: T }): Promise<EditorReply<{ readonly path: string }>>;
}

async function pathOf<T>(
  opener: PathOpener<T> | undefined,
  target: T,
): Promise<string | null> {
  if (opener === undefined) return null;
  const opened = await opener.open({ target });
  return opened.ok ? opened.value.path : null;
}

/**
 * 지침 파일(전역·Home·project의 LOPHN.md, 앱의 AGENTS.md)과 memory 파일의 글과 hash. 경로는 main(`instructions.open`,
 * `memory.open`)이 알려 주고 글은 shell main의 file read로 읽는다. 파일이 아직 없으면 빈 글과 null hash다(첫 저장이 만든다).
 */
export async function readInstructions<T = InstructionsWorkspace>(
  instructions: PathOpener<T> | undefined,
  files: Pick<FilesApi, "read"> | undefined,
  target: T,
): Promise<ReadResult<InstructionsFile>> {
  if (files === undefined) return { ok: false, message: "unavailable" };
  try {
    const path = await pathOf(instructions, target);
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
export async function writeInstructions<T = InstructionsWorkspace>(
  instructions: PathOpener<T> | undefined,
  files: Pick<FilesApi, "write"> | undefined,
  target: T,
  text: string,
  hash: string | null,
): Promise<ReadResult<InstructionsFile>> {
  if (files === undefined) return { ok: false, message: "unavailable" };
  try {
    const path = await pathOf(instructions, target);
    if (path === null) return { ok: false, message: "unavailable" };
    const written = await files.write({ path, base_hash: hash, text });
    return written.ok
      ? { ok: true, value: { text, hash: written.value.hash } }
      : { ok: false, message: written.code };
  } catch {
    return { ok: false, message: "unavailable" };
  }
}
