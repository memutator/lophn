import type { WorkspaceKind } from "../../../protocol/lophn-agent/workspaces.ts";
import { agentLine } from "../../lophn-agent/prompt-assembly/basis.ts";
import type { WorkspaceAgent } from "../../lophn-agent/prompt-assembly/model.ts";
import { wordsOf } from "../../../cli/parser.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// workspace 정보다. prompt에 넣을 잘 안 바뀌는 목록을 workspace 종류별로 글로 만든다. 순수 함수이고 data는 호출하는
// 쪽이 core 읽기로 모은다. 열린 session 목록과 앱 화면의 상태는 자주 바뀌어서 넣지 않는다.
// 예산은 글자 수이고 home의 앱 목록(앱마다 공개 command와 쓰는 곳)에 건다. session을 시작할 때 값을 고정해서 넘긴다.

export type FolderRead = { path: string; description: string };

export type WorkspaceProject = {
  id: string;
  name: string;
  title: string;
  purpose: string;
  folders: readonly FolderRead[];
};

type WorkspaceApp = {
  id: string;
  name: string;
  slug: string;
  purpose: string;
  // source 폴더. 아직 잇지 않았으면 null.
  source: string | null;
  // source 밖에 사람이 더 이은 폴더
  folders: readonly FolderRead[];
};

type CommandLine = { key: string; effect: string; description: string };

// home의 앱 목록에서 앱 하나의 덩어리다. packages는 그 앱이 주인인 package(name@version)다.
export type WorkspaceAppItem = {
  id: string;
  name: string;
  // `lophn <slug> <command>`로 부르는 이름
  slug: string;
  purpose: string;
  packages: readonly string[];
  // 활성 release가 내놓은 공개 command
  commands: readonly CommandLine[];
  // 이 command를 쓰는 다른 앱·project
  usedBy: readonly { tool: string; workspace: string }[];
};

// home의 project 목록 한 줄. name은 call 주소의 slug이고 title은 사람에게 보이는 이름이다.
export type WorkspaceProjectItem = {
  id: string;
  name: string;
  title: string;
  purpose: string;
};

// 이름과 slug는 바뀌거나 다시 쓰이고 id만 그대로다. memory가 id를 key로 적을 수 있게 줄마다 싣는다.
function named(title: string, slug: string, id: string): string {
  return title === slug ? `${title} (${id})` : `${title} (${slug}, ${id})`;
}

export type WorkspaceData = {
  self: { name: string };
  // 이 agent가 놓인 workspace. project 또는 app 중 하나다.
  project: WorkspaceProject | null;
  app: (WorkspaceApp & { declaration: string }) | null;
  // grant 안의 다른 agent
  agents: readonly WorkspaceAgent[];
  // home만. 모든 앱
  apps: readonly WorkspaceAppItem[];
  // home만
  projects: readonly WorkspaceProjectItem[];
  // 앱 workspace만. 앱의 활성 release가 없으면 null.
  release: { version: string; command_names: readonly string[] } | null;
  // project workspace만. 만들어 둔 workflows 폴더의 절대 path다. home과 app workspace는 null
  workflowsFolder: string | null;
  // workspace(Home, project, 앱)의 `skills/` 폴더 절대 path다. 폴더를 만들지 못했으면 null
  skillsFolder: string | null;
  // Home만. 전역 개인 skill 보관소(`<LOPHN_HOME>/skills`) 절대 path다. project·앱 workspace는 null
  globalSkillsFolder?: string | null;
  // project·앱 workspace의 artifacts 폴더와 목록. 폴더를 만들지 못했거나 home이면 null
  artifacts: { folder: string; items: readonly ArtifactEntry[] } | null;
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function folderText(f: FolderRead): string {
  return `${f.path} (${f.description})`;
}

function appLines(
  app: NonNullable<WorkspaceData["app"]>,
  release: WorkspaceData["release"],
  indent: string,
): string[] {
  const lines: string[] = [];
  if (app.source !== null) lines.push(`${indent}Source folder: ${app.source}`);
  if (app.folders.length > 0) {
    lines.push(`${indent}Folders: ${app.folders.map(folderText).join(", ")}`);
  }
  lines.push(`${indent}Declaration: ${app.declaration}`);
  if (release !== null) {
    const commands =
      release.command_names.length > 0
        ? [...release.command_names]
            .sort(cmp)
            .map((name) => `lophn ${wordsOf(`${app.slug}.${name}`).join(" ")}`)
            .join(", ")
        : "none";
    lines.push(
      `${indent}Active release: ${release.version}. commands: ${commands}`,
      `${indent}Run lophn ${app.slug} --help for current commands; app commands are read again on every call.`,
    );
  }
  return lines;
}

function workspaceLines(data: WorkspaceData): string[] {
  const { project, app, release } = data;
  if (project !== null) {
    const lines = [
      `Workspace: project ${named(project.title, project.name, project.id)}. ${project.purpose}`,
    ];
    if (project.folders.length > 0) {
      lines.push(`  Folders: ${project.folders.map(folderText).join(", ")}`);
    }
    if (data.workflowsFolder !== null) {
      lines.push(`  Workflows folder: ${data.workflowsFolder}`);
    }
    if (data.skillsFolder !== null) {
      lines.push(`  Skills folder: ${data.skillsFolder}`);
    }
    return lines;
  }
  if (app !== null) {
    return [
      `Workspace: app ${named(app.name, app.slug, app.id)}. ${app.purpose}`,
      ...appLines(app, release, "  "),
      ...(data.skillsFolder === null
        ? []
        : [`  Skills folder: ${data.skillsFolder}`]),
    ];
  }
  return [
    "Workspace: none",
    ...(data.skillsFolder === null
      ? []
      : [`  Skills folder: ${data.skillsFolder}`]),
    ...(data.globalSkillsFolder
      ? [`  Global skills folder: ${data.globalSkillsFolder}`]
      : []),
  ];
}

function agentLines(agents: readonly WorkspaceAgent[]): string[] {
  if (agents.length === 0) return [];
  const sorted = [...agents].sort((a, b) => cmp(a.handle, b.handle));
  return [
    "Agents you can call (use the handle as `to.agent` of a call; add `workspace` for a project or an app, none for no workspace; an agent marked as this workspace only needs `workspace` set to this one)",
    ...sorted.map((a) => `- ${agentLine(a)}`),
  ];
}

function projectListLines(items: readonly WorkspaceProjectItem[]): string[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => cmp(a.name, b.name));
  return [
    "Projects",
    ...sorted.map((i) => `- ${named(i.title, i.name, i.id)}: ${i.purpose}`),
  ];
}

// prompt 안의 글이라 앞쪽만 싣는다.
const ARTIFACT_LIST_MAX = 50;

function artifactLines(artifacts: WorkspaceData["artifacts"]): string[] {
  if (artifacts === null) return [];
  const lines = [`Folder: ${artifacts.folder}`];
  const sorted = [...artifacts.items].sort((a, b) => cmp(a.name, b.name));
  for (const a of sorted.slice(0, ARTIFACT_LIST_MAX)) {
    const description = a.description === "" ? "" : ` — ${a.description}`;
    lines.push(
      `- ${a.name}: ${a.title}${description} (artifacts/${a.name}/index.html)`,
    );
  }
  if (sorted.length > ARTIFACT_LIST_MAX) {
    lines.push(`${sorted.length - ARTIFACT_LIST_MAX} more`);
  }
  return ["Artifacts", ...lines];
}

// 앱이 쓴 글이라 한 줄로 접고 자른다.
const ONE_LINE_MAX = 100;

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= ONE_LINE_MAX ? line : `${line.slice(0, ONE_LINE_MAX)}…`;
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)].sort(cmp);
}

// command는 `lophn <앱 slug> <command>`의 낱말로 적는다(`session_usage` → `session-usage`).
function commandsText(
  commands: readonly CommandLine[],
  level: "full" | "short",
): string {
  return [...commands]
    .sort((a, b) => cmp(a.key, b.key))
    .map((t) => {
      const name = `${wordsOf(t.key).join(" ")} (${t.effect})`;
      return level === "full" ? `${name} ${oneLine(t.description)}` : name;
    })
    .join("; ");
}

// full은 command 설명까지, short는 command 키만, bare는 앱 이름과 목적만 싣는다. 앱 줄 밑에 그 앱이 주인인 package가 붙는다.
function appListLines(
  apps: readonly WorkspaceAppItem[],
  level: "full" | "short" | "bare",
): string[] {
  const lines: string[] = [];
  for (const a of [...apps].sort((x, y) => cmp(x.name, y.name))) {
    lines.push(`- ${named(a.name, a.slug, a.id)}: ${oneLine(a.purpose)}`);
    const packages = unique(a.packages);
    if (packages.length > 0) lines.push(`  Packages: ${packages.join(", ")}`);
    if (level === "bare") continue;
    if (a.commands.length > 0) {
      lines.push(
        `  Public commands (run as \`lophn ${a.slug} <command>\`): ${commandsText(a.commands, level)}`,
      );
    }
    const usedBy = unique(a.usedBy.map((u) => `${u.tool} ← ${u.workspace}`));
    if (usedBy.length > 0) {
      lines.push(`  Used by other apps and projects: ${usedBy.join(", ")}`);
    }
  }
  return lines;
}

// 예산 안이면 full, 넘으면 short, 그래도 넘으면 bare다.
function appSectionLines(
  apps: readonly WorkspaceAppItem[],
  budget: number,
): string[] {
  if (apps.length === 0) return [];
  for (const level of ["full", "short"] as const) {
    const lines = appListLines(apps, level);
    if (lines.join("\n").length <= budget) return ["Apps", ...lines];
  }
  return ["Apps", ...appListLines(apps, "bare")];
}

export function workspaceInfo(
  kind: WorkspaceKind,
  data: WorkspaceData,
  budget: number,
): string {
  const lines = [
    "# Your workspace",
    `You are ${data.self.name}.`,
    ...workspaceLines(data),
  ];
  const sections: string[][] = [agentLines(data.agents)];
  if (kind === "home") {
    sections.push(projectListLines(data.projects));
    sections.push(appSectionLines(data.apps, budget));
  }
  sections.push(artifactLines(data.artifacts));
  for (const section of sections) {
    if (section.length > 0) lines.push("", ...section);
  }
  return lines.join("\n");
}
