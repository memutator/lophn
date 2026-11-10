// workspace가 file tool에 여는 폴더를 rewind의 쓰기 폴더에 잇는 glue다. 규칙은 agent-workspaces의 workspace-folders가 갖고,
// 여기는 project·앱·feature module의 lookups로 사실을 모아 넘긴다.
import { dirname } from "node:path";
import type { Sql } from "../../../protocol/server/mod.ts";
import { artifactsFolder } from "../../../protocol/projects/mod.ts";
import { workflowsFolder } from "../../../protocol/workflows/paths.ts";
import {
  type FolderScope,
  type WorkspaceFacts,
  workspaceScope,
} from "../../agent-workspaces/workspace/workspace-folders.ts";
import {
  memoryFileOf,
  workspaceDataFolder,
  workspaceDataSkillsFolder,
} from "../../agent-workspaces/workspace/data-folder.ts";
import { appFolderPaths, appSourcePath } from "../../apps/lookups.ts";
import { projectFolderPaths } from "../../projects/lookups.ts";

type Lookup = { sql: Pick<Sql, "get" | "all"> };

function scopeOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): FolderScope | undefined {
  const found = lookup.sql.get(
    "select workspace_kind, workspace_id from sessions where id = ?",
    [session],
  );
  if (found === undefined) return undefined;
  const { sql } = lookup;
  const kind = found["workspace_kind"];
  const id = String(found["workspace_id"]);
  const workspace: WorkspaceFacts["workspace"] =
    kind === "project" || kind === "app" ? { kind, id } : null;
  const facts: WorkspaceFacts = {
    workspace,
    projectFolders:
      workspace?.kind === "project"
        ? projectFolderPaths(sql, workspace.id)
        : [],
    appSource:
      workspace?.kind === "app" ? appSourcePath(sql, workspace.id) : null,
    appFolders:
      workspace?.kind === "app" ? appFolderPaths(sql, workspace.id) : [],
    dataFolder:
      workspace === null
        ? null
        : workspaceDataFolder(dataRoot, { kind: workspace.kind, id } as never),
    allProjectFolders: [],
    // 쓰기 폴더만 쓰므로 읽기 범위를 좁히는 값은 보지 않는다.
    calledFromWorkspace: false,
    workflowsFolder:
      workspace?.kind === "project"
        ? workflowsFolder(dataRoot, workspace.id)
        : null,
    skillsFolder: workspaceDataSkillsFolder(dataRoot, workspace as never),
    artifactsFolder:
      workspace === null ? null : artifactsFolder(dataRoot, workspace),
  };
  return workspaceScope(facts);
}

// 그 session의 agent.memory가 쓰는 파일의 폴더다. file tool 범위(workspaceScope)에는 넣지 않는다: memory 파일은
// memory tool과 rewind만 닿는다.
function memoryFolderOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string[] {
  const found = lookup.sql.get("select agent from sessions where id = ?", [
    session,
  ]);
  if (found === undefined) return [];
  const file = memoryFileOf(dataRoot, String(found["agent"]) as never);
  return file === null ? [] : [dirname(file)];
}

// 그 session의 rewind 쓰기 폴더(절대 경로)다: file tool이 쓰는 폴더와 그 session의 memory 폴더.
export function workspaceFoldersOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string[] {
  const scope = scopeOf(lookup, dataRoot, session);
  return scope === undefined
    ? []
    : [...scope.write, ...memoryFolderOf(lookup, dataRoot, session)];
}

// 그 session이 명령을 돌릴 기본 폴더(절대 경로)다. home이거나 session이 없으면 undefined다.
export function workspaceBaseOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string | undefined {
  return scopeOf(lookup, dataRoot, session)?.base;
}

// session의 기본 폴더와 workspace가 여는 폴더 목록(절대 경로)이다. session lifecycle 목록이 싣는다. home이거나 session이 없으면 폴더가 없다.
export function sessionFoldersOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): { cwd: string | null; folders: string[] } {
  const scope = scopeOf(lookup, dataRoot, session);
  return {
    cwd: scope?.base ?? null,
    folders: scope === undefined ? [] : [...scope.write],
  };
}
