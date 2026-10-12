import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  TOOL_TEXT_MAX_BYTES,
  type VisualBlock,
} from "../../../../protocol/lophn-agent/mod.ts";

// 문서로 남기기의 준비. 확정 메시지에서 고른 블록의 고정 명세·설명·출처와
// 그 순간의 데이터를 실행 코드 없는 HTML 글로 만든다. 글만 만든다: blob 준비·hash 계산·문서 저장은
// 이 모듈이 하지 않는다. 저장은 문서 tool이 글 값으로 별도로 하고 core가 redaction과 blob을 맡는다.
// 그래서 준비를 마쳤다는 것이 저장했다는 뜻이 아니고, 저장 전에는 본문 hash가 없다.
//
// 그림은 공용 SDK가 그린다. 이 HTML은 SDK의 정적 그림 대신 같은 데이터를 읽을 수 있는
// 표와 목록으로 담는다. script·style·iframe·외부 자원·앱 token은 어디에도 넣지 않는다.

export type PreparedBlockSnapshot = {
  block_key: string;
  // captured면 redaction된 snapshot JSON과 hash·시각이 있다. snapshot을 얻지 못하면
  // unavailable이고 고정 참조만 남는다. hash는 core가 준비한 blob의 hash다.
  status: "captured" | "unavailable";
  captured_at: string | null;
  snapshot: string | null;
  hash: string | null;
};

export type PreparedVisualDocument = {
  text: string;
  bytes: number;
  block_keys: string[];
  snapshots: PreparedBlockSnapshot[];
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const e = escapeHtml;

function unit(label: string, unitName: string | undefined): string {
  return unitName === undefined ? e(label) : `${e(label)} (${e(unitName)})`;
}

function cell(value: string | number | boolean | null): string {
  // 결측은 0이나 빈칸이 아니라 결측이라고 적는다.
  return value === null
    ? "<td><em>missing</em></td>"
    : `<td>${e(String(value))}</td>`;
}

// key를 정렬한 들여쓴 JSON. 같은 값은 같은 글이고 줄이 나뉘어 이어 읽을 수 있다.
export function stableJson(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent + 1);
  const end = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${
      value.map((item) => `${pad}${stableJson(item, indent + 1)}`).join(",\n")
    }\n${end}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    if (entries.length === 0) return "{}";
    return `{\n${
      entries.map(([key, item]) =>
        `${pad}${JSON.stringify(key)}: ${stableJson(item, indent + 1)}`
      ).join(",\n")
    }\n${end}}`;
  }
  return JSON.stringify(value);
}

function sourceItem(source: VisualBlock["sources"][number]): string {
  const at = source.observed_at === null
    ? ""
    : `, observed at ${e(source.observed_at)}`;
  if (source.kind === "document") {
    const section = source.reference.section === undefined
      ? ""
      : `, section ${e(source.reference.section)}`;
    return `<li>Document ${e(source.reference.document)} version ${
      e(source.reference.version)
    }${section}${at}</li>`;
  }
  if (source.kind === "app_command") {
    return `<li>App command ${e(source.reference.command)} of app ${
      e(source.reference.app)
    } release ${e(source.reference.release)}, tool call ${
      e(source.reference.tool_call)
    }${at}</li>`;
  }
  return `<li>Estimate: ${e(source.reference.label)}${at}</li>`;
}

function tableRows(block: Extract<VisualBlock, { kind: "table" }>): string[] {
  const { columns, rows } = block.payload;
  if (rows.length === 0) return ["<p>No rows.</p>"];
  return [
    "<table>",
    `<thead><tr>${
      columns.map((c) => `<th>${unit(c.label, c.unit)}</th>`).join("")
    }</tr></thead>`,
    "<tbody>",
    ...rows.map((row) =>
      `<tr>${
        columns.map((c) => cell(Object.hasOwn(row, c.key) ? row[c.key]! : null))
          .join("")
      }</tr>`
    ),
    "</tbody>",
    "</table>",
  ];
}

function chartRows(block: Extract<VisualBlock, { kind: "chart" }>): string[] {
  const { type, x, y, series } = block.payload;
  const lines = [`<p>Chart type: ${e(type)}.</p>`];
  if (series.length === 0) return [...lines, "<p>No series.</p>"];
  for (const one of series) {
    lines.push(`<h4>${e(one.label)}</h4>`);
    if (one.points.length === 0) {
      lines.push("<p>No points.</p>");
      continue;
    }
    lines.push(
      "<table>",
      `<thead><tr><th>${unit(x.label, x.unit)}</th><th>${
        unit(y.label, y.unit)
      }</th></tr></thead>`,
      "<tbody>",
      ...one.points.map((point) => `<tr>${cell(point.x)}${cell(point.y)}</tr>`),
      "</tbody>",
      "</table>",
    );
  }
  return lines;
}

function diagramRows(
  block: Extract<VisualBlock, { kind: "diagram" }>,
): string[] {
  const { nodes, edges } = block.payload;
  const labels = new Map(nodes.map((node) => [node.key, node.label]));
  if (nodes.length === 0) return ["<p>No nodes.</p>"];
  return [
    "<h4>Nodes</h4>",
    "<ul>",
    ...nodes.map((node) =>
      `<li>${e(node.label)}${
        node.description === undefined ? "" : `: ${e(node.description)}`
      }</li>`
    ),
    "</ul>",
    "<h4>Edges</h4>",
    ...(edges.length === 0 ? ["<p>No edges.</p>"] : [
      "<ul>",
      ...edges.map((edge) =>
        `<li>${e(labels.get(edge.from) ?? edge.from)} to ${
          e(labels.get(edge.to) ?? edge.to)
        }${edge.label === undefined ? "" : ` (${e(edge.label)})`}</li>`
      ),
      "</ul>",
    ]),
  ];
}

type CardCapture = {
  block_key: string;
  snapshot: string;
  captured_at: string | null;
  hash: string | null;
};

function cardRows(
  block: Extract<VisualBlock, { kind: "app_card" }>,
  captures: readonly CardCapture[],
): string[] {
  const { app, release, view } = block.payload;
  const capture = captures.find((entry) => entry.block_key === block.key);
  if (capture !== undefined) {
    // redaction된 snapshot과 고정 참조를 남긴다. live 화면·credential은 넣지 않는다.
    return [
      `<p>App card of app ${e(app)} release ${e(release)} view ${e(view)}.</p>`,
      `<h4>Snapshot</h4>`,
      `<pre><code>${e(capture.snapshot)}</code></pre>`,
      capture.captured_at === null
        ? ""
        : `<p>Captured at ${e(capture.captured_at)}.</p>`,
    ];
  }
  // live 앱 화면·credential은 문서에 넣지 않는다. snapshot이 없으면 없다고 적고 고정 참조만 남긴다.
  return [
    `<p>App card of app ${e(app)} release ${e(release)} view ${e(view)}.</p>`,
    "<p>No snapshot of this card was captured. The live app screen is not part of this document.</p>",
  ];
}

function dataRows(
  block: VisualBlock,
  captures: readonly CardCapture[],
): string[] {
  switch (block.kind) {
    case "table":
      return tableRows(block);
    case "chart":
      return chartRows(block);
    case "diagram":
      return diagramRows(block);
    case "app_card":
      return cardRows(block, captures);
  }
}

function section(
  block: VisualBlock,
  captures: readonly CardCapture[],
): string[] {
  return [
    `<section data-block="${e(block.key)}" data-kind="${block.kind}">`,
    `<h2>${e(block.title)}</h2>`,
    `<p>${e(block.description)}</p>`,
    "<h3>Sources</h3>",
    ...(block.sources.length === 0
      ? ["<p>No source was recorded for this block.</p>"]
      : ["<ul>", ...block.sources.map(sourceItem), "</ul>"]),
    "<h3>Data</h3>",
    ...dataRows(block, captures),
    "<h3>Specification</h3>",
    // 명세는 읽을 수 있는 escape된 글이다. script에 넣지 않는다.
    `<pre><code>${e(stableJson(block))}</code></pre>`,
    "</section>",
  ];
}

export function prepareVisualDocument(input: {
  message: string;
  // 고정 근거: 읽은 메시지 본문의 hash다(ReadMessageBody가 돌려준 값).
  source_body: string;
  blocks: readonly VisualBlock[];
  // 앱 카드의 redaction된 snapshot이다. agent_context read 결과(app.screen_context)
  // 가 준 값으로, 준비 때 그 값과 시각·hash를 그대로 싣는다. snapshot을 얻지 못한 카드는
  // 이 입력에 없고 unavailable이 된다.
  captures?: readonly CardCapture[];
}): Result<PreparedVisualDocument> {
  if (input.blocks.length === 0) {
    return err({ code: "invalid_input", message: "no block was selected" });
  }
  const captures = input.captures ?? [];
  const title = input.blocks.length === 1
    ? input.blocks[0]!.title
    : `${input.blocks.length} visuals`;
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${e(title)}</title>`,
    "</head>",
    "<body>",
    `<h1>${e(title)}</h1>`,
    "<dl>",
    `<dt>Source message</dt><dd>${e(input.message)}</dd>`,
    `<dt>Source body</dt><dd>${e(input.source_body)}</dd>`,
    "</dl>",
    ...input.blocks.flatMap((block) => section(block, captures)),
    "</body>",
    "</html>",
    "",
  ];
  const text = lines.join("\n");
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > TOOL_TEXT_MAX_BYTES) {
    return err({
      code: "invalid_input",
      message:
        `prepared document is ${bytes} bytes and exceeds ${TOOL_TEXT_MAX_BYTES}; select fewer blocks`,
    });
  }
  const snapshots: PreparedBlockSnapshot[] = [];
  for (const block of input.blocks) {
    if (block.kind !== "app_card") continue;
    // agent_context read 결과의 redaction된 snapshot이다. 준비 입력에 있던
    // 값과 시각·hash를 그대로 싣는다. 없는 카드는 unavailable과 참조만이다.
    const capture = captures.find((entry) => entry.block_key === block.key);
    snapshots.push(
      capture === undefined
        ? {
          block_key: block.key,
          status: "unavailable",
          captured_at: null,
          snapshot: null,
          hash: null,
        }
        : {
          block_key: block.key,
          status: "captured",
          captured_at: capture.captured_at,
          snapshot: capture.snapshot,
          hash: capture.hash,
        },
    );
  }
  return ok({
    text,
    bytes,
    block_keys: input.blocks.map((block) => block.key),
    snapshots,
  });
}

// 결과 상한 안에서 글을 이어 준다. 조각을 순서대로 이으면 원래 글이 그대로다(줄바꿈은 조각 끝에
// 남는다). 긴 줄은 줄 안에서 나눠도 이어 붙이면 같다.
const SEGMENT = 6000;

export type TextWindow = {
  text: string;
  // 다음 조각의 시작 위치(UTF-16 code unit이 아니라 조각 번호). 끝이면 null.
  next: number | null;
  total_segments: number;
};

function segments(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const whole = `${line}\n`;
    const points = Array.from(whole);
    for (let index = 0; index < points.length; index += SEGMENT) {
      out.push(points.slice(index, index + SEGMENT).join(""));
    }
  }
  // 마지막 줄바꿈 뒤의 빈 줄은 원래 글에 없다.
  const last = out.length - 1;
  if (text.endsWith("\n") && out[last] === "\n") out.pop();
  else if (!text.endsWith("\n") && last >= 0) {
    out[last] = out[last]!.slice(0, -1);
  }
  return out;
}

function jsonSize(text: string): number {
  return new TextEncoder().encode(JSON.stringify(text)).byteLength - 2;
}

export function windowText(
  text: string,
  start: number,
  budget: number,
): TextWindow {
  const parts = segments(text);
  let used = 0;
  let index = start;
  const taken: string[] = [];
  while (index < parts.length) {
    const size = jsonSize(parts[index]!);
    if (taken.length > 0 && used + size > budget) break;
    taken.push(parts[index]!);
    used += size;
    index += 1;
  }
  return {
    text: taken.join(""),
    next: index < parts.length ? index : null,
    total_segments: parts.length,
  };
}
