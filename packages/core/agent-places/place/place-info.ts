import type { PlaceKind } from "../../../protocol/lophn-agent/places.ts";
import type { PlaceAgent } from "../../lophn-agent/prompt-assembly/model.ts";
import { wordsOf } from "../../../cli/parser.ts";
import type { ArtifactEntry } from "./artifact-list.ts";

// place 정보다. prompt에 넣을 잘 안 바뀌는 목록을 place 종류별로 글로 만든다. 순수 함수이고 data는 호출하는
// 쪽이 core 읽기로 모은다. 열린 session 목록과 앱 화면의 상태는 자주 바뀌어서 넣지 않는다.
// 예산은 글자 수이고 domain 지도에 건다. session을 시작할 때 값을 고정해서 넘긴다.

export type FolderRead = { path: string; description: string };

export type PlaceProject = {
  id: string;
  name: string;
  purpose: string;
  folders: readonly FolderRead[];
};

type PlaceApp = {
  id: string;
  name: string;
  purpose: string;
  // source 폴더. 아직 잇지 않았으면 null.
  source: string | null;
  // source 밖에 사람이 더 이은 폴더
  folders: readonly FolderRead[];
};

// 이 session이 맡은 domain 하나다. folder는 폴더를 만들지 못했으면 null이다.
export type PlaceDomain = {
  name: string;
  title: string;
  purpose: string;
  folder: string | null;
  // 폴더를 정할 수 없으면 null.
  artifacts: { folder: string; items: readonly ArtifactEntry[] } | null;
  // 주인 앱의 활성 release가 내놓은 이 domain의 command 전부(비공개 포함). `lophn <앱 slug> <command>`로 부른다.
  commands: readonly CommandLine[];
};

type CommandLine = { key: string; effect: string; description: string };

// home의 지도에서 domain 하나의 덩어리다.
export type MapDomain = {
  name: string;
  // "project <name>" 또는 "app <name>"
  owner: string;
  purpose: string;
  // 주인 앱의 활성 release가 내놓은 이 domain의 공개 command
  tools: readonly CommandLine[];
  // 이 command를 쓰는 다른 domain
  usedBy: readonly { tool: string; domain: string }[];
};

export type PlaceData = {
  self: { name: string };
  // 이 agent가 놓인 place. project 또는 app 중 하나다.
  project: PlaceProject | null;
  app: (PlaceApp & { declaration: string }) | null;
  // grant 안의 다른 agent
  agents: readonly PlaceAgent[];
  // 이 session이 받은 domain. home은 없다.
  domains: readonly PlaceDomain[];
  // home은 모든 앱. packages는 그 앱이 주인인 package(name@version)다.
  apps: readonly {
    name: string;
    purpose: string;
    packages: readonly string[];
  }[];
  // home만
  projects: readonly { name: string; purpose: string }[];
  // home만. domain마다 한 덩어리의 지도
  map: readonly MapDomain[];
  // 앱 place만. 앱의 활성 release가 없으면 null.
  release: { version: string; command_names: readonly string[] } | null;
  // project place만. 만들어 둔 workflows 폴더의 절대 path다. home과 app place는 null
  workflowsFolder: string | null;
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function folderText(f: FolderRead): string {
  return `${f.path} (${f.description})`;
}

function appLines(
  app: NonNullable<PlaceData["app"]>,
  release: PlaceData["release"],
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
        ? [...release.command_names].sort(cmp).join(", ")
        : "none";
    lines.push(
      `${indent}Active release: ${release.version}. commands: ${commands}`,
    );
  }
  return lines;
}

function placeLines(data: PlaceData): string[] {
  const { project, app, release } = data;
  if (project !== null) {
    const lines = [`Place: project ${project.name}. ${project.purpose}`];
    if (project.folders.length > 0) {
      lines.push(`  Folders: ${project.folders.map(folderText).join(", ")}`);
    }
    if (data.workflowsFolder !== null) {
      lines.push(`  Workflows folder: ${data.workflowsFolder}`);
    }
    return lines;
  }
  if (app !== null) {
    return [
      `Place: app ${app.name}. ${app.purpose}`,
      ...appLines(app, release, "  "),
    ];
  }
  return ["Place: none"];
}

function agentLines(agents: readonly PlaceAgent[]): string[] {
  if (agents.length === 0) return [];
  const sorted = [...agents].sort((a, b) => cmp(a.name, b.name));
  return [
    "Agents you can call (use the name as `to.agent` of a call; add `place` for a project or an app, none for no place)",
    ...sorted.map((a) => `- ${a.name}`),
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

// 앱 줄 밑에 그 앱이 주인인 package가 붙는다.
function appListLines(apps: PlaceData["apps"]): string[] {
  if (apps.length === 0) return [];
  const lines = ["Apps"];
  for (const a of [...apps].sort((x, y) => cmp(x.name, y.name))) {
    lines.push(`- ${a.name}: ${a.purpose}`);
    const packages = unique(a.packages);
    if (packages.length > 0) lines.push(`  Packages: ${packages.join(", ")}`);
  }
  return lines;
}

// 이 agent가 맡은 domain의 목록이다. 이 줄은 예산으로 줄이지 않는다. 폴더 경로가 여기에만 있다.
function domainLines(domains: PlaceData["domains"]): string[] {
  if (domains.length === 0) return [];
  const lines = ["Domains"];
  for (const d of [...domains].sort((a, b) => cmp(a.name, b.name))) {
    lines.push(`- ${d.name} — ${d.title}: ${d.purpose}`);
    if (d.folder !== null) lines.push(`  Folder: ${d.folder}`);
    if (d.commands.length > 0) {
      lines.push(
        `  Commands (run as \`lophn ${d.name} <command>\`): ${commandsText(d.commands, "full")}`,
      );
    }
  }
  return lines;
}

// prompt 안의 글이라 앞쪽만 싣는다. 전체 domain을 합쳐서 센다.
const ARTIFACT_LIST_MAX = 50;

function artifactLines(domains: PlaceData["domains"]): string[] {
  const lines: string[] = [];
  let shown = 0;
  let more = 0;
  for (const d of [...domains].sort((a, b) => cmp(a.name, b.name))) {
    if (d.artifacts === null) continue;
    lines.push(`Domain ${d.name}`, `Folder: ${d.artifacts.folder}`);
    const sorted = [...d.artifacts.items].sort((a, b) => cmp(a.name, b.name));
    for (const a of sorted) {
      if (shown >= ARTIFACT_LIST_MAX) {
        more += 1;
        continue;
      }
      shown += 1;
      const description = a.description === "" ? "" : ` — ${a.description}`;
      lines.push(
        `- ${a.name}: ${a.title}${description} (artifacts/${a.name}/index.html)`,
      );
    }
  }
  if (lines.length === 0) return [];
  if (more > 0) lines.push(`${more} more`);
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

// full은 command 설명까지, short는 command 키만, bare는 domain 이름과 주인만 싣는다.
function mapLines(
  domains: readonly MapDomain[],
  level: "full" | "short" | "bare",
): string[] {
  const lines: string[] = [];
  for (const d of [...domains].sort((a, b) => cmp(a.name, b.name))) {
    lines.push(`- ${d.name} (${d.owner}): ${oneLine(d.purpose)}`);
    if (level === "bare") continue;
    if (d.tools.length > 0) {
      lines.push(
        `  Public commands (run as \`lophn ${d.name} <command>\`): ${commandsText(d.tools, level)}`,
      );
    }
    const usedBy = unique(d.usedBy.map((u) => `${u.tool} ← ${u.domain}`));
    if (usedBy.length > 0) {
      lines.push(`  Used by other apps and projects: ${usedBy.join(", ")}`);
    }
  }
  return lines;
}

// 예산 안이면 full, 넘으면 short, 그래도 넘으면 bare다.
function domainMapLines(
  domains: readonly MapDomain[],
  budget: number,
): string[] {
  if (domains.length === 0) return [];
  for (const level of ["full", "short"] as const) {
    const lines = mapLines(domains, level);
    if (lines.join("\n").length <= budget) return ["Domains", ...lines];
  }
  return ["Domains", ...mapLines(domains, "bare")];
}

export function placeInfo(
  kind: PlaceKind,
  data: PlaceData,
  budget: number,
): string {
  const lines = [
    "# Your place",
    `You are ${data.self.name}.`,
    ...placeLines(data),
  ];
  const sections: string[][] = [agentLines(data.agents)];
  if (kind === "home") {
    sections.push(listLines("Projects", data.projects));
    sections.push(appListLines(data.apps));
    sections.push(domainMapLines(data.map, budget));
  }
  sections.push(domainLines(data.domains));
  sections.push(artifactLines(data.domains));
  for (const section of sections) {
    if (section.length > 0) lines.push("", ...section);
  }
  return lines.join("\n");
}
