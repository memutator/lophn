import type { ContextText } from "../../../protocol/lophn-agent/context-text.ts";
import type { Role } from "../../../protocol/lophn-agent/places.ts";
import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";
import { type FolderRead, renderContextText } from "./context-text.ts";

// place 정보다. prompt에 넣을 잘 안 바뀌는 목록을 role별로 글로 만든다. 순수 함수이고 data는 호출하는
// 쪽이 core 읽기로 모은다. 열린 session 목록과 앱 화면의 상태는 자주 바뀌어서 넣지 않는다.
// 예산은 글자 수이고 context 글에만 건다. session을 시작할 때 값을 고정해서 넘긴다.

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

export type PlaceContext = {
  name: string;
  // 속한 project의 id
  project: string;
  // 이 agent에 붙었는가 (Operator의 정의가 고른 context)
  attached: boolean;
  purpose: string;
  // 적용된 판 번호. 예: "r3".
  version: string;
  // full 글을 쓰려면 있어야 한다. lophn은 목록만 써서 null이어도 된다.
  text: ContextText | null;
};

export type PlaceAgent = {
  role: Role;
  name: string;
  // 놓인 곳의 이름. 예: "project phroner". place가 없으면 null.
  place: string | null;
  line: string;
};

export type PlaceData = {
  self: { role: Role; name: string };
  // 이 agent가 놓인 place
  project: PlaceProject | null;
  app: (PlaceApp & { blueprint: string }) | null;
  // grant 안의 다른 agent
  agents: readonly PlaceAgent[];
  // 읽어 온 context 후보. 보여 줄 것은 `visibleContexts`가 거른다.
  contexts: readonly PlaceContext[];
  // Operator는 grant 안의 앱, lophn은 모든 앱
  apps: readonly { name: string; purpose: string }[];
  // lophn만
  projects: readonly { name: string; purpose: string }[];
  // App Engineer만. 활성 release가 없으면 null.
  release: { version: string; api_names: readonly string[] } | null;
};

const ROLE_LABEL: Record<Role, string> = {
  lophn: "lophn",
  project_manager: "Project Manager",
  app_engineer: "App Engineer",
  operator: "Operator",
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 이 role이 prompt에서 볼 수 있는 context. Operator는 같은 project에서 붙은 것만, Project Manager는
// 자기 project의 것 전부, lophn은 전부, App Engineer는 없다. 이름 순이다.
export function visibleContexts(role: Role, data: PlaceData): PlaceContext[] {
  const own = data.project?.id;
  const pick = (c: PlaceContext): boolean => {
    switch (role) {
      case "lophn":
        return true;
      case "project_manager":
        return own !== undefined && c.project === own;
      case "operator":
        return own !== undefined && c.project === own && c.attached;
      case "app_engineer":
        return false;
    }
  };
  return data.contexts.filter(pick).sort((a, b) => cmp(a.name, b.name));
}

function folderText(f: FolderRead): string {
  return `${f.path} (${f.description})`;
}

function placeLines(data: PlaceData): string[] {
  const { project, app } = data;
  if (project !== null) {
    const lines = [`Place: project ${project.name}. ${project.purpose}`];
    if (project.folders.length > 0) {
      lines.push(`  Folders: ${project.folders.map(folderText).join(", ")}`);
    }
    for (const folder of project.subfolders) {
      lines.push(`    ${folderText(folder)}`);
    }
    return lines;
  }
  if (app !== null) {
    const lines = [`Place: app ${app.name}. ${app.purpose}`];
    if (app.source !== null) lines.push(`  Source folder: ${app.source}`);
    if (data.self.role === "app_engineer") {
      lines.push(`  Blueprint: ${app.blueprint}`);
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

// 예산 안이면 full, 넘으면 names(이름과 한 줄), 그래도 넘으면 count다. lophn은 목록이라 names부터 시작한다.
function contextLines(
  role: Role,
  contexts: readonly PlaceContext[],
  budget: number,
  projectShown: boolean,
): string[] {
  if (contexts.length === 0) return [];
  const names = () => contexts.map((c) => `- ${c.name}: ${c.purpose}`);
  const count = `${contexts.length} contexts. List them with ${
    toWireToolName("context.list")
  }.`;
  const fits = (text: string) => text.length <= budget;
  const texts = contexts.map((c) => c.text);
  if (role !== "lophn" && texts.every((t) => t !== null)) {
    const full = (texts as ContextText[]).map((t) =>
      renderContextText(t, "full", { project: !projectShown })
    ).join("\n");
    if (fits(full)) return ["Contexts", full];
  }
  const list = names().join("\n");
  if (fits(list)) return ["Contexts", list];
  return ["Contexts", count];
}

export function placeInfo(role: Role, data: PlaceData, budget: number): string {
  const lines = [
    "# Your place",
    `You are ${data.self.name}, a ${ROLE_LABEL[role]}.`,
    ...placeLines(data),
  ];
  if (role === "app_engineer" && data.release !== null) {
    const apis = data.release.api_names.length > 0
      ? [...data.release.api_names].sort(cmp).join(", ")
      : "none";
    lines.push(`Active release: ${data.release.version}. app-api: ${apis}`);
  }
  const sections: string[][] = [agentLines(data.agents)];
  if (role === "lophn") {
    sections.push(listLines("Projects", data.projects));
  }
  if (role === "lophn" || role === "operator") {
    sections.push(listLines("Apps", data.apps));
  }
  sections.push(
    contextLines(
      role,
      visibleContexts(role, data),
      budget,
      data.project !== null,
    ),
  );
  for (const section of sections) {
    if (section.length > 0) lines.push("", ...section);
  }
  return lines.join("\n");
}
