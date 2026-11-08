import type {
  AgentWorkspace,
  McpServer,
  WorkspaceKind,
  SkillSource,
} from "../../../protocol/lophn-agent/mod.ts";
import type { WorkspaceFiles } from "./workspace-store.ts";
import {
  EMPTY_PROJECT_EXTENSIONS,
  parseProjectExtensions,
  workspaceSkillsOf,
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
  type SharedSkillHead,
  sharedFor,
  sharedPathOf,
  type SkillFiles,
  type SkillListing,
  skillReceived,
  type SkillSources,
} from "./skills.ts";

// 동기 등록부. agents read와 `/` 메뉴는 동기 handler다. 한 workspace의 skill·MCP 서버 목록을 동기로 읽어 한 번 만들면 이 등록부가 있는 동안 같은 workspace에는
// 같은 목록을 준다(한 읽기 안에서 목록이 흔들리지 않는다). 파일 IO는 port로 받는다: core 프로세스의 module
// graph에는 동기 file API를 두지 않으므로 port는 Worker 안에서 URL로 연 adapter다(adapters/node-fs.ts).
// agent 정의 층(agent가 가진 서버와 끈 이름)은 여기 없다. 정의를 읽는 쪽이 더한다.

type ExtensionRegistryDeps = {
  root: string;
  projectLayer: ProjectLayer;
  files: WorkspaceFiles;
  skillFiles: SkillFiles;
  // project의 첫 등록 폴더나 앱 source 폴더다. 없으면 null이다.
  sourceFolder(workspace: AgentWorkspace): string | null;
  // 전역 층이다. 서버 목록은 platform/settings 값, skill 출처는 등록 폴더·개인 보관소·내장 폴더다.
  global: {
    servers: readonly McpServer[];
    skills: Omit<SkillSources, "workspaceData" | "workspace">;
    // 전역에서 끈 skill의 정확한 이름이다.
    skillsOff: readonly string[];
  };
};

export type ExtensionRegistry = {
  // 이 workspace(null은 Home)의 agent가 발견하는 skill이다. 내장, 전역, project·app, workspace-data 순으로 덮고 끈 것은
  // enabled false다. 내장 skill은 `workspaces`에 선언된 종류만이고 null이면 모두다.
  // `shared`는 그 agent에게 할당한 앱의 public skill이다. 내장 바로 위 층이다.
  skills(
    workspace: AgentWorkspace | null,
    kind: WorkspaceKind | null,
    shared?: readonly SharedSkillHead[],
  ): SkillListing;
  // 이 workspace(null은 Home)에서 쓸 수 있는 서버다. 전역에 workspace 층이 덮이고 이어진다.
  mcpServers(workspace: AgentWorkspace | null): readonly McpRuntimeServer[];
};

function key(workspace: AgentWorkspace | null): string {
  return workspace === null ? "home" : `${workspace.kind}:${workspace.id}`;
}

// 한 읽기의 등록부 하나를 같은 workspace의 여러 agent가 같이 쓴다. skill 목록은 workspace 종류마다 다르다.
function skillKey(
  workspace: AgentWorkspace | null,
  kind: WorkspaceKind | null,
  shared: readonly SharedSkillHead[],
): string {
  return `${key(workspace)}:${kind ?? "all"}:${shared.map(sharedPathOf).join(",")}`;
}

export function createExtensionRegistry(
  deps: ExtensionRegistryDeps,
): ExtensionRegistry {
  const skills = new Map<string, SkillListing>();
  const servers = new Map<string, readonly McpRuntimeServer[]>();
  const global = deps.global.servers.map((server) =>
    runtimeServerOfLayer(server, null),
  );

  // 틀린 파일은 그 workspace 층이 없는 것과 같다. 연결하지 않는 쪽으로 닫는다.
  function projectOf(workspace: AgentWorkspace | null): ProjectExtensions {
    try {
      const text = deps.files.read(
        deps.projectLayer.extensionsFile(deps.root, workspace),
      );
      if (text === null) return EMPTY_PROJECT_EXTENSIONS;
      const parsed = parseProjectExtensions(text);
      return parsed.ok ? parsed.value : EMPTY_PROJECT_EXTENSIONS;
    } catch {
      return EMPTY_PROJECT_EXTENSIONS;
    }
  }

  return {
    skills(workspace, kind, shared = []) {
      const found = skills.get(skillKey(workspace, kind, shared));
      if (found !== undefined) return found;
      const off = [
        ...new Set([
          ...deps.global.skillsOff,
          ...projectOf(workspace).skills_off,
        ]),
      ];
      const listing = discoverSkills(
        deps.skillFiles,
        {
          ...deps.global.skills,
          shared: sharedFor(shared, workspace),
          workspace: workspaceSkillsOf(
            deps.projectLayer,
            workspace,
            workspace === null ? null : deps.sourceFolder(workspace),
          ),
          workspaceData: deps.projectLayer.workspaceDataSkillsFolder(
            deps.root,
            workspace,
          ),
        },
        { kind, off },
      );
      skills.set(skillKey(workspace, kind, shared), listing);
      return listing;
    },
    mcpServers(workspace) {
      const found = servers.get(key(workspace));
      if (found !== undefined) return found;
      const own = projectOf(workspace);
      const merged = mergeMcpLayers([
        { servers: global, off: [] },
        {
          servers: own.mcp_servers.map((server) =>
            runtimeServerOfLayer(server, workspace ?? { kind: "home" }),
          ),
          off: own.mcp_off,
        },
      ]);
      servers.set(key(workspace), merged);
      return merged;
    },
  };
}

// `/` 메뉴의 skill 한 줄이다. agent 정의가 끈 이름(`skills_off`)은 selected=false다.
// 끌 수 없는 내장 skill은 늘 켜져 있다. 지금 없는 끈 이름은 그대로 두어 아무 일도 하지 않는다. 받는 목록은 발견이 workspace 종류로 거른 것이다.
export function commandSkillsOf(
  entries: SkillListing["entries"],
  off: readonly string[],
): {
  name: string;
  description: string;
  origin: SkillSource;
  selected: boolean;
}[] {
  return entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    origin: entry.source,
    selected: entry.enabled && skillReceived(entry, off),
  }));
}
