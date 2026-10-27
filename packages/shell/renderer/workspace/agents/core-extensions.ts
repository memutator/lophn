// skill·MCP server·instruction·model 기본값을 읽는 부분. agent 설정 화면과 Agents 탭이 같이 쓴다. 전역 층은 settings 읽기와
// skills 읽기에서, project 층은 project 확장 설정에서 온다. 앱 자리에는 project 층이 없다.
import { projectExtensionSettingsChange } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type { McpServer } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import {
  BUILTIN_SKILLS,
  type SkillEntry,
} from "../../../../protocol/lophn-agent/skill-settings.ts";
import type { Role } from "../../../../protocol/lophn-agent/places.ts";
import type { FilesApi } from "../../../ipc/files.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { ReadResult } from "../source.ts";
import { isAppPlace } from "./agent-key.ts";
import type { Link } from "./core-link.ts";
import type { McpRow, SkillRow } from "./views.ts";

const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

function detailOf(server: McpServer): string {
  return server.transport === "stdio"
    ? server.stdio.executable
    : server.http.url;
}

/** 이 자리에서 보이는 skill. 내장 skill은 그 role의 agent만 갖는다(role이 null이면 모두 보인다). */
export async function readSkills(
  link: Link,
  place: string | null,
  role: Role | null,
): Promise<ReadResult<SkillRow[]>> {
  const result = await link.read<{ skills: SkillEntry[] }>("skills", "read", {
    ...(place === null
      ? {}
      : isAppPlace(place)
        ? { app: place }
        : { project: place }),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.skills
      .filter(
        (skill) =>
          skill.source !== "builtin" ||
          role === null ||
          (
            BUILTIN_SKILLS.find((one) => one.name === skill.name)?.roles as
              | readonly Role[]
              | undefined
          )?.includes(role),
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
async function readGlobalServers(link: Link): Promise<ReadResult<McpRow[]>> {
  const result = await link.memory<{
    settings: { key: string; default?: unknown; chosen?: unknown }[];
  }>("settings", "list", { keys: [MCP_SERVERS] });
  if (!result.ok) return result;
  const entry = result.value.settings.find((one) => one.key === MCP_SERVERS);
  const found = entry?.chosen ?? entry?.default;
  const servers = Array.isArray(found) ? (found as McpServer[]) : [];
  return {
    ok: true,
    value: servers.map((server) => ({
      name: server.name,
      detail: detailOf(server),
      layer: "global" as const,
      on: server.enabled,
      status: null,
    })),
  };
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
  if (place === null || isAppPlace(place)) return global;
  const project = await readProjectSettings(link, place);
  if (!project.ok) return project;
  const overridden = new Set(project.value.servers.map((one) => one.name));
  return {
    ok: true,
    value: [
      ...global.value
        .filter((row) => !overridden.has(row.name))
        .map((row) => ({
          ...row,
          on: row.on && !project.value.mcpOff.includes(row.name),
        })),
      ...project.value.servers.map(
        (server): McpRow => ({
          name: server.name,
          detail: detailOf(server),
          layer: "project",
          on: server.enabled,
          status: null,
        }),
      ),
    ],
  };
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
