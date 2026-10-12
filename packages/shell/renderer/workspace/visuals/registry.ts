// 세션 시각 블록의 허용 registry와 그리기 전 검사(shell/workspace#R12). 블록은 lophn-agent/visuals의
// owner 검사를 지나 저장된 값이지만, renderer는 받은 값을 믿지 않고 그릴 수 있는 모양인지 다시 본다.
// contracts를 import하면 zod와 core 쪽 graph가 renderer bundle에 들어오므로(editor/core-source.ts와
// 같은 이유) VisualBlock contract(contracts#T30)의 모양·상한과 owner 검사의 markup·URL 규칙
// (lophn-agent Q45 (1))을 여기에 옮겨 적는다. registry_test가 contract fixture와 맞춰 본다.
//
// 그릴 수 있는 것은 아래 registry의 종류뿐이다. agent의 JS·HTML·CSS·URL은 import·eval·innerHTML로
// 실행하지 않는다: 통과한 값은 문자열·숫자로만 SDK의 선언형 props에 넘어가고 React가 text node로
// escape한다. 통과하지 못한 블록은 이유와, 따로 검사해 안전한 설명·출처만 남긴다.

/** 블록 key 모양. contract의 visualKeySchema와 같다. */
const KEY = /^[a-z0-9_-]{1,64}$/;
/** 기록 시각 모양. contract의 atSchema와 같다. */
const AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";

function idOf(prefix: string): RegExp {
  return new RegExp(`^${prefix}_${ULID}$`);
}

const DOCUMENT_ID = idOf("doc");
const VERSION_ID = idOf("ver");
const APP_ID = idOf("app");
const RELEASE_ID = idOf("rel");
const TOOL_CALL_ID = idOf("tcl");

/** contract(contracts#T30)와 owner(lophn-agent/visuals)의 상한. */
export const VISUAL_LIMITS = {
  title: 200,
  description: 2000,
  tableRows: 1000,
  tableColumns: 20,
  chartSeries: 8,
  chartPoints: 1000,
  diagramNodes: 100,
  diagramEdges: 200,
} as const;

// owner 검사의 markup·URL 규칙(lophn-agent/visuals/model.ts의 UNSAFE)과 같다. 저장 뒤 규칙이 바뀌어
// 지금 검사를 지나지 못하는 블록은 그리지 않고 이용 불가로 둔다. 일반 문장은 막지 않는다.
const UNSAFE: readonly RegExp[] = [
  /<\/?[a-z!?][^>]*>/i,
  /\b(?:javascript|vbscript)\s*:/i,
  /\bdata:\s*[a-z]+\/[a-z0-9.+-]+/i,
  /\b[a-z][a-z0-9+.-]*:\/\//i,
  /\bwww\.[a-z0-9-]+\./i,
  /@import\b|\burl\s*\(|\bexpression\s*\(/i,
];

export function unsafeText(text: string): boolean {
  return UNSAFE.some((pattern) => pattern.test(text));
}

/** 블록을 그리는 SDK 갈래. 이 목록 밖의 종류는 그리지 않는다. 앱 카드는 shell#T44가 맡는다. */
export const VISUAL_REGISTRY = Object.freeze(
  {
    table: "DataTable",
    chart: "BarChart·LineChart·ScatterChart",
    diagram: "GraphDiagram",
  } as const,
);

export type DrawnKind = keyof typeof VISUAL_REGISTRY;

export type Cell = string | number | boolean | null;

export interface TableColumnSpec {
  readonly key: string;
  readonly label: string;
  readonly type: "string" | "number" | "boolean";
  readonly unit: string | null;
}

export interface TableContent {
  readonly kind: "table";
  readonly columns: readonly TableColumnSpec[];
  readonly rows: readonly Readonly<Record<string, Cell>>[];
}

export interface ChartPoint {
  readonly x: string | number;
  readonly y: number | null;
}

export interface ChartContent {
  readonly kind: "chart";
  readonly type: "bar" | "line" | "scatter";
  readonly x: {
    readonly label: string;
    readonly type: "category" | "number" | "time";
    readonly unit: string | null;
  };
  readonly y: { readonly label: string; readonly unit: string | null };
  readonly series: readonly {
    readonly key: string;
    readonly label: string;
    readonly points: readonly ChartPoint[];
  }[];
}

export interface DiagramContent {
  readonly kind: "diagram";
  readonly nodes: readonly {
    readonly key: string;
    readonly label: string;
    readonly description: string | null;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly label: string | null;
  }[];
}

/**
 * 앱 카드 참조. 카드 입력(input)은 그리지 않고 앱 view 계약에 넘길 값으로 그대로 옮긴다
 * (lophn-agent/visuals AppCardReference). owner가 view 계약·redaction을 검사했다.
 */
export interface AppCardContent {
  readonly kind: "app_card";
  readonly app: string;
  readonly release: string;
  readonly view: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type VisualContent =
  | TableContent
  | ChartContent
  | DiagramContent
  | AppCardContent;

export type VisualSource =
  | {
    readonly kind: "document";
    readonly document: string;
    readonly version: string;
    readonly section: string | null;
    readonly observedAt: string | null;
  }
  | {
    readonly kind: "app_command";
    readonly app: string;
    readonly command: string;
    readonly observedAt: string;
  }
  | {
    readonly kind: "estimate";
    readonly label: string;
    readonly observedAt: string | null;
  };

/**
 * 그리지 못한 이유. 받은 값을 되풀이하지 않는다.
 * shape: 모양·상한이 contract와 맞지 않는다. kind: registry에 없는 종류다.
 * markup: HTML·script·CSS·URL이 들어 있다. drawing: SDK가 이 값으로 그릴 수 없다.
 */
export type Unavailable = "shape" | "kind" | "markup" | "drawing";

export type CheckedVisual =
  | {
    readonly ok: true;
    readonly key: string;
    readonly title: string;
    readonly description: string;
    readonly sources: readonly VisualSource[];
    readonly content: VisualContent;
  }
  | {
    readonly ok: false;
    readonly key: string | null;
    /** 따로 검사해 안전한 제목·설명·출처만 남긴다. 아니면 null·빈 목록이다. */
    readonly title: string | null;
    readonly description: string | null;
    readonly sources: readonly VisualSource[];
    readonly reason: Unavailable;
  };

type Plain = Record<string, unknown>;

class Reject extends Error {
  constructor(readonly reason: Unavailable) {
    super(reason);
  }
}

function fail(reason: Unavailable = "shape"): never {
  throw new Reject(reason);
}

function plain(value: unknown): value is Plain {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// own data property만 본다. getter·상속 값은 받지 않는다.
function fields(value: unknown, allowed: readonly string[]): Plain {
  if (!plain(value)) fail();
  for (
    const [name, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )
  ) {
    if (!Object.hasOwn(descriptor, "value") || !allowed.includes(name)) fail();
  }
  return value;
}

function list(value: unknown, max: number, min = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail();
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail();
  }
  return value;
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail();
  if (unsafeText(value)) fail("markup");
  return value;
}

function bounded(value: unknown, max: number): string {
  const found = text(value);
  if (codePoints(found) > max) fail();
  return found;
}

function optionalText(value: unknown): string | null {
  return value === undefined ? null : text(value);
}

function matching(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) fail();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail();
  return value as T;
}

function distinct(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail();
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function source(raw: unknown): VisualSource {
  const value = fields(raw, ["kind", "reference", "observed_at"]);
  const observed = value["observed_at"];
  const observedAt = observed === null ? null : matching(observed, AT);
  switch (value["kind"]) {
    case "document": {
      const reference = fields(value["reference"], [
        "document",
        "version",
        "section",
      ]);
      return {
        kind: "document",
        document: matching(reference["document"], DOCUMENT_ID),
        version: matching(reference["version"], VERSION_ID),
        section: optionalText(reference["section"]),
        observedAt,
      };
    }
    case "app_command": {
      const reference = fields(value["reference"], [
        "app",
        "release",
        "command",
        "tool_call",
      ]);
      matching(reference["release"], RELEASE_ID);
      matching(reference["tool_call"], TOOL_CALL_ID);
      if (observedAt === null) fail();
      return {
        kind: "app_command",
        app: matching(reference["app"], APP_ID),
        command: text(reference["command"]),
        observedAt,
      };
    }
    case "estimate": {
      const reference = fields(value["reference"], ["label"]);
      return { kind: "estimate", label: text(reference["label"]), observedAt };
    }
    default:
      return fail();
  }
}

function table(raw: unknown): TableContent {
  const value = fields(raw, ["columns", "rows"]);
  const columns = list(
    value["columns"],
    VISUAL_LIMITS.tableColumns,
    1,
  ).map((item): TableColumnSpec => {
    const column = fields(item, ["key", "label", "type", "unit"]);
    if (typeof column["key"] !== "string") fail();
    if (unsafeText(column["key"])) fail("markup");
    return {
      key: column["key"],
      label: text(column["label"]),
      type: oneOf(column["type"], ["string", "number", "boolean"] as const),
      unit: optionalText(column["unit"]),
    };
  });
  distinct(columns.map((column) => column.key));
  const types = new Map(columns.map((column) => [column.key, column.type]));
  const rows = list(value["rows"], VISUAL_LIMITS.tableRows).map((item) => {
    const row = fields(item, [...types.keys()]);
    const cells: Record<string, Cell> = Object.create(null);
    for (const [key, cell] of Object.entries(row)) {
      const type = types.get(key);
      if (cell === null) {
        cells[key] = null;
      } else if (type === "string") {
        if (typeof cell !== "string") fail();
        if (unsafeText(cell)) fail("markup");
        cells[key] = cell;
      } else if (type === "number") {
        if (!finite(cell)) fail();
        cells[key] = cell;
      } else {
        if (typeof cell !== "boolean") fail();
        cells[key] = cell;
      }
    }
    return cells;
  });
  return { kind: "table", columns, rows };
}

function chart(raw: unknown): ChartContent {
  const value = fields(raw, ["type", "x", "y", "series"]);
  const type = oneOf(value["type"], ["bar", "line", "scatter"] as const);
  const xRaw = fields(value["x"], ["label", "type", "unit"]);
  const x = {
    label: text(xRaw["label"]),
    type: oneOf(xRaw["type"], ["category", "number", "time"] as const),
    unit: optionalText(xRaw["unit"]),
  };
  const yRaw = fields(value["y"], ["label", "unit"]);
  const y = { label: text(yRaw["label"]), unit: optionalText(yRaw["unit"]) };
  if (type === "scatter" && x.type === "category") fail();
  let total = 0;
  const series = list(value["series"], VISUAL_LIMITS.chartSeries).map(
    (item) => {
      const entry = fields(item, ["key", "label", "points"]);
      if (typeof entry["key"] !== "string") fail();
      if (unsafeText(entry["key"])) fail("markup");
      const points = list(entry["points"], VISUAL_LIMITS.chartPoints).map(
        (raw): ChartPoint => {
          const point = fields(raw, ["x", "y"]);
          const at = point["x"];
          const valid = x.type === "number"
            ? finite(at)
            : x.type === "time"
            ? typeof at === "string" && AT.test(at)
            : typeof at === "string";
          if (!valid) fail();
          if (typeof at === "string" && unsafeText(at)) fail("markup");
          const value = point["y"];
          if (value !== null && !finite(value)) fail();
          return { x: at as string | number, y: value as number | null };
        },
      );
      total += points.length;
      return { key: entry["key"], label: text(entry["label"]), points };
    },
  );
  if (total > VISUAL_LIMITS.chartPoints) fail();
  distinct(series.map((item) => item.key));
  return { kind: "chart", type, x, y, series };
}

function diagram(raw: unknown): DiagramContent {
  const value = fields(raw, ["nodes", "edges"]);
  const nodes = list(value["nodes"], VISUAL_LIMITS.diagramNodes).map(
    (item) => {
      const node = fields(item, ["key", "label", "description"]);
      if (typeof node["key"] !== "string") fail();
      if (unsafeText(node["key"])) fail("markup");
      return {
        key: node["key"],
        label: bounded(node["label"], VISUAL_LIMITS.title),
        description: optionalText(node["description"]),
      };
    },
  );
  distinct(nodes.map((node) => node.key));
  const known = new Set(nodes.map((node) => node.key));
  const edges = list(value["edges"], VISUAL_LIMITS.diagramEdges).map(
    (item) => {
      const edge = fields(item, ["from", "to", "label"]);
      const from = edge["from"];
      const to = edge["to"];
      if (
        typeof from !== "string" || typeof to !== "string" ||
        !known.has(from) || !known.has(to)
      ) fail();
      // contract는 받지만 SDK 도표는 자기 자신을 가리키는 edge를 그리지 않는다.
      if (from === to) fail("drawing");
      return { from, to, label: optionalText(edge["label"]) };
    },
  );
  return { kind: "diagram", nodes, edges };
}

function appCard(raw: unknown): AppCardContent {
  const value = fields(raw, ["app", "release", "view", "input"]);
  // 카드 입력은 view 계약의 JSON object다. owner가 검사했고 이 화면은 그리지 않고 옮긴다.
  const input = value["input"];
  if (!plain(input)) fail();
  return {
    kind: "app_card",
    app: matching(value["app"], APP_ID),
    release: matching(value["release"], RELEASE_ID),
    view: text(value["view"]),
    input,
  };
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof Reject) return null;
    throw error;
  }
}

function sourcesOf(raw: unknown): readonly VisualSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const found = attempt(() => source(item));
    return found === null ? [] : [found];
  });
}

/**
 * 받은 블록 하나를 그리기 전에 검사한다. 통과하면 registry의 SDK 갈래로 그릴 값이고, 아니면
 * 이유와 따로 안전한 제목·설명·출처만 돌려준다. 실패한 블록이 다른 블록을 막지 않는다.
 */
export function checkVisual(raw: unknown): CheckedVisual {
  const block = plain(raw) ? raw : {};
  const key = typeof block["key"] === "string" && KEY.test(block["key"])
    ? block["key"]
    : null;
  const title = attempt(() => bounded(block["title"], VISUAL_LIMITS.title));
  const description = attempt(() =>
    bounded(block["description"], VISUAL_LIMITS.description)
  );
  const unavailable = (reason: Unavailable): CheckedVisual => ({
    ok: false,
    key,
    title,
    description,
    sources: sourcesOf(block["sources"]),
    reason,
  });
  try {
    const value = fields(raw, [
      "key",
      "schema_version",
      "kind",
      "title",
      "description",
      "sources",
      "payload",
    ]);
    if (key === null || value["schema_version"] !== 1) fail();
    if (title === null || description === null) {
      // 제목·설명의 markup은 markup으로, 나머지는 모양으로 알린다.
      bounded(value["title"], VISUAL_LIMITS.title);
      bounded(value["description"], VISUAL_LIMITS.description);
      fail();
    }
    const sources = list(value["sources"], Number.MAX_SAFE_INTEGER).map(
      source,
    );
    const kind = value["kind"];
    const payload = value["payload"];
    let content: VisualContent;
    if (kind === "app_card") content = appCard(payload);
    else if (
      typeof kind !== "string" || !Object.hasOwn(VISUAL_REGISTRY, kind)
    ) {
      return unavailable("kind");
    } else if (kind === "table") content = table(payload);
    else if (kind === "chart") content = chart(payload);
    else content = diagram(payload);
    return { ok: true, key, title, description, sources, content };
  } catch (error) {
    if (error instanceof Reject) return unavailable(error.reason);
    throw error;
  }
}

/** 출처 중 가장 늦은 관측 시각. 없으면 null이다. */
export function observedAt(
  sources: readonly VisualSource[],
): string | null {
  let latest: string | null = null;
  for (const item of sources) {
    if (
      item.observedAt !== null && (latest === null || item.observedAt > latest)
    ) {
      latest = item.observedAt;
    }
  }
  return latest;
}
