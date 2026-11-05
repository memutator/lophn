import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentWorkspace,
  type McpServer,
  mcpServerSchema,
  projectExtensionSettingsChange,
  projectExtensionSettingsRead,
  skillNameSchema,
  SKILLS_OFF_MAX,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  Compare,
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { checkMcpConfig } from "./mcp-config.ts";
import type { WorkspaceSkills } from "./skills.ts";
import {
  dataRootOf,
  fileHash,
  type WorkspaceFiles,
  type ReadSql,
} from "./workspace-store.ts";

// project 층 설정이다. MCP 서버와 끈 skill 이름은 설정 파일 한 파일에 둔다(skill 꾸러미는 workspace 그릇 자리의 `skills/`에 있다). 앱
// workspace에는 이 층이 없다. 파일 IO는 port로 받는다. 설정 변경은 사람만 한다(route actors).

// project 층의 자리 규칙이다. harness는 이 규칙을 모르고 조립이 workspace 층의 값을 넘긴다.
export type ProjectLayer = {
  // workspace 그릇 자리(`<data>/projects/<prj>`, `<data>/apps/<app>`)의 skill 꾸러미 폴더다.
  workspaceDataSkillsFolder(root: string, workspace: AgentWorkspace): string;
  // root 아래 어느 workspace의 그릇 자리 `skills/`(그 아래 포함)인지다. path는 `.`·`..`를 접은 절대 경로다.
  isWorkspaceDataSkills(root: string, path: string): boolean;
  // workspace의 project id다. project 층이 없는 workspace(앱)는 null이다.
  projectOf(workspace: AgentWorkspace): string | null;
  extensionsFile(root: string, project: string): string;
  // project 폴더들이 든 폴더다.
  settingsFolderArea(root: string): string;
  // 그 폴더 안의 이름이 project 폴더면 project id, 아니면 null이다.
  projectIdOfFolder(name: string): string | null;
  // 그 폴더 안의 skill 꾸러미 폴더다.
  workspaceSkillsFolder(sourceFolder: string): string;
};

// workspace 폴더의 `.lophn/skills`를 발견 출처로 바꾼다. 폴더가 없으면 null이다.
export function workspaceSkillsOf(
  layer: ProjectLayer,
  workspace: AgentWorkspace,
  sourceFolder: string | null,
): WorkspaceSkills | null {
  return sourceFolder === null
    ? null
    : {
        source: workspace.kind,
        folder: layer.workspaceSkillsFolder(sourceFolder),
      };
}

// 서버 한 칸, 끈 skill 이름, 이 project에서 끈 전역 서버 이름이다.
export type ProjectExtensions = {
  mcp_servers: McpServer[];
  skills_off: string[];
  mcp_off: string[];
};

export const EMPTY_PROJECT_EXTENSIONS: ProjectExtensions = {
  mcp_servers: [],
  skills_off: [],
  mcp_off: [],
};

const fileSchema = z.strictObject({
  mcp_servers: z.array(mcpServerSchema).max(32),
  skills_off: z.array(skillNameSchema).max(SKILLS_OFF_MAX),
  mcp_off: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).max(32),
});

function serializeProjectExtensions(value: ProjectExtensions): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// 파일은 사람이 손으로 고칠 수도 있어 읽을 때 다시 검사한다. 틀린 파일은 오류 이유를 돌려준다.
export function parseProjectExtensions(
  text: string,
): Result<ProjectExtensions, string> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("project extensions file is not JSON");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) return err("project extensions file has a wrong shape");
  const names = parsed.data.mcp_servers.map((server) => server.name);
  if (new Set(names).size !== names.length) {
    return err("project extensions file repeats a server name");
  }
  return ok(parsed.data);
}

type ProjectExtensionDeps = {
  files: WorkspaceFiles;
  projectLayer: ProjectLayer;
  lookups(sql: ReadSql): { projectExists(project: string): boolean };
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};

type Current = { hash: string; value: ProjectExtensions | null };

// 파일이 없으면 null이다. 틀린 파일은 hash만 있고 내용이 없는 것으로 읽는다: 새 내용 전체로 덮어쓸 수는 있다.
function readCurrent(
  deps: ProjectExtensionDeps,
  root: string,
  project: string,
): Result<Current | null> {
  try {
    const text = deps.files.read(
      deps.projectLayer.extensionsFile(root, project),
    );
    if (text === null) return ok(null);
    const parsed = parseProjectExtensions(text);
    return ok({ hash: fileHash(text), value: parsed.ok ? parsed.value : null });
  } catch {
    return err({
      code: "unavailable",
      message: "project extensions file could not be read",
    });
  }
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

export function createProjectExtensionReads(deps: ProjectExtensionDeps): {
  read: ReadDefinition<typeof projectExtensionSettingsRead>;
} {
  return {
    read: {
      route: projectExtensionSettingsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        input: Input<typeof projectExtensionSettingsRead>,
      ): Result<Output<typeof projectExtensionSettingsRead>> {
        const { project } = input;
        if (!deps.lookups(snapshot.sql).projectExists(project)) {
          return err({ code: "not_found", message: "project not found" });
        }
        const root = dataRootOf(snapshot.sql, deps.dataRoot);
        if (!root.ok) return root;
        const current = readCurrent(deps, root.value, project);
        if (!current.ok) return current;
        if (current.value !== null && current.value.value === null) {
          return invalid("project extensions file is invalid");
        }
        const value = current.value?.value ?? EMPTY_PROJECT_EXTENSIONS;
        return ok({
          project,
          mcp_servers: value.mcp_servers,
          skills_off: value.skills_off,
          mcp_off: value.mcp_off,
          hash: current.value?.hash ?? null,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

export function createProjectExtensionCommands(deps: ProjectExtensionDeps): {
  change: CommandDefinition<typeof projectExtensionSettingsChange>;
} {
  return {
    change: {
      route: projectExtensionSettingsChange,
      handle(
        tx: Tx,
        _ctx: RequestContext,
        input: Input<typeof projectExtensionSettingsChange>,
        compare: Compare<typeof projectExtensionSettingsChange>,
      ): Result<Output<typeof projectExtensionSettingsChange>> {
        const { project } = input;
        if (!deps.lookups(tx.sql).projectExists(project)) {
          return err({ code: "not_found", message: "project not found" });
        }
        const root = dataRootOf(tx.sql, deps.dataRoot);
        if (!root.ok) return root;
        const current = readCurrent(deps, root.value, project);
        if (!current.ok) return current;
        if ((current.value?.hash ?? null) !== compare.hash) {
          return err({
            code: "conflict",
            message: "project extensions file hash changed",
          });
        }
        const checked = checkMcpConfig(input.mcp_servers);
        if (!checked.ok) return checked;
        const problem = checked.value.problems[0];
        if (problem !== undefined) {
          return invalid(`mcp server ${problem.server}: ${problem.reason}`);
        }
        const text = serializeProjectExtensions({
          mcp_servers: input.mcp_servers,
          skills_off: input.skills_off,
          mcp_off: input.mcp_off,
        });
        try {
          deps.files.writeAtomic(
            deps.projectLayer.extensionsFile(root.value, project),
            text,
          );
        } catch {
          return err({
            code: "unavailable",
            message: "project extensions file could not be written",
          });
        }
        return ok({ project, hash: fileHash(text) });
      },
    },
  };
}
