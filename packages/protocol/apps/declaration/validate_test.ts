import assert from "node:assert/strict";
import { test } from "node:test";

import { type CommandDeclaration, validateDeclaration } from "./mod.ts";

const command = {
  name: "list_items",
  description: "Lists the items.",
  inputSchema: null,
  effect: "read",
  domain: "items",
  public: false,
};
const operation = { name: "items.page", title: "Items page", effect: "read" };
const objectSchema = {
  type: "object",
  properties: { id: { type: "string", description: "item id" } },
  required: ["id"],
};

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
    ["missing domain", [{ ...command, domain: undefined }]],
    ["domain not a slug", [{ ...command, domain: "Items_1" }]],
    ["reserved domain", [{ ...command, domain: "file" }]],
    [
      "same agent tool name",
      [
        { ...command, name: "event.list" },
        { ...command, name: "event_list" },
      ],
    ],
    [
      "agent tool name too long",
      [{ ...command, domain: "items", name: "a".repeat(60) }],
    ],
    ["operation description", [], [{ ...operation, description: "x" }]],
    ["operation without effect", [], [{ ...operation, effect: undefined }]],
    ["operation without title", [], [{ ...operation, title: " " }]],
  ];
  for (const [label, commands, operations] of rejected) {
    const result = validateDeclaration(declarationWith(commands, operations));
    assert.ok(!result.ok, label);
    assert.deepStrictEqual(result.error.code, "invalid_input", label);
  }

  const outside = validateDeclaration(declarationWith([command]), {
    domains: ["other"],
  });
  assert.ok(!outside.ok);
  assert.deepStrictEqual(
    outside.error.message,
    "command list_items domain items is not a domain of this app",
  );
  assert.ok(
    validateDeclaration(declarationWith([command]), { domains: ["items"] }).ok,
  );

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
test("icon 선언은 bundle 안 svg·png·webp 경로만 받고 없으면 칸을 두지 않는다", () => {
  for (const icon of [
    "icon.svg",
    "/a/../icon.svg",
    "//host/icon.svg",
    "https://example.test/icon.svg",
    "/icon.gif",
    "/icon",
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
  const without = validateDeclaration(declarationWith([]));
  assert.ok(without.ok && !("icon" in without.value));
});
