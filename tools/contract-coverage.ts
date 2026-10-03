// docs/architecture/*.md의 "## 5." 절에서 route 경로와 event 이름을 읽어
// ALL_ROUTES·ALL_EVENTS에 있는 것·없는 것을 최상위·절마다 보인다.
// 보고만 하고 exit 0이다. 빠짐을 실패로 세는 관문은 contracts#T46.

import { ALL_EVENTS, ALL_ROUTES } from "@lophn/contracts";

const ROOT = new URL("..", import.meta.url);
const ARCHITECTURE = new URL("docs/architecture/", ROOT);

// 표 셀의 짧은 표기(`/update`)는 그 행의 resource로 펼친다.
const FULL_PATH = /\/v1\/([a-z0-9_-]+)\/([a-z0-9_-]+)/g;
const SHORT_PATH = /(?<![\w/])\/([a-z0-9_-]+)/g;
// WebSocket handshake 경로. HTTP RPC route가 아니라 구독 transport다.
const EXCLUDED_PATHS = new Set(["/v1/events/subscribe"]);

const EVENT_TYPE = /^[A-Z][A-Za-z0-9]*$/;
// 경로 표기의 POST·GET은 event 이름이 아니다.
const NOT_EVENT_TYPE = new Set(["POST", "GET"]);
// 이름 목록을 담은 문장만. "event가 있다" 같은 설명 문장은 이름이 없다.
const EVENT_LIST_MARKER =
  /event 이름|event 목록|내놓는 event|event는 `|^event는 /;

export type SectionRoutes = {
  heading: string;
  paths: string[];
};

export type SectionEvents = {
  heading: string;
  types: string[];
};

export type ArchitectureCoverage = {
  topLevel: string;
  routes: SectionRoutes[];
  events: SectionEvents[];
};

// "## 5."부터 "## 6." 직전까지. 5장이 없으면 빈 문자열.
export function sectionFive(markdown: string): string {
  const start = markdown.search(/^## 5\..*$/m);
  if (start < 0) return "";
  const rest = markdown.slice(start);
  const next = rest.search(/^## 6\..*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

function headingOf(lines: string[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const match = lines[i].match(/^###\s+(.*)$/);
    if (match) return match[1];
  }
  return "(5장)";
}

// 한 표 행에서 경로를 읽는다. 셀 안의 `/v1/<resource>/<method>`가 정본이고,
// 그 셀의 `/update` 같은 짧은 표기는 그 셀에서 먼저 나온 resource로 펼친다.
// 다른 셀의 설명(`/base_hash` 같은 필드 이름)은 경로가 아니라서 읽지 않는다.
function pathsInCell(cell: string): string[] {
  const paths: string[] = [];
  let resource: string | undefined;
  for (const match of cell.matchAll(FULL_PATH)) {
    resource = match[1];
    const path = `/v1/${match[1]}/${match[2]}`;
    if (!EXCLUDED_PATHS.has(path)) paths.push(path);
  }
  if (resource !== undefined) {
    const withoutFull = cell.replaceAll(FULL_PATH, " ");
    for (const match of withoutFull.matchAll(SHORT_PATH)) {
      paths.push(`/v1/${resource}/${match[1]}`);
    }
  }
  return paths;
}

function pathsInRow(line: string): string[] {
  return line.split("|").flatMap(pathsInCell);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// 5장을 "### 5.x" 절로 나누고 절마다 표의 경로를 모은다.
export function routesBySection(markdown: string): SectionRoutes[] {
  const section = sectionFive(markdown);
  if (section === "") return [];
  const lines = section.split("\n");
  const grouped = new Map<string, string[]>();
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("|")) continue;
    const paths = pathsInRow(line);
    if (paths.length === 0) continue;
    const heading = headingOf(lines, index);
    grouped.set(heading, [...(grouped.get(heading) ?? []), ...paths]);
  }
  return [...grouped].map(([heading, paths]) => ({
    heading,
    paths: unique(paths),
  }));
}

// 셀 구분자가 없는 backtick 목록만 event 이름으로 본다.
// `| ... |` 표 셀의 PascalCase(`RecordReport`, `AdvanceSubscriberCursor`)는
// command·read 이름이라 제외한다.
function typesOf(segment: string): string[] {
  return segment.split(/[·,/\s]+/).filter((token) =>
    EVENT_TYPE.test(token) && !NOT_EVENT_TYPE.has(token)
  );
}

// 목록은 backtick으로 감싸거나 `·`로 잇는다. 이름 아닌 단어가 나오면 거기서 끊는다.
function eventTypesIn(text: string): string[] {
  const types: string[] = [];
  let listing = false;
  for (const segment of text.split("`")) {
    if (!listing) {
      listing = true;
      continue;
    }
    listing = false;
    if (segment.includes("|")) return types;
    const found = typesOf(segment);
    if (found.length === 0) return types;
    types.push(...found);
  }
  return types;
}

// "event 이름은", "event 목록", "내놓는 event는", "event는 `…`" 문장과
// 헤더 셀이 `event`인 표에서 backtick PascalCase 이름을 읽는다.
// 목록 문장 끝의 다른 설명(`OAuth`·`JSON Schema`)은 이름이 아니라서,
// 이름이 끊기는 첫 backtick 조각까지만 읽는다.
export function eventsBySection(markdown: string): SectionEvents[] {
  const section = sectionFive(markdown);
  if (section === "") return [];
  const lines = section.split("\n");
  const grouped = new Map<string, string[]>();
  const add = (index: number, types: string[]) => {
    if (types.length === 0) return;
    const heading = headingOf(lines, index);
    grouped.set(heading, [...(grouped.get(heading) ?? []), ...types]);
  };

  // 헤더 칸이 `event`인 표는 그 칸만 event 이름이다. -1이면 event 표가 아니다.
  let eventColumn = -1;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (/^[\s|:-]+$/.test(line)) continue;
      const header = cells.indexOf("event");
      if (header >= 0) {
        eventColumn = header;
        continue;
      }
      if (eventColumn < 0) continue;
      add(index, eventTypesIn(cells[eventColumn] ?? ""));
      continue;
    }
    eventColumn = -1;
    if (EVENT_LIST_MARKER.test(line)) {
      // "event 이름은 다음과 같다" 다음의 bullet 목록은 같은 목록이다.
      const block = [line];
      let next = index + 1;
      while (next < lines.length && /^\s*$/.test(lines[next])) next++;
      if (lines[next]?.startsWith("- ")) {
        while (next < lines.length && lines[next].startsWith("- ")) {
          block.push(lines[next]);
          next++;
        }
      }
      add(index, eventTypesIn(block.join(" ")));
    }
  }
  return [...grouped].map(([heading, types]) => ({
    heading,
    types: unique(types),
  }));
}

export async function readArchitecture(): Promise<ArchitectureCoverage[]> {
  const found: ArchitectureCoverage[] = [];
  for await (const entry of Deno.readDir(ARCHITECTURE)) {
    if (!entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const markdown = await Deno.readTextFile(new URL(entry.name, ARCHITECTURE));
    found.push({
      topLevel: entry.name.slice(0, -".md".length),
      routes: routesBySection(markdown),
      events: eventsBySection(markdown),
    });
  }
  return found.sort((a, b) => a.topLevel.localeCompare(b.topLevel));
}

export type Presence = "있음" | "없음";

export function routePresence(
  path: string,
  routes: readonly { resource: string; method: string }[] = ALL_ROUTES,
): Presence {
  const found = routes.some((route) =>
    `/v1/${route.resource}/${route.method}` === path
  );
  return found ? "있음" : "없음";
}

export function eventPresence(
  type: string,
  events: readonly { type: string }[] = ALL_EVENTS,
): Presence {
  return events.some((event) => event.type === type) ? "있음" : "없음";
}

export function renderCoverage(
  docs: ArchitectureCoverage[],
  routes: readonly { resource: string; method: string }[] = ALL_ROUTES,
  events: readonly { type: string }[] = ALL_EVENTS,
): string {
  const lines: string[] = [];
  for (const doc of docs) {
    const routeCount = doc.routes.reduce(
      (sum, section) => sum + section.paths.length,
      0,
    );
    const eventCount = doc.events.reduce(
      (sum, section) => sum + section.types.length,
      0,
    );
    const presentRoutes = doc.routes
      .flatMap((section) => section.paths)
      .filter((path) => routePresence(path, routes) === "있음").length;
    const presentEvents = doc.events
      .flatMap((section) => section.types)
      .filter((type) => eventPresence(type, events) === "있음").length;
    lines.push(
      `${doc.topLevel}: route ${presentRoutes}/${routeCount} 있음, event ${presentEvents}/${eventCount} 있음`,
    );
    for (const section of doc.routes) {
      for (const path of section.paths) {
        lines.push(
          `  [${section.heading}] ${path} ${routePresence(path, routes)}`,
        );
      }
    }
    for (const section of doc.events) {
      for (const type of section.types) {
        lines.push(
          `  [${section.heading}] event ${type} ${eventPresence(type, events)}`,
        );
      }
    }
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const docs = await readArchitecture();
  console.log(renderCoverage(docs));
}
