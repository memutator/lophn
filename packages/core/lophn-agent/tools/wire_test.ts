import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";
import { KIND_TOOLS } from "../../agent-places/tools/kind.ts";
import { defineTool } from "./define.ts";
import { inputJsonSchema, normalizeTypeArrays } from "./wire.ts";

// Gemini Schema는 type에 문자열 하나만 받는다. Zod의 union이 만드는 타입 배열이 anyOf 안에
// 중첩된 채로 나가면 AI Studio가 400으로 거절한다. 정규화가 깊이와 무관하게 펴는지 본다.
function typeArraysIn(value: unknown): string[] {
  const found: string[] = [];
  (function walk(node: unknown, path: string) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const entry = node as Record<string, unknown>;
    if (Array.isArray(entry["type"])) found.push(path);
    for (const [key, child] of Object.entries(entry)) {
      walk(child, `${path}.${key}`);
    }
  })(value, "$");
  return found;
}

// 스키마 노드를 key로 찾는다. 테스트가 실패 지점을 이름으로 짚을 수 있게 한다.
function child(node: unknown, key: string | number): unknown {
  if (typeof node !== "object" || node === null) return undefined;
  return (node as Record<string | number, unknown>)[key];
}

test("타입 배열은 anyOf로 펴지고 null은 nullable이 된다", () => {
  assert.deepEqual(normalizeTypeArrays({ type: ["string", "number"] }), {
    anyOf: [{ type: "string" }, { type: "number" }],
  });
  assert.deepEqual(normalizeTypeArrays({ type: ["string", "null"] }), {
    type: "string",
    nullable: true,
  });
  assert.deepEqual(normalizeTypeArrays({ type: ["string"] }), {
    type: "string",
  });
});

// 실제로 400을 만들었던 모양이다: where.anyOf[0].properties.value 안의 타입 배열.
test("anyOf 안에 중첩된 타입 배열도 편다", () => {
  const normalized = normalizeTypeArrays({
    type: "object",
    properties: {
      where: {
        anyOf: [
          {
            type: "object",
            properties: {
              field: { type: "string" },
              value: {
                anyOf: [
                  { type: ["string", "number", "boolean"] },
                  {
                    type: "array",
                    items: { type: ["string", "number", "boolean"] },
                  },
                ],
              },
            },
            required: ["field"],
          },
          { type: "object", properties: { all: { type: "array" } } },
        ],
      },
    },
  });

  assert.deepEqual(typeArraysIn(normalized), []);
  const value = child(
    child(child(child(normalized, "properties"), "where"), "anyOf"),
    0,
  );
  const valueNode = child(child(value, "properties"), "value");
  assert.deepEqual(child(child(valueNode, "anyOf"), 0), {
    anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
  });
  assert.deepEqual(child(child(child(valueNode, "anyOf"), 1), "items"), {
    anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
  });
});

test("정규화는 입력을 바꾸지 않는다", () => {
  const schema = { type: ["string", "number"] };
  const snapshot = JSON.stringify(schema);
  normalizeTypeArrays(schema);
  assert.equal(JSON.stringify(schema), snapshot);
});

// 손으로 만든 inputSchema를 넘기는 툴도 model로 나가므로 같은 정규화를 거쳐야 한다.
test("선언한 inputSchema도 정규화한다", () => {
  const tool = defineTool({
    name: "probe",
    description: "probe",
    effect: "read",
    input: z.strictObject({ target: z.string() }),
    inputSchema: {
      type: "object",
      properties: { target: { type: ["string", "number"] } },
    },
    routes: [],
    handler: () => Promise.reject(new Error("not called")),
  });
  assert.deepEqual(typeArraysIn(inputJsonSchema(tool)), []);
});

// 이 저장소에서 실제로 400을 낸 툴이다. where의 value가 타입 배열로 나가면 안 된다.
test("kind.list의 where가 타입 배열을 싣지 않는다", () => {
  const list = KIND_TOOLS.find((tool) => tool.name === "kind.list");
  assert.ok(list !== undefined, "kind.list is missing");
  const schema = inputJsonSchema(list);
  assert.deepEqual(typeArraysIn(schema), []);
});
