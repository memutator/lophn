// workspace가 file tool에 여는 폴더를 rewind의 쓰기 폴더에 잇는 glue다. 규칙은 agent-workspaces의 workspace-folders가 갖고,
// 여기는 project·앱·feature module의 lookups로 사실을 모아 넘긴다.
import type { Sql } from "../../../protocol/server/mod.ts";
import { artifactsFolder } from "../../../protocol/projects/mod.ts";
import { workflowsFolder } from "../../../protocol/workflows/paths.ts";
import {
  type FolderScope,
  type WorkspaceFacts,
  workspaceScope,
} from "../../agent-workspaces/workspace/workspace-folders.ts";
import {
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

// 그 session의 쓰기 폴더(절대 경로)다.
export function workspaceFoldersOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string[] {
  return scopeOf(lookup, dataRoot, session)?.write ?? [];
}

// 그 session이 명령을 돌릴 기본 폴더(절대 경로)다. home이거나 session이 없으면 undefined다.
export function workspaceBaseOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): string | undefined {
  return scopeOf(lookup, dataRoot, session)?.base;
}
