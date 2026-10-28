import type {
  AgentPlace,
  McpServer,
  PlaceKind,
  SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";
import type { PlaceFiles } from "./place-store.ts";
import {
  EMPTY_PROJECT_EXTENSIONS,
  parseProjectExtensions,
  type ProjectExtensions,
  type ProjectLayer,
} from "./project-settings.ts";
import {
  type McpRuntimeServer,
  mergeMcpLayers,
  runtimeServerOfLayer,
} from "./mcp-server.ts";
import {
  discoverSkills,
  pickSkills,
  type SkillFiles,
  type SkillListing,
  skillReceived,
  type SkillSources,
} from "./skills.ts";

// 동기 등록부. agents read와 `/` 메뉴는 동기 handler다. 한 place의 skill·MCP 서버 목록을 동기로 읽어 한 번 만들면 이 등록부가 있는 동안 같은 place에는
// 같은 목록을 준다(한 읽기 안에서 목록이 흔들리지 않는다). 파일 IO는 port로 받는다: core 프로세스의 module
// graph에는 동기 file API를 두지 않으므로 port는 Worker 안에서 URL로 연 adapter다(adapters/node-fs.ts).
// agent 정의 층(agent가 가진 서버와 끈 이름)은 여기 없다. 정의를 읽는 쪽이 더한다.

type ExtensionRegistryDeps = {
  root: string;
  projectLayer: ProjectLayer;
  files: PlaceFiles;
  skillFiles: SkillFiles;
  // place 그릇의 active domain이다(이름순). skill의 domain 층이 이것이다.
  domains(place: AgentPlace): readonly { id: string; name: string }[];
  // 전역(Workspace) 층이다. 서버 목록은 platform/settings 값, skill 출처는 등록 폴더·개인 보관소·내장 폴더다.
  global: {
    servers: readonly McpServer[];
    skills: Omit<SkillSources, "domains">;
    // 전역에서 끈 skill의 정확한 이름이다.
    skillsOff: readonly string[];
  };
};

export type ExtensionRegistry = {
  // 이 place의 agent가 발견하는 skill이다. 내장, 전역, domain 순으로 덮고 끈 것은 enabled false다. 내장 skill은
  // `places`에 선언된 종류만이고 null이면 모두다.
  skills(place: AgentPlace, kind: PlaceKind | null): SkillListing;
  // 이 place에서 쓸 수 있는 서버다. 전역에 project 층이 덮이고 이어진다. 앱 place에는 project 층이 없다.
  mcpServers(place: AgentPlace): readonly McpRuntimeServer[];
};

function key(place: AgentPlace): string {
  return `${place.kind}:${place.id}`;
}

// 한 읽기의 등록부 하나를 같은 place의 여러 agent가 같이 쓴다. skill 목록은 place 종류마다 다르다.
function skillKey(place: AgentPlace, kind: PlaceKind | null): string {
  return `${key(place)}:${kind ?? "all"}`;
}

export function createExtensionRegistry(
  deps: ExtensionRegistryDeps,
): ExtensionRegistry {
  const skills = new Map<string, SkillListing>();
  const servers = new Map<string, readonly McpRuntimeServer[]>();
  const global = deps.global.servers.map((server) =>
    runtimeServerOfLayer(server, null),
  );

  // 틀린 파일은 그 project 층이 없는 것과 같다. 연결하지 않는 쪽으로 닫는다.
  function projectOf(place: AgentPlace): ProjectExtensions {
    const project = deps.projectLayer.projectOf(place);
    if (project === null) return EMPTY_PROJECT_EXTENSIONS;
    try {
      const text = deps.files.read(
        deps.projectLayer.extensionsFile(deps.root, project),
      );
      if (text === null) return EMPTY_PROJECT_EXTENSIONS;
      const parsed = parseProjectExtensions(text);
      return parsed.ok ? parsed.value : EMPTY_PROJECT_EXTENSIONS;
    } catch {
      return EMPTY_PROJECT_EXTENSIONS;
    }
  }

  return {
    skills(place, kind) {
      const found = skills.get(skillKey(place, kind));
      if (found !== undefined) return found;
      const off = [
        ...new Set([...deps.global.skillsOff, ...projectOf(place).skills_off]),
      ];
      const listing = discoverSkills(
        deps.skillFiles,
        {
          ...deps.global.skills,
          domains: deps.domains(place).map((domain) => ({
            domain: domain.id,
            folder: deps.projectLayer.domains.skillsFolder(
              deps.root,
              domain.id,
            ),
          })),
        },
        { kind, off },
      );
      skills.set(skillKey(place, kind), listing);
      return listing;
    },
    mcpServers(place) {
      const found = servers.get(key(place));
      if (found !== undefined) return found;
      const own = projectOf(place);
      const merged = mergeMcpLayers([
        { servers: global, off: [] },
        {
          servers: own.mcp_servers.map((server) =>
            runtimeServerOfLayer(server, place),
          ),
          off: own.mcp_off,
        },
      ]);
      servers.set(key(place), merged);
      return merged;
    },
  };
}

// `/` 메뉴의 skill 한 줄이다(이름마다 하나: `pickSkills`). 일하는 domain 밖의 domain skill과, agent 정의가 고른 이름이 있으면 그 밖의 skill은 selected=false다. 끌 수 없는 내장 skill은
// 늘 켜져 있다. 지금 없는 고른 이름은 그대로 두어 아무 일도 하지 않는다. 받는 목록은 발견이 place 종류로 거른 것이다.
export function commandSkillsOf(
  entries: SkillListing["entries"],
  chosen: readonly string[],
  domains: readonly string[],
): {
  name: string;
  description: string;
  origin: SkillSource;
  selected: boolean;
}[] {
  const received = (entry: SkillListing["entries"][number]) =>
    entry.enabled && skillReceived(entry, chosen, domains);
  return pickSkills(entries, received).map((entry) => ({
    name: entry.name,
    description: entry.description,
    origin: entry.source,
    selected: received(entry),
  }));
}
