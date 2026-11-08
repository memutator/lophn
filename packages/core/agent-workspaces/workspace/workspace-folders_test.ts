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
const appArtifacts = "/data/apps/app_a/artifacts";
const project = { kind: "project", id: "prj_a" } as const;
const app = { kind: "app", id: "app_a" } as const;

// 이 규칙이 넓어지면 project workspace session이 앱 source를, app workspace session이 사람의 project 폴더나
// workflows/를, home session이 아무 폴더나 쓴다.
test("workspace 종류마다 쓰기 폴더는 그 그릇의 폴더뿐이다", () => {
  const projectWorkspace = workspaceScope({ ...base, workspace: project });
  assert.deepStrictEqual(projectWorkspace, {
    read: ["/p1", "/p2", workflows, skills, artifacts],
    write: ["/p1", "/p2", workflows, skills, artifacts],
    base: "/p1",
  });
  const appWorkspace = workspaceScope({
    ...base,
    workspace: app,
    skillsFolder: appSkills,
    artifactsFolder: appArtifacts,
  });
  // 앱 source 다음에 사람이 더 이은 폴더가 오고, 상대 경로 기준은 source다
  assert.deepStrictEqual(appWorkspace, {
    read: ["/app", "/shared", appSkills, appArtifacts],
    write: ["/app", "/shared", appSkills, appArtifacts],
    base: "/app",
  });
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
  // home은 모든 project 폴더를 읽기만 하고 자기 skills/만 쓴다
  assert.deepStrictEqual(
    workspaceScope({ ...base, workspace: null, skillsFolder: homeSkills }),
    { read: ["/p1", "/p2", "/q", homeSkills], write: [homeSkills] },
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
    }),
    { read: [homeSkills], write: [homeSkills] },
  );
});
