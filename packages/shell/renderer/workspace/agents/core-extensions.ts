// skill·MCP server·instruction·model 기본값을 읽는 부분. agent 설정 화면과 Agents 탭이 같이 쓴다. 전역 층은 settings 읽기와
// skills 읽기에서, project 층은 project 확장 설정에서 온다. 앱 자리에는 project 층이 없다.
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type {
  McpServer,
  McpServerConfig,
} from "../../../../protocol/lophn-agent/mcp-settings.ts";
import {
  BUILTIN_SKILLS,
  type SkillEntry,
} from "../../../../protocol/lophn-agent/skill-settings.ts";
import type { Role } from "../../../../protocol/lophn-agent/places.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { ReadResult } from "../source.ts";
import { isAppPlace } from "./agent-key.ts";
import type { Link } from "./core-link.ts";
import type { McpRow, SkillRow } from "./views.ts";

const MCP_SERVERS = "lophn-agent.extensions.mcp_servers";

function detailOf(server: McpServerConfig | McpServer): string {
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
    ...(place !== null && !isAppPlace(place) ? { project: place } : {}),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: result.value.skills.filter((skill) =>
      skill.source !== "builtin" || role === null ||
      BUILTIN_SKILLS.find((one) => one.name === skill.name)?.role === role
    ).map((skill) => ({
      name: skill.name,
      detail: skill.description,
      layer: skill.source,
      on: skill.enabled,
      builtIn: skill.source === "builtin",
    })),
  };
}

/** 전역 MCP server. 켜졌는지가 서버 설정의 enabled다. */
async function readGlobalServers(link: Link): Promise<ReadResult<McpRow[]>> {
  const result = await link.read<
    { settings: { key: string; value?: unknown }[] }
  >("settings", "get", {});
  if (!result.ok) return result;
  const found = result.value.settings.find((one) => one.key === MCP_SERVERS)
    ?.value;
  const servers = Array.isArray(found) ? found as McpServerConfig[] : [];
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

export interface ProjectServers {
  readonly servers: readonly McpServer[];
  readonly hash: string | null;
}

export async function readProjectServers(
  link: Link,
  project: string,
): Promise<ReadResult<ProjectServers>> {
  return await link.read<{ mcp_servers: McpServer[]; hash: string | null }>(
    "project-extension-settings",
    "read",
    { project },
  ).then((result) =>
    result.ok
      ? {
        ok: true as const,
        value: { servers: result.value.mcp_servers, hash: result.value.hash },
      }
      : result
  );
}

/** 이 자리에서 보이는 MCP server: 전역과 project 층. */
export async function readServers(
  link: Link,
  place: string | null,
): Promise<ReadResult<McpRow[]>> {
  const global = await readGlobalServers(link);
  if (!global.ok) return global;
  if (place === null || isAppPlace(place)) return global;
  const project = await readProjectServers(link, place);
  if (!project.ok) return project;
  return {
    ok: true,
    value: [
      ...global.value,
      ...project.value.servers.map((server): McpRow => ({
        name: server.name,
        detail: detailOf(server),
        layer: "project",
        on: server.enabled,
        status: null,
      })),
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

/** 자리의 LOPHN.md 글. 파일이 없거나 읽을 수 없으면 빈 글이다. */
export async function readInstructions(
  link: Link,
  instructions: InstructionsApi | undefined,
  layer: "project" | "app",
  place: string,
): Promise<string> {
  if (instructions === undefined) return "";
  try {
    const opened = await instructions.open({ target: { layer, place } });
    if (
      !opened.ok || opened.value.document === null ||
      opened.value.version === null
    ) {
      return "";
    }
    const page = await link.worker<{ text: string | null }>(
      "documents",
      "read",
      {
        reference: {
          document: opened.value.document,
          version: opened.value.version,
          section: null,
        },
      },
    );
    return page.ok ? page.value.text ?? "" : "";
  } catch {
    return "";
  }
}
