import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import {
  agentMessageContentInputSchema,
  MESSAGE_CONTENT_MAX_BYTES,
  MESSAGE_VISUAL_MAX_BYTES,
  MESSAGE_VISUAL_MAX_COUNT,
  visualBlockInputSchema,
} from "../../../../protocol/lophn-agent/mod.ts";

// 시각 블록의 owner 검사. contract schema는 모양과 상한을 한꺼번에
// 검사해 어느 상한을 넘었는지 말하지 못하고, 임의 문자열에 lexical 검사를 하지 않는다(그 일은 owner
// 몫이다). 이 모듈은 검사 순서를 고정하고(parse → 블록 수 → 종류별 상한 → 모양 → 키 → markup·URL →
// 마지막에 bytes 합계) 어느 블록·어느 상한인지 값 없이 알려 준다. 어느 단계에서 실패해도 아무것도
// 저장하지 않고 일부를 자르지 않는다.

const VISUAL_LIMITS = {
  blocks: MESSAGE_VISUAL_MAX_COUNT,
  bytes: MESSAGE_VISUAL_MAX_BYTES,
  tableRows: 1000,
  tableColumns: 20,
  chartSeries: 8,
  chartPoints: 1000,
  diagramNodes: 100,
  diagramEdges: 200,
} as const;

type VisualStage =
  | "parse"
  | "count"
  | "limit"
  | "block"
  | "key"
  | "markup"
  | "bytes"
  | "content"
  // 출처가 이 run에서 읽거나 실행한 결과가 아니다. 검사는 tool이 소유 contract 읽기로 한다.
  | "source";

type VisualRejection = {
  code: "invalid_input";
  stage: VisualStage;
  // 블록의 key. 형식에 맞지 않으면 순서(`#2`)다. 받은 값을 그대로 싣지 않는다.
  block: string | null;
  message: string;
};

function reject(
  stage: VisualStage,
  block: string | null,
  message: string,
): Result<never, VisualRejection> {
  return err({ code: "invalid_input", stage, block, message });
}

const encoder = new TextEncoder();
const KEY = /^[a-z0-9_-]{1,64}$/;

// 오류 경로에 싣는 이름은 정해진 field 이름과 순서뿐이다. 행의 열 key 같은 받은 값은 `…`로 바꾼다.
const FIELDS: ReadonlySet<string> = new Set([
  "key",
  "schema_version",
  "kind",
  "title",
  "description",
  "sources",
  "payload",
  "columns",
  "rows",
  "label",
  "type",
  "unit",
  "x",
  "y",
  "series",
  "points",
  "nodes",
  "edges",
  "from",
  "to",
  "app",
  "release",
  "view",
  "input",
  "reference",
  "observed_at",
  "command",
  "tool_call",
  "parts",
  "block",
  "text",
]);

function pathOf(path: readonly PropertyKey[]): string {
  return path.map((segment) =>
    typeof segment === "number"
      ? String(segment)
      : FIELDS.has(String(segment))
      ? String(segment)
      : "…"
  ).join(".");
}

type Plain = Record<string, unknown>;

function plain(value: unknown): value is Plain {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function labelOf(raw: unknown, index: number): string {
  const key = plain(raw) ? raw["key"] : undefined;
  return typeof key === "string" && KEY.test(key) ? key : `#${index}`;
}

function length(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

type Bound = { name: string; actual: number | null; max: number };

// 모양이 아직 확인되지 않은 payload에서 센 값이다. 배열이 아니면 세지 않고 모양 검사가 거절한다.
function bounds(raw: Plain): Bound[] {
  const payload = plain(raw["payload"]) ? raw["payload"] : {};
  if (raw["kind"] === "table") {
    return [
      {
        name: "table rows",
        actual: length(payload["rows"]),
        max: VISUAL_LIMITS.tableRows,
      },
      {
        name: "table columns",
        actual: length(payload["columns"]),
        max: VISUAL_LIMITS.tableColumns,
      },
    ];
  }
  if (raw["kind"] === "chart") {
    const series = Array.isArray(payload["series"]) ? payload["series"] : null;
    const points = series === null ? null : series.reduce<number>(
      (sum, item) => sum + (plain(item) ? (length(item["points"]) ?? 0) : 0),
      0,
    );
    return [
      {
        name: "chart series",
        actual: series === null ? null : series.length,
        max: VISUAL_LIMITS.chartSeries,
      },
      { name: "chart points", actual: points, max: VISUAL_LIMITS.chartPoints },
    ];
  }
  if (raw["kind"] === "diagram") {
    return [
      {
        name: "diagram nodes",
        actual: length(payload["nodes"]),
        max: VISUAL_LIMITS.diagramNodes,
      },
      {
        name: "diagram edges",
        actual: length(payload["edges"]),
        max: VISUAL_LIMITS.diagramEdges,
      },
    ];
  }
  return [];
}

// HTML·script·CSS·URL은 선언형 블록에 들어올 자리가 없다. renderer는 문자열을 text node로만 그리므로
// 이 검사는 실행 통로를 막는 두 번째 줄이다. 일반 문장을 막지 않도록 tag 모양, 실행 scheme, URL,
// CSS 함수만 본다.
const UNSAFE: readonly RegExp[] = [
  /<\/?[a-z!?][^>]*>/i,
  /\b(?:javascript|vbscript)\s*:/i,
  /\bdata:\s*[a-z]+\/[a-z0-9.+-]+/i,
  /\b[a-z][a-z0-9+.-]*:\/\//i,
  /\bwww\.[a-z0-9-]+\./i,
  /@import\b|\burl\s*\(|\bexpression\s*\(/i,
];

function unsafeText(text: string): boolean {
  return UNSAFE.some((pattern) => pattern.test(text));
}

// 문자열 값과 객체 key 어디에 있어도 첫 위치를 돌려준다.
function findUnsafe(
  value: unknown,
  path: readonly PropertyKey[],
): readonly PropertyKey[] | null {
  if (typeof value === "string") return unsafeText(value) ? path : null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findUnsafe(value[index], [...path, index]);
      if (found !== null) return found;
    }
    return null;
  }
  if (plain(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (unsafeText(key)) return [...path, key];
      const found = findUnsafe(item, [...path, key]);
      if (found !== null) return found;
    }
  }
  return null;
}

function canonicalBytes(value: unknown): number | null {
  try {
    return encoder.encode(canonicalize(value)).length;
  } catch {
    return null;
  }
}

type CheckedContent = ReturnType<
  typeof agentMessageContentInputSchema.parse
>;

// agent가 남기려는 답(글과 시각 블록)을 저장 전에 검사한다. 통과한 값은 그대로 RecordMessage의
// content가 된다. 실패는 메시지 전체 거절이고 통과한 블록도 저장하지 않는다.
export function checkVisualContent(
  value: unknown,
): Result<CheckedContent, VisualRejection> {
  // 1. parse: JSON 값이고 {schema_version, parts[]} 모양이다.
  if (
    !plain(value) || value["schema_version"] !== 1 ||
    !Array.isArray(value["parts"]) || value["parts"].length === 0
  ) {
    return reject("parse", null, "content is not a message content");
  }
  const parts: unknown[] = value["parts"];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (
      !plain(part) || (part["kind"] !== "text" && part["kind"] !== "visual")
    ) {
      return reject("parse", null, `part ${index} is neither text nor visual`);
    }
  }
  const blocks: { raw: unknown; index: number }[] = [];
  parts.forEach((part) => {
    if (plain(part) && part["kind"] === "visual") {
      blocks.push({ raw: part["block"], index: blocks.length });
    }
  });
  // 2. 블록 수. 9개째부터는 아무것도 보지 않고 거절한다.
  if (blocks.length > VISUAL_LIMITS.blocks) {
    return reject(
      "count",
      null,
      `${blocks.length} blocks exceed the limit ${VISUAL_LIMITS.blocks}; send fewer blocks`,
    );
  }
  // 3. 종류별 상한. 모양 검사보다 먼저 보아 어느 상한인지 말한다.
  for (const { raw, index } of blocks) {
    if (!plain(raw)) {
      return reject("block", `#${index}`, "block is not an object");
    }
    for (const bound of bounds(raw)) {
      if (bound.actual !== null && bound.actual > bound.max) {
        return reject(
          "limit",
          labelOf(raw, index),
          `${bound.name} ${bound.actual} exceed the limit ${bound.max}; send a smaller block, it is not cut`,
        );
      }
    }
  }
  // 4. 블록 모양. 모르는 field·kind와 값의 형식은 schema가 정한다.
  for (const { raw, index } of blocks) {
    const parsed = visualBlockInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reject(
        "block",
        labelOf(raw, index),
        `block is not a valid visual at ${
          issue === undefined ? "block" : pathOf(issue.path) || "block"
        }`,
      );
    }
  }
  // 5. 블록 key는 메시지 안에서 겹치지 않는다.
  const seen = new Set<string>();
  for (const { raw, index } of blocks) {
    const key = (raw as Plain)["key"] as string;
    if (seen.has(key)) {
      return reject("key", labelOf(raw, index), "block key is used twice");
    }
    seen.add(key);
  }
  // 6. markup·script·URL.
  for (const { raw, index } of blocks) {
    const found = findUnsafe(raw, []);
    if (found !== null) {
      return reject(
        "markup",
        labelOf(raw, index),
        `block holds markup, script, style or a URL at ${
          pathOf(found) || "block"
        }; send plain text and data only`,
      );
    }
  }
  // 7. bytes 합계는 마지막이다. 앞 단계에서 자른 값으로 재지 않는다.
  let total = 0;
  for (const { raw } of blocks) {
    const size = canonicalBytes(raw);
    if (size === null) return reject("parse", null, "block is not JSON");
    total += size;
  }
  if (total > VISUAL_LIMITS.bytes) {
    return reject(
      "bytes",
      null,
      `blocks total ${total} bytes and exceed the limit ${VISUAL_LIMITS.bytes}; send smaller blocks`,
    );
  }
  const content = agentMessageContentInputSchema.safeParse(value);
  if (!content.success) {
    const issue = content.error.issues[0];
    return reject(
      "content",
      null,
      `content is not valid at ${
        issue === undefined ? "content" : pathOf(issue.path) || "content"
      }`,
    );
  }
  const whole = canonicalBytes(content.data);
  if (whole === null || whole > MESSAGE_CONTENT_MAX_BYTES) {
    return reject(
      "content",
      null,
      `message is larger than ${MESSAGE_CONTENT_MAX_BYTES} bytes; send less text or smaller blocks`,
    );
  }
  return ok(content.data);
}
