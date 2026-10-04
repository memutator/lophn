import { assert, assertEquals } from "@std/assert";
import {
  appCardReferenceInputSchema,
  chartSpecInputSchema,
  chartSpecSchema,
  diagramSpecInputSchema,
  tableSpecInputSchema,
  tableSpecSchema,
  visualBlockInputSchema,
  visualBlockSchema,
  visualSourceInputSchema,
  visualSourceSchema,
} from "./visuals.ts";
import {
  app,
  at,
  chartBlock,
  doc,
  later,
  rel,
  tableBlock,
  tcl,
  ver,
} from "./message-fixtures.ts";

const card = {
  key: "card",
  schema_version: 1,
  kind: "app_card",
  title: "card",
  description: "fixed view",
  sources: [],
  payload: { app, release: rel, view: "summary", input: { n: 1 } },
};

Deno.test("lophn-agent/visuals#R1: only the four declared kinds are input", () => {
  assert(visualBlockInputSchema.safeParse(tableBlock).success);
  assert(visualBlockInputSchema.safeParse(chartBlock).success);
  assert(
    visualBlockInputSchema.safeParse({
      ...tableBlock,
      key: "flow",
      kind: "diagram",
      payload: {
        nodes: [{ key: "a", label: "a" }],
        edges: [{ from: "a", to: "a" }],
      },
    }).success,
  );
  assert(visualBlockInputSchema.safeParse(card).success);
  assert(
    !visualBlockInputSchema.safeParse({
      ...tableBlock,
      kind: "html",
      payload: { html: "<script>" },
    }).success,
  );
  assert(
    !visualBlockInputSchema.safeParse({ ...tableBlock, url: "https://x" })
      .success,
  );
  assert(
    !visualBlockInputSchema.safeParse({
      ...card,
      payload: { ...card.payload, executable: "node" },
    }).success,
  );
  assert(
    visualBlockSchema.safeParse({ ...tableBlock, renderer: "sdk" }).success,
  );
});

Deno.test("lophn-agent/visuals#R2: sources are document, command or estimate", () => {
  assert(visualSourceInputSchema.safeParse(tableBlock.sources[0]).success);
  assert(
    visualSourceInputSchema.safeParse({
      kind: "app_command",
      reference: { app, release: rel, command: "read", tool_call: tcl },
      observed_at: at,
    }).success,
  );
  assert(
    visualSourceInputSchema.safeParse({
      kind: "estimate",
      reference: { label: "rough" },
      observed_at: null,
    }).success,
  );
  assert(
    !visualSourceInputSchema.safeParse({
      kind: "document",
      reference: { document: doc, version: ver, url: "https://x" },
      observed_at: null,
    }).success,
  );
  assert(
    !visualSourceInputSchema.safeParse({
      kind: "app_command",
      reference: { app, release: rel, command: "read", tool_call: tcl },
      observed_at: null,
    }).success,
  );
  assert(
    !visualSourceInputSchema.safeParse({
      kind: "url",
      reference: { label: "x" },
      observed_at: null,
    }).success,
  );
  assert(
    visualSourceSchema.safeParse({
      ...tableBlock.sources[0],
      note: "kept",
    }).success,
  );
  assertEquals("가".length, 1);
  assert(
    visualBlockInputSchema.safeParse({
      ...tableBlock,
      title: "가".repeat(200),
      description: "나".repeat(2000),
    }).success,
  );
  assert(
    !visualBlockInputSchema.safeParse({
      ...tableBlock,
      title: "가".repeat(201),
    }).success,
  );
});

Deno.test("lophn-agent/visuals#R3: table chart and diagram bounds reject the next value", () => {
  const columns = Array.from({ length: 20 }, (_, index) => ({
    key: `c${index}`,
    label: "c",
    type: "string" as const,
  }));
  assert(
    tableSpecInputSchema.safeParse({
      columns: [{ ...columns[0], label: "c".repeat(201) }, ...columns.slice(1)],
      rows: Array.from({ length: 1000 }, () => ({ c0: null })),
    }).success,
  );
  assert(
    !tableSpecInputSchema.safeParse({
      columns: [...columns, { key: "c20", label: "c", type: "string" }],
      rows: [],
    }).success,
  );
  assert(
    !tableSpecInputSchema.safeParse({
      columns,
      rows: Array.from({ length: 1001 }, () => ({})),
    }).success,
  );
  assert(
    !tableSpecSchema.safeParse({
      columns: [{ key: "n", label: "n", type: "number" }],
      rows: [{ n: Infinity }, { missing: "x" }, { n: "1" }],
    }).success,
  );
  assert(
    tableSpecSchema.safeParse({
      columns: [{ key: "n", label: "n", type: "number" }],
      rows: [{ n: null }, { n: 1 }],
    }).success,
  );
  const longKey = "k".repeat(65);
  assert(
    tableSpecInputSchema.safeParse({
      columns: [{ key: longKey, label: "a", type: "string" }],
      rows: [{ [longKey]: "kept" }],
    }).success,
  );
  assert(
    tableSpecInputSchema.safeParse({
      columns: [{ key: "Name 1", label: "a", type: "string" }],
      rows: [{ "Name 1": "kept" }],
    }).success,
  );
  assert(
    chartSpecInputSchema.safeParse({
      type: "bar",
      x: { label: "x", type: "category" },
      y: { label: "y" },
      series: [{
        key: "Series 1",
        label: "s",
        points: [{ x: "Name 1", y: 1 }],
      }],
    }).success,
  );
  for (const key of ["", "a\nb", "a\u0000b", "a\u007fb"]) {
    assert(
      tableSpecInputSchema.safeParse({
        columns: [{ key, label: "a", type: "string" }],
        rows: [{ [key]: "kept" }],
      }).success,
    );
    assert(
      diagramSpecInputSchema.safeParse({
        nodes: [{ key, label: "a" }],
        edges: [{ from: key, to: key }],
      }).success,
    );
  }
  assert(
    !tableSpecInputSchema.safeParse({
      columns: [
        { key: "a", label: "a", type: "string" },
        { key: "a", label: "b", type: "string" },
      ],
      rows: [],
    }).success,
  );

  const series = [{
    key: "s",
    label: "s",
    points: Array.from(
      { length: 1000 },
      (_, index) => ({ x: index, y: index }),
    ),
  }];
  assert(
    chartSpecInputSchema.safeParse({
      type: "bar",
      x: { label: "x", type: "number" },
      y: { label: "y" },
      series,
    }).success,
  );
  assert(
    !chartSpecInputSchema.safeParse({
      type: "line",
      x: { label: "x", type: "category" },
      y: { label: "y" },
      series: Array.from(
        { length: 9 },
        (_, index) => ({ ...series[0], key: `s${index}`, points: [] }),
      ),
    }).success,
  );
  assert(
    !chartSpecInputSchema.safeParse({
      type: "scatter",
      x: { label: "x", type: "number" },
      y: { label: "y" },
      series: [{
        ...series[0],
        points: [...series[0].points, { x: 1, y: 1 }],
      }],
    }).success,
  );
  assert(
    !chartSpecInputSchema.safeParse({
      type: "scatter",
      x: { label: "x", type: "category" },
      y: { label: "y" },
      series: [{ key: "s", label: "s", points: [{ x: "a", y: 1 }] }],
    }).success,
  );
  assert(
    !chartSpecSchema.safeParse({
      type: "line",
      x: { label: "x", type: "time" },
      y: { label: "y" },
      series: [{ key: "s", label: "s", points: [{ x: "today", y: null }] }],
    }).success,
  );
  assert(chartSpecSchema.safeParse(chartBlock.payload).success);

  const nodes = Array.from({ length: 100 }, (_, index) => ({
    key: `n${index}`,
    label: "n",
  }));
  assert(
    diagramSpecInputSchema.safeParse({
      nodes,
      edges: Array.from({ length: 200 }, () => ({ from: "n0", to: "n1" })),
    }).success,
  );
  assert(
    !diagramSpecInputSchema.safeParse({
      nodes: [...nodes, { key: "n100", label: "n" }],
      edges: [],
    }).success,
  );
  assert(
    !diagramSpecInputSchema.safeParse({
      nodes,
      edges: Array.from({ length: 201 }, () => ({ from: "n0", to: "gone" })),
    }).success,
  );
  assert(
    diagramSpecInputSchema.safeParse({
      nodes: [{
        key: "Start node",
        label: "a".repeat(200),
        description: "d".repeat(2001),
      }],
      edges: [{ from: "Start node", to: "Start node", label: "e".repeat(201) }],
    }).success,
  );
  assert(
    !diagramSpecInputSchema.safeParse({
      nodes: [{ key: "n", label: "a".repeat(201) }],
      edges: [],
    }).success,
  );
  assert(
    !diagramSpecInputSchema.safeParse({
      nodes: [{ key: "a", label: "a" }, { key: "a", label: "b" }],
      edges: [],
    }).success,
  );
});

Deno.test("lophn-agent/visuals#R4: app card is a fixed view object and does not grant a command", () => {
  assert(appCardReferenceInputSchema.safeParse(card.payload).success);
  assert(
    !appCardReferenceInputSchema.safeParse({
      ...card.payload,
      input: ["not-object"],
    }).success,
  );
  assert(
    !appCardReferenceInputSchema.safeParse({
      ...card.payload,
      command: "write",
    }).success,
  );
  assert(
    !appCardReferenceInputSchema.safeParse({
      app: "app",
      release: rel,
      view: "summary",
      input: {},
    }).success,
  );
  assert(
    visualBlockInputSchema.safeParse({
      ...card,
      payload: { ...card.payload, input: { when: later, note: "not-scanned" } },
      sources: [{
        kind: "estimate",
        reference: { label: "none" },
        observed_at: null,
      }],
    }).success,
  );
});
