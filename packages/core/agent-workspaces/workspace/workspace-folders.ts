export type WorkspaceWorktreeFact = {
  id: string;
  repoRoot: string;
  path: string;
  branch: string | null;
};

export type WorkspaceFacts = {
  workspace: { kind: "project" | "app"; id: string } | null;
  // workspace가 project일 때 그 project의 등록 폴더(position 순)
  projectFolders: readonly string[];
  // project session이 worktree에 묶였을 때 원본 저장소 루트와 worktree 경로·메타.
  worktree?: WorkspaceWorktreeFact | null;
  // workspace가 app일 때 그 앱의 source 폴더. 아직 잇지 않았으면 null
  appSource: string | null;
  // workspace가 app일 때 사람이 source 밖에 더 이은 폴더(position 순)
  appFolders: readonly string[];
  // workspace의 data 폴더. 폴더가 없는 workspace의 상대 경로 기준이다
  dataFolder: string | null;
  // active project 전체 폴더. home만 쓴다
  allProjectFolders: readonly string[];
  // home session이 다른 workspace의 session이 부른 call로 열렸는가. 그런 session은 project 폴더를 읽지 않고 실어 보낸 것만 본다.
  calledFromWorkspace: boolean;
  // workspace가 project일 때 그 project의 `workflows/` 절대 경로. 그 project workspace의 session이 쓴다(아래 workspaceScope)
  workflowsFolder: string | null;
  // workspace의 `skills/` 절대 경로. Home·project·앱 workspace의 session이 쓴다(아래 workspaceScope)
  skillsFolder: string | null;
  // 전역 개인 skill 보관소(`<data>/skills`) 절대 경로. Home session만 쓴다(아래 workspaceScope)
  globalSkillsFolder?: string | null;
  // workspace의 `tools/` 절대 경로. Home·project·앱 workspace의 session이 쓴다(아래 workspaceScope)
  toolsFolder?: string | null;
  // workspace의 `artifacts/` 절대 경로. project·앱 workspace의 session이 쓴다(아래 workspaceScope)
  artifactsFolder: string | null;
};

// base는 상대 경로를 푸는 기준일 뿐 읽기·쓰기 허락이 아니다.
export type FolderScope = {
  read: string[];
  write: string[];
  base?: string;
  // 이 session의 tool-results 폴더. 읽기 전용이고 read 목록과 별개다
  results?: string;
  // worktree에 묶인 session의 shell 도구에 주입할 환경변수(PROJECT_ROOT, WORKTREE_*).
  env?: Record<string, string>;
};

// 어떤 workspace 종류가 어떤 폴더를 읽고 쓰는가의 규칙 하나. file tool scope(workspace-data)와 rewind가 이것을 쓴다.
// 앱·project의 data·release 사본(`<data>/apps/<app>/{data,bundles,staging,preview}`)과 agent 정의 폴더는 어느 workspace 종류에도 열지 않는다.
export function workspaceScope(facts: WorkspaceFacts): FolderScope {
  const { workspace } = facts;
  if (workspace === null) {
    // home은 project 폴더를 읽기만 하고 자기 `skills/`, `tools/`, 전역 개인 skill 보관소만 쓴다.
    const writable = [
      ...(facts.skillsFolder === null ? [] : [facts.skillsFolder]),
      ...(facts.toolsFolder ? [facts.toolsFolder] : []),
      ...(facts.globalSkillsFolder ? [facts.globalSkillsFolder] : []),
    ];
    return {
      read: [
        ...(facts.calledFromWorkspace ? [] : facts.allProjectFolders),
        ...writable,
      ],
      write: writable,
    };
  }
  // 사람의 폴더(project 폴더, 앱 source와 더한 폴더)가 data 폴더들보다 앞에 남는다. 상대 path의 기준이 첫 폴더라서다.
  let own: string[];
  let env: Record<string, string> | undefined;
  if (workspace.kind === "project") {
    const wt = facts.worktree;
    if (wt != null) {
      // worktree가 난 원래 폴더를 worktree 경로로 바꾸고, worktree를 맨 앞(base)으로 둔다.
      const others = facts.projectFolders.filter(
        (folder) => folder !== wt.repoRoot && folder !== wt.path,
      );
      own = [wt.path, ...others];
      env = {
        PROJECT_ROOT: wt.repoRoot,
        WORKTREE_PATH: wt.path,
        WORKTREE_ID: wt.id,
        ...(wt.branch === null ? {} : { WORKTREE_BRANCH: wt.branch }),
      };
    } else {
      own = [...facts.projectFolders];
    }
  } else {
    own = [
      ...(facts.appSource === null ? [] : [facts.appSource]),
      ...facts.appFolders,
    ];
  }
  const withBase = (folders: string[]): FolderScope => {
    const base = own[0] ?? facts.dataFolder ?? undefined;
    return {
      read: [...folders],
      write: [...folders],
      ...(base === undefined ? {} : { base }),
      ...(env === undefined ? {} : { env }),
    };
  };
  const folders = [...own];
  // workflows/는 그 project workspace의 session이 쓴다.
  if (workspace.kind === "project" && facts.workflowsFolder !== null)
    folders.push(facts.workflowsFolder);
  // skills/·tools/도 project·앱 workspace의 session이 쓴다(home은 위에서 따로).
  if (facts.skillsFolder !== null) folders.push(facts.skillsFolder);
  if (facts.toolsFolder) folders.push(facts.toolsFolder);
  // artifacts/는 project·앱 workspace의 session이 쓴다. 폴더 자체가 허용 폴더라 rewind 기록의 root가 되고 path는 `<name>/…`이다.
  if (facts.artifactsFolder !== null) folders.push(facts.artifactsFolder);
  return withBase(folders);
}
