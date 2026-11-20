import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMermaid } from "./mermaid.ts";

test("parseMermaid parses flowchart nodes, shapes and labeled edges", () => {
  const diagram = parseMermaid(`
    flowchart LR
      A[Phone] -->|sync| B{Online?}
      B -->|yes| C(Computer)
      B -.->|no| D[Outbox]
  `);
  assert.ok(diagram !== null && diagram.kind === "flowchart");
  assert.equal(diagram.direction, "LR");
  assert.deepEqual(
    diagram.nodes.map((n) => [n.id, n.label, n.shape]),
    [
      ["A", "Phone", "rect"],
      ["B", "Online?", "diamond"],
      ["C", "Computer", "round"],
      ["D", "Outbox", "rect"],
    ],
  );
  assert.equal(diagram.edges.length, 3);
  assert.deepEqual(diagram.edges[0], { from: "A", to: "B", label: "sync" });
  assert.deepEqual(diagram.edges[2], {
    from: "B",
    to: "D",
    label: "no",
    dashed: true,
  });
});

test("parseMermaid parses sequenceDiagram and stateDiagram-v2, and returns null for unsupported diagrams", () => {
  const seq = parseMermaid(`
    sequenceDiagram
      participant P as Phone
      participant C as Core
      P->>C: app_sync/push
      C-->>P: seq 42
  `);
  assert.ok(seq !== null && seq.kind === "sequence");
  assert.deepEqual(seq.participants, ["Phone", "Core"]);
  assert.deepEqual(seq.steps, [
    { from: "Phone", to: "Core", label: "app_sync/push", dashed: false },
    { from: "Core", to: "Phone", label: "seq 42", dashed: true },
  ]);

  const state = parseMermaid(`
    stateDiagram-v2
      [*] --> Idle
      Idle --> Working : message
  `);
  assert.ok(state !== null && state.kind === "state");
  assert.equal(state.edges.length, 2);

  assert.equal(parseMermaid('pie title Pets\n "Dogs" : 386'), null);
});
