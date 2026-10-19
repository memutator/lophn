import type { Role } from "../../../protocol/lophn-agent/places.ts";
import {
  type FolderRead,
  renderKindText,
} from "../../lophn-agent/prompt-assembly/kind-text.ts";
import type {
  PlaceAgent,
  PlaceKinds,
} from "../../lophn-agent/prompt-assembly/model.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// place 정보다. prompt에 넣을 잘 안 바뀌는 목록을 role별로 글로 만든다. 순수 함수이고 data는 호출하는
// 쪽이 core 읽기로 모은다. 열린 session 목록과 앱 화면의 상태는 자주 바뀌어서 넣지 않는다.
// 예산은 글자 수이고 kind 글에만 건다. session을 시작할 때 값을 고정해서 넘긴다.

export type PlaceProject = {
  id: string;
  name: string;
  purpose: string;
  folders: readonly FolderRead[];
  subfolders: readonly FolderRead[];
};

type PlaceApp = {
  id: string;
  name: string;
  purpose: string;
  // source 폴더. 아직 잇지 않았으면 null.
  source: string | null;
};

// lophn의 지도에서 project 하나의 덩어리다.
export type MapProject = {
  name: string;
  purpose: string;
  app: string | null;
  // 앱의 활성 release가 내놓은 공개 tool
  tools: readonly { key: string; effect: string; description: string }[];
  // name@version
  packages: readonly string[];
  // 이 앱의 tool을 쓰는 다른 project
  usedBy: readonly { tool: string; project: string }[];
};

export type PlaceData = {
  self: { role: Role; name: string };
  // 이 agent가 놓인 place
  project: PlaceProject | null;
  // PM만. project의 앱이 있을 때.
  app: (PlaceApp & { blueprint: string }) | null;
  // grant 안의 다른 agent
  agents: readonly PlaceAgent[];
  // 쓰고 있는 kind 글. lophn·App Engineer와 kind가 없는 project는 null.
  kinds: PlaceKinds | null;
  // Project Manager가 쓸 kinds 파일 경로. 파일이 아직 없어도 경로는 안다.
  kindsFile: string | null;
  // Operator는 grant 안의 앱, lophn은 모든 앱
  apps: readonly { name: string; purpose: string }[];
  // lophn만. project마다 한 덩어리의 지도
  projects: readonly MapProject[];
  // PM만. 앱의 활성 release가 없으면 null.
  release: { version: string; api_names: readonly string[] } | null;
  // project의 PM과 Operator만. 폴더를 정할 수 없으면 null.
  artifacts: { folder: string; items: readonly ArtifactEntry[] } | null;
  // project의 PM만. project 층 skill 폴더
  skillsFolder: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  lophn: "lophn",
  project_manager: "Project Manager",
  app_engineer: "App Engineer",
  operator: "Operator",
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function folderText(f: FolderRead): string {
  return `${f.path} (${f.description})`;
}

function placeLines(data: PlaceData): string[] {
  const { project, app, release } = data;
  if (project !== null) {
    const lines = [`Place: project ${project.name}. ${project.purpose}`];
    if (data.kindsFile !== null) lines.push(`  Kinds file: ${data.kindsFile}`);
    if (project.folders.length > 0) {
      lines.push(`  Folders: ${project.folders.map(folderText).join(", ")}`);
    }
    for (const folder of project.subfolders) {
      lines.push(`    ${folderText(folder)}`);
    }
    if (data.skillsFolder !== null) {
      lines.push(`  Skills folder: ${data.skillsFolder}`);
    }
    if (app !== null) {
      lines.push(`  App: ${app.name}. ${app.purpose}`);
      if (app.source !== null) lines.push(`    Source folder: ${app.source}`);
      lines.push(`    Blueprint: ${app.blueprint}`);
      if (release !== null) {
        const apis = release.api_names.length > 0
          ? [...release.api_names].sort(cmp).join(", ")
          : "none";
        lines.push(`    Active release: ${release.version}. app-api: ${apis}`);
      }
    }
    return lines;
  }
  return ["Place: none"];
}

function agentLines(agents: readonly PlaceAgent[]): string[] {
  if (agents.length === 0) return [];
  const sorted = [...agents].sort((a, b) =>
    cmp(`${a.role}\0${a.name}`, `${b.role}\0${b.name}`)
  );
  return [
    "Agents you can call (use these names as the `to` of a call)",
    ...sorted.map((a) =>
      `- ${ROLE_LABEL[a.role]} ${a.name}${
        a.place === null ? "" : ` (${a.place})`
      }: ${a.line}`
    ),
  ];
}

function listLines(
  title: string,
  items: readonly { name: string; purpose: string }[],
): string[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => cmp(a.name, b.name));
  return [title, ...sorted.map((i) => `- ${i.name}: ${i.purpose}`)];
}

// prompt 안의 글이라 앞쪽만 싣는다.
const ARTIFACT_LIST_MAX = 50;

function artifactLines(
  artifacts: NonNullable<PlaceData["artifacts"]>,
): string[] {
  const sorted = [...artifacts.items].sort((a, b) => cmp(a.name, b.name));
  const shown = sorted.slice(0, ARTIFACT_LIST_MAX);
  const lines = ["Artifacts", `Folder: ${artifacts.folder}`];
  for (const a of shown) {
    const description = a.description === "" ? "" : ` — ${a.description}`;
    lines.push(
      `- ${a.name}: ${a.title}${description} (artifacts/${a.name}/index.html)`,
    );
  }
  if (sorted.length > shown.length) {
    lines.push(`${sorted.length - shown.length} more`);
  }
  return lines;
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

// full은 tool 설명까지, short는 tool 키만, bare는 project와 앱 이름만 싣는다.
function mapLines(
  projects: readonly MapProject[],
  level: "full" | "short" | "bare",
): string[] {
  const lines: string[] = [];
  for (const p of [...projects].sort((a, b) => cmp(a.name, b.name))) {
    lines.push(`Project ${p.name}: ${oneLine(p.purpose)}`);
    if (p.app !== null) lines.push(`  App: ${p.app}`);
    if (level === "bare") continue;
    const tools = [...p.tools].sort((a, b) => cmp(a.key, b.key)).map((t) =>
      level === "full"
        ? `${t.key} (${t.effect}) ${oneLine(t.description)}`
        : `${t.key} (${t.effect})`
    );
    if (tools.length > 0) lines.push(`  Public tools: ${tools.join("; ")}`);
    const packages = unique(p.packages);
    if (packages.length > 0) lines.push(`  Packages: ${packages.join(", ")}`);
    const usedBy = unique(p.usedBy.map((u) => `${u.tool} ← ${u.project}`));
    if (usedBy.length > 0) {
      lines.push(`  Used by other projects: ${usedBy.join(", ")}`);
    }
  }
  return lines;
}

// 예산 안이면 full, 넘으면 short, 그래도 넘으면 bare다.
function projectMapLines(
  projects: readonly MapProject[],
  budget: number,
): string[] {
  if (projects.length === 0) return [];
  for (const level of ["full", "short"] as const) {
    const lines = mapLines(projects, level);
    if (lines.join("\n").length <= budget) return ["Projects", ...lines];
  }
  return ["Projects", ...mapLines(projects, "bare")];
}

// 예산 안이면 full, 넘으면 names(kind 이름), 그래도 넘으면 count다.
function kindLines(kinds: PlaceKinds | null, budget: number): string[] {
  if (kinds === null) return [];
  for (const level of ["full", "names"] as const) {
    const text = renderKindText(kinds.text, level);
    if (text.length <= budget) return ["Kinds", text];
  }
  return ["Kinds", renderKindText(kinds.text, "count")];
}

export function placeInfo(role: Role, data: PlaceData, budget: number): string {
  const lines = [
    "# Your place",
    `You are ${data.self.name}, a ${ROLE_LABEL[role]}.`,
    ...placeLines(data),
  ];
  const sections: string[][] = [agentLines(data.agents)];
  if (role === "lophn") {
    sections.push(projectMapLines(data.projects, budget));
  }
  if (role === "lophn" || role === "operator") {
    sections.push(listLines("Apps", data.apps));
  }
  if (
    (role === "project_manager" || role === "operator") &&
    data.artifacts !== null
  ) {
    sections.push(artifactLines(data.artifacts));
  }
  sections.push(kindLines(data.kinds, budget));
  for (const section of sections) {
    if (section.length > 0) lines.push("", ...section);
  }
  return lines.join("\n");
}
