import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import {
  agentMessageContentInputSchema,
  machineMessageContentInputSchema,
  MESSAGE_VISUAL_MAX_BYTES,
  MESSAGE_VISUAL_MAX_COUNT,
  messageContentInputSchema,
  messageContentSchema,
  textMessageContentSchema,
  userMessageContentInputSchema,
} from "./message-content.ts";
import { app, chartBlock, rel, tableBlock } from "./message-fixtures.ts";

const text = {
  schema_version: 1,
  parts: [{ kind: "text", text: "hello" }],
};

function sized(bytes: number) {
  const prefix = canonicalize({
    ...tableBlock,
    sources: [{
      ...tableBlock.sources[0],
      reference: { ...tableBlock.sources[0].reference, section: "" },
    }],
  });
  const room = bytes - new TextEncoder().encode(prefix).length;
  return {
    ...tableBlock,
    sources: [{
      ...tableBlock.sources[0],
      reference: {
        ...tableBlock.sources[0].reference,
        section: "x".repeat(room),
      },
    }],
  };
}

Deno.test("lophn-agent/conversation#R12: text and visual parts keep their order", () => {
  const content = {
    schema_version: 1,
    parts: [
      { kind: "text", text: "before" },
      { kind: "visual", block: tableBlock },
      { kind: "text", text: "after" },
      { kind: "visual", block: chartBlock },
    ],
  };
  const parsed = messageContentSchema.parse(content);
  assertEquals(parsed.parts.map((part) => part.kind), [
    "text",
    "visual",
    "text",
    "visual",
  ]);
  assert(textMessageContentSchema.safeParse(text).success);
  assert(
    textMessageContentSchema.safeParse({
      ...text,
      source: "legacy-text",
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R13: only an agent input may mix visuals", () => {
  const mixed = {
    schema_version: 1,
    parts: [{ kind: "text", text: "see" }, {
      kind: "visual",
      block: tableBlock,
    }],
  };
  assert(agentMessageContentInputSchema.safeParse(mixed).success);
  assert(userMessageContentInputSchema.safeParse(text).success);
  assert(machineMessageContentInputSchema.safeParse(text).success);
  assert(!userMessageContentInputSchema.safeParse(mixed).success);
  assert(!machineMessageContentInputSchema.safeParse(mixed).success);
  assert(
    !messageContentInputSchema.safeParse({
      ...mixed,
      parts: [],
    }).success,
  );
  assert(
    !messageContentInputSchema.safeParse({
      schema_version: 1,
      parts: [{ kind: "text", text: "x", html: "<b>" }],
    }).success,
  );
  assert(
    !messageContentInputSchema.safeParse({
      schema_version: 2,
      parts: [{ kind: "text", text: "x" }],
    }).success,
  );
});

Deno.test("lophn-agent/visuals#R3: eight blocks and 262144 canonical bytes are all or nothing", () => {
  assertEquals(MESSAGE_VISUAL_MAX_COUNT, 8);
  assertEquals(MESSAGE_VISUAL_MAX_BYTES, 262144);
  const eight = {
    schema_version: 1,
    parts: Array.from({ length: 8 }, (_, index) => ({
      kind: "visual",
      block: { ...tableBlock, key: `k${index}` },
    })),
  };
  assert(messageContentInputSchema.safeParse(eight).success);
  assert(
    !messageContentInputSchema.safeParse({
      ...eight,
      parts: [...eight.parts, {
        kind: "visual",
        block: { ...tableBlock, key: "k8" },
      }],
    }).success,
  );
  assert(
    !messageContentInputSchema.safeParse({
      schema_version: 1,
      parts: [
        { kind: "visual", block: tableBlock },
        { kind: "visual", block: tableBlock },
      ],
    }).success,
  );
  assert(
    messageContentSchema.safeParse({
      schema_version: 1,
      parts: [{ kind: "visual", block: sized(MESSAGE_VISUAL_MAX_BYTES) }],
    }).success,
  );
  assert(
    !messageContentSchema.safeParse({
      schema_version: 1,
      parts: [{ kind: "visual", block: sized(MESSAGE_VISUAL_MAX_BYTES + 1) }],
    }).success,
  );
  assert(
    !messageContentSchema.safeParse({
      schema_version: 1,
      parts: [{
        kind: "visual",
        block: { ...tableBlock, title: "bad\uD800" },
      }],
    }).success,
  );
});

function ownKeyBlock(key: string, value: string) {
  return {
    ...tableBlock,
    key,
    payload: {
      columns: [{ key: "__proto__", label: "kept", type: "string" }],
      rows: [JSON.parse(`{"__proto__":${JSON.stringify(value)}}`)],
    },
  };
}

function ownKeySized(key: string, bytes: number) {
  const overhead = new TextEncoder().encode(
    canonicalize(ownKeyBlock(key, "")),
  ).length;
  return ownKeyBlock(key, "x".repeat(bytes - overhead));
}

Deno.test("lophn-agent/visuals#R3: own JSON cells cannot bypass exact canonical byte bounds", () => {
  const limit = MESSAGE_VISUAL_MAX_BYTES;
  const first = ownKeySized("first", limit / 2);
  const cases = [
    { blocks: [ownKeySized("single", limit)], accepted: true },
    { blocks: [ownKeySized("single", limit + 1)], accepted: false },
    { blocks: [first, ownKeySized("second", limit / 2)], accepted: true },
    { blocks: [first, ownKeySized("second", limit / 2 + 1)], accepted: false },
    { blocks: [ownKeyBlock("exploit", "x".repeat(limit))], accepted: false },
  ];
  for (const { blocks, accepted } of cases) {
    const rawBytes = blocks.reduce(
      (sum, block) =>
        sum + new TextEncoder().encode(canonicalize(block)).length,
      0,
    );
    assertEquals(rawBytes <= limit, accepted);
    const content = {
      schema_version: 1,
      parts: blocks.map((block) => ({ kind: "visual", block })),
    };
    for (const schema of [messageContentInputSchema, messageContentSchema]) {
      const parsed = schema.safeParse(content);
      assertEquals(parsed.success, accepted);
      if (!parsed.success) continue;
      const parsedBytes = parsed.data.parts.reduce(
        (sum, part) =>
          sum +
          (part.kind === "visual"
            ? new TextEncoder().encode(canonicalize(part.block)).length
            : 0),
        0,
      );
      assertEquals(parsedBytes, rawBytes);
      assertEquals(canonicalize(parsed.data), canonicalize(content));
    }
  }
});

Deno.test("lophn-agent/visuals#R3: own prototype keys stay in canonical bytes", () => {
  const row = JSON.parse('{"__proto__":"kept","name":"a"}');
  const table = {
    ...tableBlock,
    payload: {
      columns: [
        { key: "name", label: "name", type: "string" },
        { key: "__proto__", label: "kept", type: "string" },
      ],
      rows: [row],
    },
  };
  const parsedTable = messageContentInputSchema.parse({
    schema_version: 1,
    parts: [{ kind: "visual", block: table }],
  });
  const tablePart = parsedTable.parts[0];
  if (tablePart.kind !== "visual" || tablePart.block.kind !== "table") {
    throw new Error("expected table");
  }
  assertEquals(tablePart.block.payload.rows[0], row);
  assertEquals(
    canonicalize(tablePart.block),
    canonicalize(table),
  );
  const input = JSON.parse('{"__proto__":{"kept":true},"n":1}');
  const card = {
    key: "card",
    schema_version: 1,
    kind: "app_card",
    title: "card",
    description: "fixed view",
    sources: [],
    payload: { app, release: rel, view: "summary", input },
  };
  const parsedCard = messageContentInputSchema.parse({
    schema_version: 1,
    parts: [{ kind: "visual", block: card }],
  });
  const cardPart = parsedCard.parts[0];
  if (cardPart.kind !== "visual" || cardPart.block.kind !== "app_card") {
    throw new Error("expected app card");
  }
  assertEquals(cardPart.block.payload.input, input);
  assertEquals(canonicalize(cardPart.block), canonicalize(card));
});
