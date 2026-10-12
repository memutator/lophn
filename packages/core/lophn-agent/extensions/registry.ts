import type {
  AgentPlace,
  McpServerConfig,
  McpTool,
  SkillSummary,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  parsePlaceMcpFile,
  type PlaceFiles,
  placeMcpPathOf,
  placeSkillsOf,
} from "./place-store.ts";
import {
  listSkillsSync,
  type SkillListing,
  type SkillSources,
  type SyncSkillFiles,
} from "./skills-sync.ts";

// 동기 등록부(concern lophn-agent/extensions). agents read와 `/` 메뉴는 동기 handler라 폴더를 훑는 비동기 발견을
// 기다리지 못한다. 한 자리의 skill·MCP 서버 목록을 동기로 읽어 한 번 만들면 이 등록부가 있는 동안 같은 자리에는
// 같은 목록을 준다(한 읽기 안에서 목록이 흔들리지 않는다). 파일 IO는 port로 받는다: core 프로세스의 module
// graph에는 동기 file API를 두지 않으므로 port는 Worker 안에서 URL로 연 adapter다(adapters/node-fs.ts).

export type ExtensionRegistryDeps = {
  root: string;
  files: PlaceFiles;
  skillFiles: SyncSkillFiles;
  // 전역(Workspace) 층이다. 서버 목록은 platform/settings 값, skill 출처는 등록 폴더·개인 보관소·동봉 폴더다.
  global: {
    servers: readonly McpServerConfig[];
    skills: Omit<SkillSources, "place">;
    // 전역에서 끈 skill의 정확한 이름이다. 전역 층의 같은 이름만 가리고 자리 층의 것은 그대로 둔다.
    skillsOff: readonly string[];
  };
};

export type ExtensionRegistry = {
  // 이 자리의 agent가 발견하는 skill이다. 자리 폴더가 먼저고 같은 이름은 먼저 발견한 하나다(R1, R3, R33).
  skills(place: AgentPlace): SkillListing;
  // 이 자리의 agent가 고를 수 있는 서버다. 전역 서버가 먼저고 자리 서버가 이어진다(R32). 전역과 이름이 겹치는
  // 자리 서버는 쓰지 않는다: 등록은 거절하지만 파일을 손으로 고쳐도 서버 이름이 하나의 서버를 가리킨다(R33).
  mcpServers(place: AgentPlace): readonly McpServerConfig[];
};

function key(place: AgentPlace): string {
  return `${place.kind}:${place.id}`;
}

export function createExtensionRegistry(
  deps: ExtensionRegistryDeps,
): ExtensionRegistry {
  const skills = new Map<string, SkillListing>();
  const servers = new Map<string, readonly McpServerConfig[]>();

  function placeServers(place: AgentPlace): readonly McpServerConfig[] {
    try {
      const text = deps.files.read(placeMcpPathOf(deps.root, place));
      if (text === null) return [];
      const parsed = parsePlaceMcpFile(text);
      // 틀린 파일은 그 자리 서버가 없는 것과 같다. 연결하지 않는 쪽으로 닫는다.
      return parsed.ok ? parsed.value.mcp_servers : [];
    } catch {
      return [];
    }
  }

  return {
    skills(place) {
      const found = skills.get(key(place));
      if (found !== undefined) return found;
      const discovered = listSkillsSync(deps.skillFiles, {
        ...deps.global.skills,
        place: placeSkillsOf(deps.root, place),
      });
      const listing = {
        ...discovered,
        entries: discovered.entries.filter((entry) =>
          entry.source_kind === "place" ||
          !deps.global.skillsOff.includes(entry.name)
        ),
      };
      skills.set(key(place), listing);
      return listing;
    },
    mcpServers(place) {
      const found = servers.get(key(place));
      if (found !== undefined) return found;
      const taken = new Set(deps.global.servers.map((server) => server.name));
      const own = placeServers(place).filter((server) => {
        if (taken.has(server.name)) return false;
        taken.add(server.name);
        return true;
      });
      const merged = [...deps.global.servers, ...own];
      servers.set(key(place), merged);
      return merged;
    },
  };
}

// agent 정의가 고를 수 있는 tool이다: enabled 서버가 분류에 적은 원래 tool 이름(R31). 새 tool은 기본 켬이지만
// 허락이 아니다(R24).
export function mcpToolsOf(servers: readonly McpServerConfig[]): McpTool[] {
  return servers.filter((server) => server.enabled).flatMap((server) =>
    Object.keys(server.classifications).map((tool) => ({
      server_name: server.name,
      original_tool: tool,
    }))
  );
}

// `/` 메뉴의 skill 한 줄이다(lophn-agent/commands R7). 자리 층의 것은 place, 나머지 전역 층은 workspace이고
// agent 정의가 끈 정확한 이름은 selected=false다. 지금 없는 끈 이름은 그대로 두어 아무 일도 하지 않는다(R30).
export function commandSkillsOf(
  entries: readonly SkillSummary[],
  skillsOff: readonly string[],
): {
  name: string;
  description: string;
  origin: "place" | "workspace";
  selected: boolean;
}[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    origin: entry.source_kind === "place"
      ? "place" as const
      : "workspace" as const,
    selected: !skillsOff.includes(entry.name),
  }));
}
