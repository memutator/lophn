// skill·MCP server·instruction·model 기본값을 읽는 부분. agent 설정 화면과 Agents 탭이 같이 쓴다. 전역 층은 settings 읽기와
// skills 읽기에서, project 층은 project 확장 설정에서 온다. 앱 자리에는 project 층이 없다.
import {
  type McpAuthFailure,
  type McpAuthStateName,
  type McpServer,
  projectExtensionSettingsChange,
} from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import {
  BUILTIN_SKILLS,
  type SkillEntry,
} from "../../../../protocol/lophn-agent/skill-settings.ts";
import {
  placeKindOf,
  type Place,
} from "../../../../protocol/lophn-agent/places.ts";
import type { FilesApi } from "../../../ipc/files.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { ReadResult } from "../source.ts";
import { isAppPlace } from "./agent-key.ts";
import type { Link } from "./core-link.ts";
import type { McpLayer, McpLogin, McpRow, SkillRow } from "./views.ts";

const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

function detailOf(server: McpServer): string {
  return server.transport === "stdio"
    ? server.stdio.executable
    : server.http.url;
}

/** 자리 id에서 계약의 place를 만든다. 앱 id가 아니면 project다. */
export const placeOf = (place: string): Place => ({
  kind: isAppPlace(place) ? "app" : "project",
  id: place,
});

/** 이 자리에서 보이는 skill. 내장 skill은 그 place 종류가 가진 것만 보인다. */
export async function readSkills(
  link: Link,
  place: string | null,
): Promise<ReadResult<SkillRow[]>> {
  const result = await link.read<{ skills: SkillEntry[] }>("skills", "read", {
    ...(place === null
      ? {}
      : isAppPlace(place)
        ? { app: place }
        : { project: place }),
  });
  if (!result.ok) return result;
  const kind = placeKindOf(place === null ? null : placeOf(place));
  return {
    ok: true,
    value: result.value.skills
      .filter(
        (skill) =>
          skill.source !== "builtin" ||
          BUILTIN_SKILLS.find(
            (one) => one.name === skill.name,
          )?.places.includes(kind),
      )
      .map((skill) => ({
        name: skill.name,
        detail: skill.description,
        layer: skill.source,
        ...(skill.domain === null ? {} : { domain: skill.domain }),
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

// 이 자리에서 보이는 server 한 대와 그 층·자리다. 로그인은 자리로 부르므로 자리를 함께 든다.
interface ServerEntry {
  readonly server: McpServer;
  readonly layer: McpLayer;
  readonly place: Place | null;
}

/**
 * OAuth server의 로그인 상태를 이름과 자리로 한 번에 묻는다. 읽지 못하면 로그인 정보 없이 그대로 그린다(로그인
 * 단추도 없다). OAuth가 아닌 server는 묻지 않는다.
 */
async function rowsWithLogins(
  link: Link,
  entries: readonly ServerEntry[],
  enabled: (entry: ServerEntry) => boolean,
): Promise<McpRow[]> {
  const asked = entries.filter(
    (entry) =>
      entry.server.transport === "http" &&
      entry.server.http.auth.kind === "oauth2",
  );
  let states: { state: McpAuthStateName; reason: McpAuthFailure | null }[] = [];
  if (asked.length > 0) {
    const read = await link.memory<{
      servers: { state: McpAuthStateName; reason: McpAuthFailure | null }[];
    }>("agent-mcp-auth", "state", {
      servers: asked.map((entry) => ({
        name: entry.server.name,
        place: entry.place,
      })),
    });
    if (read.ok) states = read.value.servers;
  }
  return entries.map((entry) => {
    const { server } = entry;
    const auth =
      server.transport === "http" && server.http.auth.kind === "oauth2"
        ? server.http.auth
        : null;
    const at = auth === null ? -1 : asked.indexOf(entry);
    const state = at < 0 ? undefined : states[at];
    const on = enabled(entry);
    return {
      name: server.name,
      detail: detailOf(server),
      layer: entry.layer,
      on,
      status:
        auth === null
          ? null
          : state?.state === "signed_in"
            ? "connected"
            : "needs-sign-in",
      ...(auth === null
        ? {}
        : {
            login: {
              place: entry.place,
              client_id: auth.client_id,
              scopes: auth.scopes,
              state: state?.state ?? "none",
              reason: state?.reason ?? null,
            },
          }),
    } satisfies McpRow;
  });
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
    }>("project-extension-settings", "read", { project })
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
  const changed = await link.command(projectExtensionSettingsChange, {
    input: {
      project,
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

/** 이 자리에서 보이는 MCP server: 전역과 project 층. 전역 server를 project에서 끈 것은 꺼진 것으로 보인다. */
export async function readServers(
  link: Link,
  place: string | null,
): Promise<ReadResult<McpRow[]>> {
  const global = await readGlobalServers(link);
  if (!global.ok) return global;
  if (place === null || isAppPlace(place)) {
    return {
      ok: true,
      value: await rowsWithLogins(
        link,
        global.value.map((server) => ({
          server,
          layer: "global" as const,
          place: null,
        })),
        (entry) => entry.server.enabled,
      ),
    };
  }
  const project = await readProjectSettings(link, place);
  if (!project.ok) return project;
  const overridden = new Set(project.value.servers.map((one) => one.name));
  const placeOfProject: Place = { kind: "project", id: place };
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
            place: null,
          })),
        ...project.value.servers.map((server) => ({
          server,
          layer: "project" as const,
          place: placeOfProject,
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
      place: server.login.place,
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
      place: server.login.place,
    });
    return { ok: false, message: "unavailable" };
  }
  const done = await link.memory("agent-mcp-auth", "complete", {
    name: server.name,
    place: server.login.place,
    callback_port: begun.value.callback_port,
  });
  return done.ok ? { ok: true, value: null } : done;
}

/** 기다리는 로그인을 그만둔다. 보관한 token은 건드리지 않는다. */
export function cancelMcpSignIn(
  link: Link,
  server: {
    readonly name: string;
    readonly login: { readonly place: Place | null };
  },
): Promise<ReadResult<null>> {
  return link.memory("agent-mcp-auth", "cancel", {
    name: server.name,
    place: server.login.place,
  });
}

/** Workspace 전역 기본 model. 아직 고르지 않았으면 null이다. */
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

/**
 * 자리의 LOPHN.md 글. [Edit]이 여는 path(`instructions.open`)를 shell main의 file read로 읽는다.
 * 파일이 없거나 읽을 수 없으면 빈 글이다.
 */
export async function readInstructions(
  instructions: InstructionsApi | undefined,
  files: Pick<FilesApi, "read"> | undefined,
  place: string,
): Promise<string> {
  if (instructions === undefined || files === undefined) return "";
  try {
    const opened = await instructions.open({
      target: { layer: "project", place },
    });
    if (!opened.ok) return "";
    const read = await files.read({ path: opened.value.path });
    return read.ok ? read.value.text : "";
  } catch {
    return "";
  }
}
