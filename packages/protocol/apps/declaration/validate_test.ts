import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CommandDeclaration,
  handlerNames,
  validateDeclaration,
} from "./mod.ts";

const command = {
  name: "list_items",
  description: "Lists the items.",
  inputSchema: null,
  effect: "read",
  public: false,
};
const operation = { name: "items.page", title: "Items page", effect: "read" };
const objectSchema = {
  type: "object",
  properties: { id: { type: "string", description: "item id" } },
  required: ["id"],
};

test("CLI 이름이나 flag가 겹친 선언은 slug 없이도 거절하고 서로 다른 이름은 유지한다", () => {
  const field = (type = "string") => ({ type, description: "A value." });
  const rejected = [
    [
      { ...command, name: "add_event" },
      { ...command, name: "add-event" },
    ],
    [
      {
        ...command,
        inputSchema: {
          type: "object",
          properties: { start_time: field(), "start-time": field() },
        },
      },
    ],
    [
      {
        ...command,
        inputSchema: {
          type: "object",
          properties: { enabled: field("boolean"), no_enabled: field() },
        },
      },
    ],
  ];
  for (const commands of rejected) {
    for (const options of [undefined, { slug: "items" }]) {
      const result = validateDeclaration(declarationWith(commands), options);
      assert.ok(!result.ok);
      assert.equal(result.error.code, "invalid_input");
    }
  }
  const result = validateDeclaration(
    declarationWith([
      { ...command, name: "add_event", inputSchema: objectSchema },
      { ...command, name: "quota.list" },
    ]),
  );
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.commands.map((item) => item.name),
    ["add_event", "quota.list"],
  );
  assert.deepEqual(result.value.commands[0].inputSchema, {
    ...objectSchema,
    additionalProperties: false,
  });
});

function declarationWith(commands: unknown[], operations: unknown[] = []) {
  return {
    name: "Items",
    description: "Keeps items.",
    screens: [],
    operations,
    commands,
    permissions: [],
    app_connections: [],
    sdk_dependencies: [],
  };
}

// 선언 검사는 handler 이름 공간(operation과 command가 하나)과 command의 이름 노출 규칙을 정한다.
test("선언은 이름 규칙, object root, 합친 이름의 중복, 알 수 없는 칸을 거절하고 올바른 선언만 정규형이 된다", () => {
  const rejected: [string, unknown[], unknown[]?][] = [
    ["space in name", [{ ...command, name: "list items" }]],
    ["comma in name", [{ ...command, name: "a,b" }]],
    ["name too long", [{ ...command, name: "a".repeat(65) }]],
    ["empty name", [{ ...command, name: "" }]],
    ["duplicate name", [command, { ...command }]],
    [
      "operation and command share a name",
      [command],
      [{ ...operation, name: command.name }],
    ],
    [
      "array input root",
      [
        {
          ...command,
          inputSchema: { type: "array", items: { type: "string" } },
        },
      ],
    ],
    ["output schema", [{ ...command, outputSchema: { type: "object" } }]],
    ["command title", [{ ...command, title: "List" }]],
    ["missing public", [{ ...command, public: undefined }]],
    ["domain field", [{ ...command, domain: "items" }]],
    [
      "same agent tool name",
      [
        { ...command, name: "event.list" },
        { ...command, name: "event_list" },
      ],
    ],
    ["agent tool name too long", [{ ...command, name: "a".repeat(60) }]],
    ["operation description", [], [{ ...operation, description: "x" }]],
    ["operation without effect", [], [{ ...operation, effect: undefined }]],
    ["operation without title", [], [{ ...operation, title: " " }]],
  ];
  for (const [label, commands, operations] of rejected) {
    const result = validateDeclaration(declarationWith(commands, operations), {
      slug: "items",
    });
    assert.ok(!result.ok, label);
    assert.deepStrictEqual(result.error.code, "invalid_input", label);
  }

  // operation끼리는 agent tool 이름이 겹쳐도 된다. agent에게 보이지 않는다.
  const accepted = validateDeclaration(
    declarationWith(
      [
        {
          ...command,
          name: "add.item-1_x",
          effect: "external",
          public: true,
          inputSchema: objectSchema,
        },
        command,
      ],
      [operation, { ...operation, name: "items_page" }],
    ),
  );
  assert.ok(accepted.ok);
  const commands: CommandDeclaration[] = accepted.value.commands;
  assert.deepStrictEqual(
    commands.map((item) => item.name),
    ["add.item-1_x", "list_items"],
  );
  assert.deepStrictEqual(
    accepted.value.operations.map((item) => item.name),
    ["items.page", "items_page"],
  );
});

// icon은 선택 칸이다. 없는 선언의 정규형은 그대로이고, 이미지 경로가 아니면 거절한다.
test("icon 선언은 bundle 안 svg·png·webp 경로나 lucide:<kebab-case 이름>만 받고 없으면 칸을 두지 않는다", () => {
  for (const icon of [
    "icon.svg",
    "/a/../icon.svg",
    "//host/icon.svg",
    "https://example.test/icon.svg",
    "/icon.gif",
    "/icon",
    "lucide:",
    "lucide:FolderKanban",
    "lucide:folder_kanban",
    "lucide:folder kanban",
    "lucide:-folder",
    5,
  ]) {
    const result = validateDeclaration({ ...declarationWith([]), icon });
    assert.ok(!result.ok, String(icon));
  }
  const withIcon = validateDeclaration({
    ...declarationWith([]),
    icon: "/assets/icon.webp",
  });
  assert.ok(withIcon.ok && withIcon.value.icon === "/assets/icon.webp");
  const withLucide = validateDeclaration({
    ...declarationWith([]),
    icon: "lucide:folder-kanban",
  });
  assert.ok(withLucide.ok && withLucide.value.icon === "lucide:folder-kanban");
  const without = validateDeclaration(declarationWith([]));
  assert.ok(without.ok && !("icon" in without.value));
});

// event와 구독은 선택 칸이다. 비면 정규형에 칸이 없어 옛 선언의 hash가 그대로이고, 구독 handler 이름
// (`on.<source>.<event>`)은 operation·command와 한 이름 공간이다.
test("events와 subscriptions는 비면 칸을 두지 않고 payload는 object schema여야 하며 구독 handler 이름은 다른 handler와 겹치지 못한다", () => {
  const event = {
    name: "usage.limit",
    description: "A limit was reached.",
    payloadSchema: objectSchema,
  };
  const subscription = { source: "masup", event: "usage.limit" };
  const plain = validateDeclaration(declarationWith([]));
  const empty = validateDeclaration({
    ...declarationWith([]),
    events: [],
    subscriptions: [],
  });
  assert.ok(plain.ok && empty.ok);
  assert.deepStrictEqual(empty.value, plain.value);

  const rejected: [string, Record<string, unknown>][] = [
    [
      "payload not an object",
      { events: [{ ...event, payloadSchema: { type: "string" } }] },
    ],
    ["duplicate event", { events: [event, { ...event }] }],
    ["event without description", { events: [{ ...event, description: " " }] }],
    ["bad source", { subscriptions: [{ ...subscription, source: "Mas up" }] }],
    [
      "duplicate subscription",
      { subscriptions: [subscription, { ...subscription }] },
    ],
    ["unknown field", { subscriptions: [{ ...subscription, handler: "x" }] }],
    [
      "handler name taken by a command",
      {
        subscriptions: [subscription],
        commands: [{ ...command, name: "on.masup.usage.limit" }],
      },
    ],
    [
      "handler name too long",
      { subscriptions: [{ source: "masup", event: "e".repeat(60) }] },
    ],
  ];
  for (const [label, extra] of rejected) {
    const result = validateDeclaration({ ...declarationWith([]), ...extra });
    assert.ok(!result.ok, label);
  }

  const accepted = validateDeclaration({
    ...declarationWith([]),
    events: [event],
    subscriptions: [subscription, { source: "lophn", event: "session.idle" }],
  });
  assert.ok(accepted.ok);
  assert.deepStrictEqual(handlerNames(accepted.value), [
    "on.lophn.session.idle",
    "on.masup.usage.limit",
  ]);
});
