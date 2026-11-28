import assert from "node:assert/strict";
import { test } from "node:test";
import { type WorkspaceFacts, workspaceScope } from "./workspace-folders.ts";

const base: WorkspaceFacts = {
  workspace: null,
  projectFolders: ["/p1", "/p2"],
  appSource: "/app",
  appFolders: ["/shared"],
  dataFolder: "/data/projects/prj_a",
  allProjectFolders: ["/p1", "/p2", "/q"],
  calledFromWorkspace: false,
  workflowsFolder: "/data/projects/prj_a/workflows",
  skillsFolder: "/data/projects/prj_a/skills",
  artifactsFolder: "/data/projects/prj_a/artifacts",
};
const workflows = "/data/projects/prj_a/workflows";
const skills = "/data/projects/prj_a/skills";
const artifacts = "/data/projects/prj_a/artifacts";
const appSkills = "/data/apps/app_a/skills";
const homeSkills = "/data/home/skills";
const homeTools = "/data/home/tools";
const globalSkills = "/data/skills";
const appArtifacts = "/data/apps/app_a/artifacts";
const project = { kind: "project", id: "prj_a" } as const;
const app = { kind: "app", id: "app_a" } as const;

// 이 규칙이 넓어지면 project workspace session이 앱 source나 전역 skill 폴더를, app workspace session이 사람의 project 폴더나
// workflows/·전역 skill 폴더를, home session이 아무 폴더나 쓴다.
test("workspace 종류마다 쓰기 폴더는 그 그릇의 폴더뿐이다", () => {
  const projectWorkspace = workspaceScope({
    ...base,
    workspace: project,
    globalSkillsFolder: globalSkills,
  });
  assert.deepStrictEqual(projectWorkspace, {
    read: ["/p1", "/p2", workflows, skills, artifacts],
    write: ["/p1", "/p2", workflows, skills, artifacts],
    base: "/p1",
  });
  // project·app workspace는 전역 개인 skill 폴더를 읽지도 쓰지도 못한다
  assert.ok(!projectWorkspace.read.includes(globalSkills));
  assert.ok(!projectWorkspace.write.includes(globalSkills));
  const appWorkspace = workspaceScope({
    ...base,
    workspace: app,
    skillsFolder: appSkills,
    globalSkillsFolder: globalSkills,
    artifactsFolder: appArtifacts,
  });
  // 앱 source 다음에 사람이 더 이은 폴더가 오고, 상대 경로 기준은 source다
  assert.deepStrictEqual(appWorkspace, {
    read: ["/app", "/shared", appSkills, appArtifacts],
    write: ["/app", "/shared", appSkills, appArtifacts],
    base: "/app",
  });
  assert.ok(!appWorkspace.read.includes(globalSkills));
  assert.ok(!appWorkspace.write.includes(globalSkills));
  // project workspace는 앱에 더한 폴더를 받지 않는다
  assert.ok(!projectWorkspace.write.includes("/shared"));
  // 폴더 없는 project는 workflows/, skills/, artifacts/만 열고 상대 경로 기준은 data 폴더다
  assert.deepStrictEqual(
    workspaceScope({ ...base, workspace: project, projectFolders: [] }),
    {
      read: [workflows, skills, artifacts],
      write: [workflows, skills, artifacts],
      base: "/data/projects/prj_a",
    },
  );
  // home은 모든 project 폴더를 읽기만 하고 자기 skills/, tools/, 전역 개인 skill 보관소만 쓴다
  assert.deepStrictEqual(
    workspaceScope({
      ...base,
      workspace: null,
      skillsFolder: homeSkills,
      toolsFolder: homeTools,
      globalSkillsFolder: globalSkills,
    }),
    {
      read: ["/p1", "/p2", "/q", homeSkills, homeTools, globalSkills],
      write: [homeSkills, homeTools, globalSkills],
    },
  );
});

// 이 규칙이 풀리면 project A가 부른 home의 전역 agent가 project B의 폴더를 읽는다.
test("다른 workspace의 session이 불러 열린 home session은 project 폴더를 읽지 못한다", () => {
  assert.deepStrictEqual(
    workspaceScope({
      ...base,
      workspace: null,
      calledFromWorkspace: true,
      skillsFolder: homeSkills,
      globalSkillsFolder: globalSkills,
    }),
    { read: [homeSkills, globalSkills], write: [homeSkills, globalSkills] },
  );
});

// 이 규칙이 깨지면 worktree에 묶인 lophn agent가 원래 저장소 루트(/p1) 파일을 수정한다.
test("worktree가 묶인 project session은 원래 repoRoot를 worktree 경로로 치환하고 env를 주입한다", () => {
  const scoped = workspaceScope({
    ...base,
    workspace: project,
    worktree: {
      id: "wkt_00000000000000000000000001",
      repoRoot: "/p1",
      path: "/data/worktrees/p1-12345678/feat-a",
      branch: "wt/feat-a",
    },
  });
  assert.deepStrictEqual(scoped.read, [
    "/data/worktrees/p1-12345678/feat-a",
    "/p2",
    workflows,
    skills,
    artifacts,
  ]);
  assert.deepStrictEqual(scoped.write, [
    "/data/worktrees/p1-12345678/feat-a",
    "/p2",
    workflows,
    skills,
    artifacts,
  ]);
  assert.equal(scoped.base, "/data/worktrees/p1-12345678/feat-a");
  assert.ok(!scoped.read.includes("/p1"));
  assert.ok(!scoped.write.includes("/p1"));
  assert.deepStrictEqual(scoped.env, {
    PROJECT_ROOT: "/p1",
    WORKTREE_PATH: "/data/worktrees/p1-12345678/feat-a",
    WORKTREE_ID: "wkt_00000000000000000000000001",
    WORKTREE_BRANCH: "wt/feat-a",
  });
});
