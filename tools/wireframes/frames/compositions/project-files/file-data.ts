// 파일 탭과 project 키워드 검색이 같이 쓰는 고정 data. 파일은 모두 디스크 파일이고 확장자로 viewer를 고른다.

export type FileKind = "markdown" | "text" | "image" | "pdf";

const MARKDOWN = /\.(md|markdown)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const PDF = /\.pdf$/i;

/** 확장자로 viewer를 고른다. md가 아니고 이미지·pdf도 아니면 text 편집기다. */
export function fileKindOf(path: string): FileKind {
  if (MARKDOWN.test(path)) return "markdown";
  if (IMAGE.test(path)) return "image";
  if (PDF.test(path)) return "pdf";
  return "text";
}

/** project에 연결한 폴더. 하위 폴더도 따로 지정할 수 있다(`parent`는 그 하위 폴더가 속한 폴더). */
export interface FileRoot {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly parent?: string;
}

export const ROOTS: readonly FileRoot[] = [
  { id: "phroner", label: "phroner", path: "/home/mina/work/phroner" },
  {
    id: "phroner/eval",
    label: "eval",
    path: "/home/mina/work/phroner/eval",
    parent: "phroner",
  },
  { id: "notes", label: "notes", path: "/home/mina/notes/phroner" },
];

/** 첫 연결 폴더. 이 안의 파일은 상대 경로로 부르고, 다른 폴더의 파일은 절대 경로로 부른다. */
export const PROJECT_DIR = ROOTS[0].path;

const isAbsolute = (path: string) =>
  path.startsWith("/") || path.startsWith("~/");

/** 절대 경로가 들어 있는 연결 폴더(가장 깊은 것). 상대 경로는 첫 연결 폴더다. */
export function rootOf(path: string): FileRoot | undefined {
  if (!isAbsolute(path)) return ROOTS[0];
  return [...ROOTS].filter((root) => path.startsWith(`${root.path}/`)).sort((
    a,
    b,
  ) => b.path.length - a.path.length)[0];
}

/** 연결한 폴더 밖의 파일인가. */
export function isOutside(path: string): boolean {
  return isAbsolute(path) && rootOf(path) === undefined;
}

/** 첫 연결 폴더 안이면 상대 경로로, 아니면 그대로 쓴다. */
export function fileKey(path: string): string {
  const text = path.trim();
  return text.startsWith(`${PROJECT_DIR}/`)
    ? text.slice(PROJECT_DIR.length + 1)
    : text;
}

/** 위쪽 breadcrumb. 연결한 폴더 안이면 project 이름으로 시작하고, 밖이면 Outside project로 시작한다. */
export function crumbsOfPath(path: string): string[] {
  if (isOutside(path)) {
    return ["Outside project", ...path.split("/").filter(Boolean)];
  }
  if (!isAbsolute(path)) return ["phroner", ...path.split("/")];
  const root = rootOf(path)!;
  const rest = path.slice(root.path.length + 1).split("/");
  return root === ROOTS[0]
    ? ["phroner", ...rest]
    : ["phroner", root.label, ...rest];
}

/** 저장 상태는 디스크 저장과 충돌 둘뿐이다. */
export type SaveState = "saved" | "saving" | "conflict";

/** 파일 탭 하나의 시작 상태. */
export interface FileInit {
  /** 저장 상태. 없으면 저장됨이다. */
  readonly status?: SaveState;
  /** 고치지 않은 파일이 밖에서 바뀌어 다시 읽은 직후 안내를 보인다. */
  readonly reloaded?: boolean;
  /** 충돌에서 디스크 쪽과 비교하는 화면을 연다. */
  readonly compare?: boolean;
  /** 검색 결과로 열려 이 줄로 scroll한 상태. */
  readonly line?: number;
  /** 편집 모드로 시작한다(md). */
  readonly editing?: boolean;
}

/** view bar 왼쪽에 한 줄로 보이는 viewer 정보. 경로는 뺀다. */
export function metaOf(path: string): string | null {
  const kind = fileKindOf(path);
  const size = factsOf(path).size;
  if (kind === "image") return `1280 × 720 · ${size} · Fit to window`;
  if (kind === "pdf") return `Page 1 of 4 · ${size} · Fit to width`;
  if (kind === "text") {
    return (path.split(".").pop() ?? "text").toUpperCase();
  }
  return null;
}

export interface FileFacts {
  readonly size: string;
  readonly modified: string;
}

const FACTS: Record<string, FileFacts> = {
  "eval/experiments/exp-008-query-tools.md": {
    size: "3.2 KB",
    modified: "Today, 10:42",
  },
  "eval/rubrics/query-hygiene.json": { size: "612 B", modified: "Yesterday" },
  "eval/scenarios/query-leave-still/r1.yaml": {
    size: "418 B",
    modified: "Oct 12",
  },
  "assets/chest-layout.png": { size: "184 KB", modified: "Oct 9" },
  "reports/weekly-12.pdf": { size: "1.4 MB", modified: "Oct 11" },
  "LOPHN.md": { size: "1.1 KB", modified: "Oct 3" },
  "/home/mina/Downloads/api-spec.yaml": {
    size: "9.8 KB",
    modified: "Today, 09:15",
  },
};

export const factsOf = (path: string): FileFacts =>
  FACTS[path] ?? { size: "1.9 KB", modified: "2 hours ago" };

/** text 편집기에 보이는 내용. 줄 단위다. */
const TEXT: Record<string, string> = {
  "eval/rubrics/query-hygiene.json": `{
  "id": "query-hygiene",
  "version": "r2",
  "description": "No world actions on read-only tasks",
  "metrics": [
    { "name": "world_actions", "target": 0, "weight": 0.5 },
    { "name": "tool_calls", "target": 3, "weight": 0.2 },
    { "name": "answer_match", "target": 0.9, "weight": 0.3 }
  ],
  "pass": { "min_score": 0.8 }
}`,
  "eval/scenarios/query-leave-still/r1.yaml": `id: query-leave-still
version: r1
tags: [query, read-only]
stages:
  - ask: "What is in the chest by the door?"
  - answer: read-only, no world actions
  - score:
      rubric: query-hygiene
      expect: world_actions == 0
timeout_s: 120
`,
  "/home/mina/Downloads/api-spec.yaml": `openapi: 3.0.3
info:
  title: Chest service
  version: 1.4.0
paths:
  /chests/{name}:
    get:
      summary: Read a chest by name
      parameters:
        - name: name
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: The chest contents
`,
};

export function textOf(path: string): readonly string[] {
  const scenario = /^eval\/scenarios\/([^/]+)\/r1\.yaml$/.exec(path);
  const text = TEXT[path] ??
    (scenario
      ? TEXT["eval/scenarios/query-leave-still/r1.yaml"].replace(
        "query-leave-still",
        scenario[1],
      )
      : "key: value\n");
  return text.replace(/\n$/, "").split("\n");
}

/** 검색 말뭉치. project 안 파일의 줄이고 경로 순·줄 순으로 늘어서 있다. */
export interface CorpusLine {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

const CORPUS: readonly CorpusLine[] = [
  {
    path: "eval/experiments/exp-008-query-tools.md",
    line: 16,
    text: "Success: world_actions stays at 0 on every read-only scenario.",
  },
  {
    path: "eval/experiments/exp-008-query-tools.md",
    line: 24,
    text: "F-009 moved world_actions from 3 to 0 on query-leave-still.",
  },
  {
    path: "eval/rubrics/query-hygiene.json",
    line: 6,
    text: '{ "name": "world_actions", "target": 0, "weight": 0.5 },',
  },
  {
    path: "eval/rubrics/query-hygiene.json",
    line: 7,
    text: '{ "name": "tool_calls", "target": 3, "weight": 0.2 },',
  },
  {
    path: "eval/scenarios/query-leave-still/r1.yaml",
    line: 9,
    text: "expect: world_actions == 0",
  },
  {
    path: "loop/findings/F-004.md",
    line: 12,
    text: "On inv-read the change moved world_actions 2 → 0.",
  },
  {
    path: "loop/findings/F-009.md",
    line: 12,
    text: "On query-leave-still the change moved world_actions 3 → 0.",
  },
  {
    path: "loop/findings/F-010.md",
    line: 12,
    text: "On query-chest-name the change moved tool_calls 5 → 2.",
  },
];

export const SEARCH_FOLDERS: readonly string[] = [
  "All folders",
  "eval",
  "eval/experiments",
  "loop/findings",
];

/** 검색: 폴더 하나로 좁히고, 경로 순·줄 순으로 늘어놓는다. */
export function searchFiles(query: string, folder: string): CorpusLine[] {
  const words = query.trim().toLowerCase();
  if (words === "") return [];
  return CORPUS.filter((item) =>
    item.text.toLowerCase().includes(words) &&
    (folder === "All folders" || item.path.startsWith(`${folder}/`))
  ).sort((a, b) =>
    a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1
  );
}
