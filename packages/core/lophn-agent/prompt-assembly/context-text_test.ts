import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildContextText,
  type ContextRead,
  renderContextText,
} from "./context-text.ts";

const read: ContextRead = {
  name: "eval",
  version: 3,
  purpose: "Keep experiments findable.",
  project: {
    name: "phroner",
    purpose: "Evaluate the harness loop.",
    folders: [
      { path: "/work/b", description: "B code" },
      { path: "/work/a", description: "A code" },
    ],
    subfolders: [{ path: "eval/", description: "Runs" }],
  },
  types: [
    {
      name: "Scenario",
      summary: "one scenario",
      fields: [{ name: "tags" }, { name: "stages" }],
      relations: [],
    },
    {
      name: "Experiment",
      summary: "one experiment",
      fields: [{ name: "status" }, { name: "question" }],
      relations: [
        { label: "runs on", to: "Scenario", cardinality: "many" },
        { label: "checks", to: "harness/Change", cardinality: "optional" },
      ],
    },
  ],
  searches: [
    { name: "b_search", title: "B", inputs: [] },
    {
      name: "a_search",
      title: "A",
      inputs: [{ name: "kind", required: false }, {
        name: "change",
        required: true,
      }],
    },
  ],
  glossary: [{ term: "z", meaning: "last" }, { term: "a", meaning: "first" }],
};

function shuffled(r: ContextRead): ContextRead {
  return {
    ...r,
    project: {
      ...r.project,
      folders: [...r.project.folders].reverse(),
    },
    types: [...r.types].reverse().map((t) => ({
      ...t,
      fields: [...t.fields].reverse(),
      relations: [...t.relations].reverse(),
    })),
    searches: [...r.searches].reverse().map((s) => ({
      ...s,
      inputs: [...s.inputs].reverse(),
    })),
    glossary: [...r.glossary].reverse(),
  };
}

Deno.test("context 글이 같은 판에서 입력 순서와 상관없이 바이트까지 같다", () => {
  const first = renderContextText(buildContextText(read), "full");
  assertEquals(first, renderContextText(buildContextText(read), "full"));
  assertEquals(
    first,
    renderContextText(buildContextText(shuffled(read)), "full"),
  );
  assertNotEquals(
    first,
    renderContextText(buildContextText({ ...read, version: 4 }), "full"),
  );
});
