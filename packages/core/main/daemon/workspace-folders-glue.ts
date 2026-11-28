// workspace가 file tool에 여는 폴더를 rewind의 쓰기 폴더에 잇는 glue다. 규칙은 agent-workspaces의 workspace-folders가 갖고,
// 여기는 project·앱·feature module의 lookups로 사실을 모아 넘긴다.
import { homedir } from "node:os";
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
  globalSkillsFolder,
  memoryFileOf,
  workspaceDataFolder,
  workspaceDataSkillsFolder,
  workspaceDataToolsFolder,
} from "../../agent-workspaces/workspace/data-folder.ts";
import { appFolderPaths, appSourcePath } from "../../apps/lookups.ts";
import {
  activeProjectFolderPaths,
  projectFolderPaths,
} from "../../projects/lookups.ts";
import { safeRealpath } from "../../projects/worktrees/mod.ts";

type Lookup = { sql: Pick<Sql, "get" | "all"> };

function scopeOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
  includeRead = false,
): FolderScope | undefined {
  const found = lookup.sql.get(
    includeRead
      ? "select workspace_kind, workspace_id, called_from_kind, worktree_id from sessions where id = ?"
      : "select workspace_kind, workspace_id, worktree_id from sessions where id = ?",
    [session],
  );
  if (found === undefined) return undefined;
  const { sql } = lookup;
  const kind = found["workspace_kind"];
  const id = String(found["workspace_id"]);
  const workspace: WorkspaceFacts["workspace"] =
    kind === "project" || kind === "app" ? { kind, id } : null;
  const calledFromWorkspace =
    includeRead &&
    found["called_from_kind"] !== null &&
    found["called_from_kind"] !== undefined;
  const worktreeId =
    found["worktree_id"] !== null && found["worktree_id"] !== undefined
      ? String(found["worktree_id"])
      : null;
  let projectFolders =
    workspace?.kind === "project" ? projectFolderPaths(sql, workspace.id) : [];
  let worktree: WorkspaceFacts["worktree"] = null;
  if (workspace?.kind === "project" && worktreeId !== null) {
    let wt: Record<string, unknown> | undefined;
    try {
      wt = sql.get(
        "select id, repo_root, path, branch, status from project_worktrees where id = ? and project_id = ?",
        [worktreeId, workspace.id],
      );
    } catch {
      // 테스트 DB에 project_worktrees 표가 없어도 worktree_id가 있으면 원래 폴더로 풀지 않는다.
      wt = undefined;
    }
    if (wt !== undefined && String(wt["status"]) === "ready") {
      worktree = {
        id: String(wt["id"]),
        repoRoot: String(wt["repo_root"]),
        path: String(wt["path"]),
        branch:
          wt["branch"] === null || wt["branch"] === undefined
            ? null
            : String(wt["branch"]),
      };
    } else if (wt !== undefined) {
      // worktree가 missing·removing·removed 등 ready가 아니면 원래 repo_root로 폴백하지 않고 범위와 base에서 제외한다.
      const repoRoot = String(wt["repo_root"]);
      const realRepoRoot = safeRealpath(repoRoot);
      projectFolders = projectFolders.filter(
        (folder) =>
          folder !== repoRoot && safeRealpath(folder) !== realRepoRoot,
      );
    } else {
      // worktree 행을 찾지 못하면 어느 폴더가 repo_root인지 알 수 없으므로 project 폴더를 모두 제외한다.
      projectFolders = [];
    }
  }
  const facts: WorkspaceFacts = {
    workspace,
    projectFolders,
    worktree,
    appSource:
      workspace?.kind === "app" ? appSourcePath(sql, workspace.id) : null,
    appFolders:
      workspace?.kind === "app" ? appFolderPaths(sql, workspace.id) : [],
    dataFolder:
      workspace === null
        ? null
        : workspaceDataFolder(dataRoot, { kind: workspace.kind, id } as never),
    allProjectFolders:
      includeRead && workspace === null && !calledFromWorkspace
        ? activeProjectFolderPaths(sql)
        : [],
    calledFromWorkspace,
    workflowsFolder:
      workspace?.kind === "project"
        ? workflowsFolder(dataRoot, workspace.id)
        : null,
    skillsFolder: workspaceDataSkillsFolder(dataRoot, workspace as never),
    globalSkillsFolder:
      workspace === null ? globalSkillsFolder(dataRoot) : null,
    toolsFolder: workspaceDataToolsFolder(dataRoot, workspace as never),
    artifactsFolder:
      workspace === null ? null : artifactsFolder(dataRoot, workspace),
  };
  return workspaceScope(facts);
}

// 그 session의 file 읽기 범위(절대 경로)다. `lophn skill check`의 agent 범위 검사에 쓴다.
export function workspaceReadScopeOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
): FolderScope | undefined {
  return scopeOf(lookup, dataRoot, session, true);
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

// 그 session이 명령을 돌릴 기본 폴더(절대 경로)다. Home은 OS home 폴더, session이 없으면 undefined다.
export function workspaceBaseOf(
  lookup: Lookup,
  dataRoot: string,
  session: string,
  homeDir: () => string = homedir,
): string | undefined {
  const scope = scopeOf(lookup, dataRoot, session);
  if (scope === undefined) return undefined;
  return scope.base ?? homeDir();
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
