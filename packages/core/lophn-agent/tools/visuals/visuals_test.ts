import { assert, assertEquals, assertFalse } from "@std/assert";
import { canonicalize } from "../../../../base/mod.ts";
import {
  app,
  at,
  chartBlock,
  doc,
  later,
  msg,
  rel,
  tableBlock,
  tcl,
  ver,
} from "./testing/mod.ts";
import {
  MESSAGE_CONTENT_MAX_BYTES,
  visualBlockSchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import {
  checkVisualContent,
  prepareVisualDocument,
  readStoredBlock,
  stableJson,
  VISUAL_LIMITS,
  windowText,
} from "./mod.ts";

// 시각 블록의 owner 검사와 문서 본문 준비. 소유 contract의 모양 검사는 contracts/lophn-agent의
// visuals_test.ts가 보고, 여기서는 검사 순서·거절 단계·실행 코드 없는 본문을 본다. model provider와
// 실제 core는 부르지 않는다.

const BODY = "ab".repeat(32);

const card = {
  key: "card",
  schema_version: 1,
  kind: "app_card",
  title: "Orders card",
  description: "the live orders screen",
  sources: [],
  payload: { app, release: rel, view: "summary", input: { n: 1 } },
};

const diagram = {
  ...tableBlock,
  key: "flow",
  kind: "diagram",
  payload: {
    nodes: [
      { key: "a", label: "Intake", description: "orders come in" },
      { key: "b", label: "Ship" },
    ],
    edges: [{ from: "a", to: "b", label: "paid" }],
  },
};

function content(...blocks: unknown[]) {
  return {
    schema_version: 1,
    parts: [
      { kind: "text", text: "here" },
      ...blocks.map((block) => ({ kind: "visual", block })),
    ],
  };
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalize(value)).length;
}

function table(key: string, rows: unknown[], columns = 1) {
  return {
    ...tableBlock,
    key,
    payload: {
      columns: Array.from({ length: columns }, (_, i) => ({
        key: `c${i}`,
        label: `c${i}`,
        type: "string",
      })),
      rows,
    },
  };
}

function rejected(value: unknown) {
  const checked = checkVisualContent(value);
  assertFalse(checked.ok);
  return checked.ok ? undefined as never : checked.error;
}

Deno.test("lophn-agent/visuals#R1: 표·차트·도표·앱 카드만 받고 HTML·script·CSS·URL·모르는 종류는 값을 되풀이하지 않고 거절한다", () => {
  const scatter = {
    ...chartBlock,
    key: "scatter",
    payload: {
      ...chartBlock.payload,
      type: "scatter",
      x: { label: "n", type: "number" },
      series: [{ key: "s", label: "s", points: [{ x: 1, y: 2 }] }],
    },
  };
  const bar = {
    ...chartBlock,
    key: "bar",
    payload: {
      type: "bar",
      x: { label: "kind", type: "category" },
      y: { label: "n" },
      series: [{ key: "s", label: "s", points: [{ x: "a", y: 1 }] }],
    },
  };
  for (
    const block of [tableBlock, chartBlock, bar, scatter, diagram, card]
  ) {
    const checked = checkVisualContent(content(block));
    assert(checked.ok, JSON.stringify(checked));
  }
  // 문장은 막지 않는다.
  const plainTalk = {
    ...tableBlock,
    title: "R&D spend, a < b and a > c",
    description: "Sample data: values in USD. Price <5 and >2 stay plain text.",
  };
  assert(checkVisualContent(content(plainTalk)).ok);

  const attacks: [string, unknown][] = [
    ["unknown kind", { ...tableBlock, kind: "html", payload: { html: "x" } }],
    ["extra html field", { ...tableBlock, html: "<b>x</b>" }],
    ["extra style field", { ...tableBlock, style: "color: red" }],
    ["script tag in title", {
      ...tableBlock,
      title: "<script>alert(1)</script>",
    }],
    ["style tag in description", {
      ...tableBlock,
      description: "text <style>body{display:none}</style>",
    }],
    ["javascript scheme", {
      ...tableBlock,
      description: "javascript:alert(1)",
    }],
    ["data uri", { ...tableBlock, description: "data:text/html;base64,AAAA" }],
    ["http url in a cell", table("t", [{ c0: "see http://evil.example/x" }])],
    ["bare www host", { ...tableBlock, description: "www.evil.example is ok" }],
    ["css url()", { ...tableBlock, description: "background:url(x)" }],
    ["css import", { ...tableBlock, description: "@import 'x'" }],
    ["url in app card input", {
      ...card,
      payload: { ...card.payload, input: { next: "https://evil.example" } },
    }],
    ["markup in an input key", {
      ...card,
      payload: { ...card.payload, input: { "<img src=x>": 1 } },
    }],
    ["url in a source label", {
      ...tableBlock,
      sources: [{
        kind: "estimate",
        reference: { label: "ftp://host/file" },
        observed_at: null,
      }],
    }],
  ];
  for (const [name, block] of attacks) {
    const error = rejected(content(block));
    assertEquals(error.code, "invalid_input", name);
    // 거절 이유는 단계와 자리뿐이고 보낸 문자열은 없다.
    for (const leaked of ["alert", "evil", "display", "base64", "ftp"]) {
      assertFalse(error.message.includes(leaked), `${name}: ${error.message}`);
    }
  }
  assertEquals(
    rejected(content({ ...tableBlock, kind: "html" })).stage,
    "block",
  );
  assertEquals(
    rejected(content({ ...tableBlock, title: "<b>x</b>" })).stage,
    "markup",
  );
});

Deno.test("lophn-agent/visuals#R2: 제목·설명이 필수이고 출처는 모양을 갖추며 빈 데이터와 결측은 값으로 채우지 않는다", () => {
  for (const missing of ["title", "description", "sources"]) {
    const block: Record<string, unknown> = { ...tableBlock };
    delete block[missing];
    assertEquals(rejected(content(block)).stage, "block", missing);
  }
  assertEquals(
    rejected(content({ ...tableBlock, title: "" })).stage,
    "block",
  );
  assertEquals(
    rejected(content({ ...tableBlock, description: "" })).stage,
    "block",
  );
  // 출처는 고정 문서 판, 앱 command 결과, 표시한 추정이다. 모양이 틀린 출처는 거절된다.
  const sources = [
    {
      kind: "document",
      reference: { document: doc, version: ver },
      observed_at: null,
    },
    {
      kind: "app_command",
      reference: { app, release: rel, command: "list_orders", tool_call: tcl },
      observed_at: at,
    },
    {
      kind: "estimate",
      reference: { label: "rough guess" },
      observed_at: null,
    },
  ];
  assert(checkVisualContent(content({ ...tableBlock, sources })).ok);
  const noTime = [{
    kind: "app_command",
    reference: { app, release: rel, command: "list_orders", tool_call: tcl },
    observed_at: null,
  }];
  assertEquals(
    rejected(content({ ...tableBlock, sources: noTime })).stage,
    "block",
  );
  // 빈 표는 빈 표이고 결측은 null로 남는다(0이나 빈 문자열로 바꾸지 않는다).
  const empty = checkVisualContent(content(table("empty", [])));
  assert(empty.ok);
  const nulls = {
    ...chartBlock,
    payload: {
      ...chartBlock.payload,
      series: [{
        key: "s",
        label: "s",
        points: [{ x: at, y: 0 }, { x: later, y: null }],
      }],
    },
  };
  const checked = checkVisualContent(content(nulls));
  assert(checked.ok);
  const stored = JSON.parse(canonicalize(checked.value)) as {
    parts: {
      block?: { payload: { series: { points: { y: unknown }[] }[] } };
    }[];
  };
  assertEquals(
    stored.parts[1]!.block!.payload.series[0]!.points.map((p) => p.y),
    [0, null],
  );
  // 문서로 준비해도 같다: 빈 표는 "No rows.", 출처 없음과 결측은 글로 보인다.
  const block = visualBlockSchema.parse({
    ...table("empty", []),
    sources: [],
  });
  const prepared = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks: [block, visualBlockSchema.parse(nulls)],
  });
  assert(prepared.ok);
  assert(prepared.value.text.includes("<p>No rows.</p>"));
  assert(
    prepared.value.text.includes("No source was recorded for this block."),
  );
  assert(prepared.value.text.includes("<td><em>missing</em></td>"));
});

Deno.test("lophn-agent/visuals#R3: 블록 8개·표 1000행 20열·차트 8 series 1000점·도표 100 node 200 edge까지 받고 바로 다음 값은 자르지 않고 전체 거절한다", () => {
  const small = (key: string) => table(key, [{ c0: "a" }]);
  // 블록 수.
  const eight = Array.from({ length: 8 }, (_, i) => small(`b${i}`));
  assert(checkVisualContent(content(...eight)).ok);
  const nine = rejected(content(...eight, small("b8")));
  assertEquals(nine.stage, "count");
  assert(nine.message.includes("9 blocks"));
  // 표 행.
  const row = { c0: "a" };
  assert(
    checkVisualContent(content(table("rows", Array(1000).fill(row)))).ok,
  );
  const rows = rejected(content(table("rows", Array(1001).fill(row))));
  assertEquals([rows.stage, rows.block], ["limit", "rows"]);
  assert(rows.message.includes("table rows 1001 exceed the limit 1000"));
  // 표 열.
  assert(checkVisualContent(content(table("cols", [], 20))).ok);
  const cols = rejected(content(table("cols", [], 21)));
  assertEquals([cols.stage, cols.block], ["limit", "cols"]);
  // 차트 series와 전체 점.
  const chart = (series: number, pointsEach: number[]) => ({
    ...chartBlock,
    key: "chart",
    payload: {
      ...chartBlock.payload,
      series: Array.from({ length: series }, (_, s) => ({
        key: `s${s}`,
        label: `s${s}`,
        points: Array.from({ length: pointsEach[s] ?? 0 }, () => ({
          x: at,
          y: 1,
        })),
      })),
    },
  });
  assert(
    checkVisualContent(
      content(chart(8, [125, 125, 125, 125, 125, 125, 125, 125])),
    ).ok,
  );
  assertEquals(
    rejected(content(chart(9, []))).message.includes("chart series 9"),
    true,
  );
  assert(checkVisualContent(content(chart(2, [500, 500]))).ok);
  const points = rejected(content(chart(2, [500, 501])));
  assertEquals(points.stage, "limit");
  assert(points.message.includes("chart points 1001 exceed the limit 1000"));
  // 도표 node와 edge.
  const flow = (nodes: number, edges: number) => ({
    ...diagram,
    payload: {
      nodes: Array.from({ length: nodes }, (_, i) => ({
        key: `n${i}`,
        label: `n${i}`,
      })),
      edges: Array.from({ length: edges }, () => ({ from: "n0", to: "n1" })),
    },
  });
  assert(checkVisualContent(content(flow(100, 200))).ok);
  assert(
    rejected(content(flow(101, 0))).message.includes("diagram nodes 101"),
  );
  assert(
    rejected(content(flow(2, 201))).message.includes("diagram edges 201"),
  );
  // 거절은 전체다. 통과한 블록이 앞에 있어도 값을 돌려주지 않는다.
  const mixed = checkVisualContent(
    content(small("fine"), table("big", Array(1001).fill(row))),
  );
  assertFalse(mixed.ok);
});

Deno.test("lophn-agent/visuals#R3: bytes 합계는 마지막에 보고 블록 합계 262144를 넘으면 단계 bytes, 메시지 전체 240 KiB를 넘으면 단계 content로 거절하며 경계에서 받는다", () => {
  assertEquals(VISUAL_LIMITS.bytes, 262144);
  // 큰 문자열 표 여덟 개: 블록 합계가 상한을 넘는다.
  const big = (key: string, cell: number) =>
    table(key, Array.from({ length: 1000 }, () => ({ c0: "x".repeat(cell) })));
  const over = Array.from({ length: 8 }, (_, i) => big(`b${i}`, 36));
  assert(over.reduce((sum, block) => sum + bytes(block), 0) > 262144);
  const total = rejected(content(...over));
  assertEquals(total.stage, "bytes");
  assert(total.message.includes("exceed the limit 262144"));
  // 앞 단계가 먼저다: 행이 넘는 블록과 합계가 넘는 것이 함께면 행 상한으로 거절한다.
  assertEquals(
    rejected(content(...over, table("rows", Array(1001).fill({ c0: "a" }))))
      .stage,
    "count",
  );
  assertEquals(
    rejected(
      content(
        ...over.slice(0, 7),
        table("rows", Array(1001).fill({ c0: "a" })),
      ),
    )
      .stage,
    "limit",
  );
  // 메시지 전체 상한은 글을 합친 240 KiB다. 정확히 상한이면 받고 한 byte 넘으면 거절한다.
  const block = table("b", [{ c0: "a" }]);
  const base = content(block);
  const pad = (n: number) => {
    const value = structuredClone(base);
    (value.parts[0] as { text: string }).text = "t".repeat(n);
    return value;
  };
  const room = MESSAGE_CONTENT_MAX_BYTES - bytes(pad(0));
  assertEquals(bytes(pad(room)), MESSAGE_CONTENT_MAX_BYTES);
  assert(checkVisualContent(pad(room)).ok);
  const tooLarge = rejected(pad(room + 1));
  assertEquals(tooLarge.stage, "content");
  assert(tooLarge.message.includes(String(MESSAGE_CONTENT_MAX_BYTES)));
});

Deno.test("lophn-agent/visuals#R5: 현재 검사를 통과하지 못하는 저장 블록도 본문·설명·출처를 그대로 두고 앱 카드 참조는 다른 앱·release로 바뀌지 않는다", () => {
  const ready = readStoredBlock(card);
  assertEquals(ready.status, "ready");
  assertEquals(
    ready.status === "ready" ? ready.block.payload : null,
    card.payload,
  );
  // 다른 판의 명세나 깨진 payload는 이용 불가로 두고 설명·출처는 그대로 돌려준다.
  const broken = {
    ...card,
    schema_version: 2,
    payload: { app: "gone", release: "gone", view: 3 },
    sources: [{
      kind: "estimate",
      reference: { label: "guess" },
      observed_at: null,
    }],
  };
  const stored = readStoredBlock(broken);
  assertEquals(stored.status, "unavailable");
  if (stored.status === "unavailable") {
    assertEquals(stored.key, "card");
    assertEquals(stored.kind, "app_card");
    assertEquals(stored.title, "Orders card");
    assertEquals(stored.description, "the live orders screen");
    assertEquals(stored.sources, broken.sources);
  }
  // 객체가 아닌 값도 던지지 않는다.
  assertEquals(readStoredBlock("junk").status, "unavailable");
  assertEquals(readStoredBlock(null).status, "unavailable");
});

Deno.test("lophn-agent/visuals#R6: 문서 본문은 escape한 명세 JSON과 읽을 수 있는 데이터만 담은 실행 코드 없는 HTML이고 저장하지 않은 본문에는 hash가 없다", () => {
  const blocks = [tableBlock, chartBlock, diagram, card].map((block) =>
    visualBlockSchema.parse(block)
  );
  const prepared = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks,
  });
  assert(prepared.ok);
  const { text } = prepared.value;
  assert(text.startsWith("<!doctype html>\n"));
  for (
    const forbidden of [
      "<script",
      "<iframe",
      "<link",
      "<img",
      "<style",
      "<object",
      "<embed",
      "<form",
      "javascript:",
      "http://",
      "https://",
    ]
  ) {
    assertFalse(text.toLowerCase().includes(forbidden), forbidden);
  }
  assertFalse(/\son[a-z]+=/i.test(text));
  assert(text.includes('<section data-block="counts" data-kind="table">'));
  assert(text.includes("<h2>counts</h2>"));
  assert(text.includes("<p>observed counts</p>"));
  assert(text.includes(`Document ${doc} version ${ver}`));
  assert(text.includes(`<dd>${msg}</dd>`));
  // 고정 명세는 key를 정렬한 escape된 글이다.
  assert(text.includes("<pre><code>"));
  assert(text.includes("&quot;kind&quot;: &quot;table&quot;"));
  assertEquals(prepared.value.block_keys, ["counts", "trend", "flow", "card"]);
  // 앱 카드는 snapshot이 없다고 적고 고정 참조만 두며 live 화면을 넣지 않는다. hash는 없다.
  assertEquals(prepared.value.snapshots, [{
    block_key: "card",
    status: "unavailable",
    captured_at: null,
    snapshot: null,
    hash: null,
  }]);
  assert(text.includes("No snapshot of this card was captured."));
  assert(text.includes(`app ${app} release ${rel} view summary`));
  assertFalse("body_hash" in prepared.value);
  // 저장된 문자열이 markup이었어도 escape된다.
  const hostile = visualBlockSchema.parse({
    ...tableBlock,
    title: "<script>alert(1)</script> & \"q\" 'a'",
  });
  const escaped = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks: [hostile],
  });
  assert(escaped.ok);
  assertFalse(escaped.value.text.includes("<script"));
  assert(
    escaped.value.text.includes(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;a&#39;",
    ),
  );
  // 같은 입력은 같은 글이다.
  const again = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks,
  });
  assert(again.ok);
  assertEquals(again.value.text, text);
  assertEquals(
    stableJson({ b: 1, a: [2, { d: 1, c: null }] }),
    `{
  "a": [
    2,
    {
      "c": null,
      "d": 1
    }
  ],
  "b": 1
}`,
  );
});

Deno.test("lophn-agent/visuals#R6: 준비한 글이 너무 크면 일부를 자르지 않고 거절하고 조각은 이으면 원래 글이며 긴 줄도 이어 붙이면 같다", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ c0: `row ${i} é한` }));
  const block = visualBlockSchema.parse(table("rows", rows));
  const prepared = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks: [block],
  });
  assert(prepared.ok);
  let joined = "";
  let at = 0;
  let windows = 0;
  while (true) {
    const piece = windowText(prepared.value.text, at, 20 * 1024);
    assert(
      new TextEncoder().encode(JSON.stringify(piece.text)).length <=
        20 * 1024 + 2,
    );
    joined += piece.text;
    windows += 1;
    if (piece.next === null) break;
    assert(piece.next > at);
    at = piece.next;
  }
  assert(windows > 1);
  assertEquals(joined, prepared.value.text);
  // 한 줄이 조각 상한보다 길어도 나눠 보내고 이으면 같다.
  const longLine = `${"가".repeat(20000)}\n끝\n`;
  let rebuilt = "";
  let next: number | null = 0;
  while (next !== null) {
    const piece = windowText(longLine, next, 4000);
    rebuilt += piece.text;
    next = piece.next;
  }
  assertEquals(rebuilt, longLine);
  // 128 KiB를 넘는 본문은 준비하지 않는다.
  const huge = visualBlockSchema.parse(
    table(
      "huge",
      Array.from({ length: 1000 }, () => ({ c0: "x".repeat(200) })),
    ),
  );
  const refused = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks: [huge],
  });
  assertFalse(refused.ok);
  assertEquals(refused.ok ? "" : refused.error.code, "invalid_input");
  const none = prepareVisualDocument({
    message: msg,
    source_body: BODY,
    blocks: [],
  });
  assertFalse(none.ok);
});
