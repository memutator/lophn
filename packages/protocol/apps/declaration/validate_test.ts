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

// event와 구독은 선택 칸이다. 비면 정규형에 칸이 없어 옛 선언의 hash가 그대로이고(event의 across_machines false도 같다),
// 구독 handler 이름(`on.<source>.<event>`)은 operation·command와 한 이름 공간이다.
test("events와 subscriptions는 비면 칸을 두지 않고 payload는 object schema여야 하며 구독 handler 이름은 다른 handler와 겹치지 못하고 across_machines는 sync가 표를 보내야 한다", () => {
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
    [
      "across_machines without sync",
      { events: [{ ...event, across_machines: true }] },
    ],
    [
      "across_machines with an empty sync",
      { events: [{ ...event, across_machines: true }], sync: {} },
    ],
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
    ["empty machine", { subscriptions: [{ ...subscription, machine: "" }] }],
    [
      "machine with surrounding spaces",
      { subscriptions: [{ ...subscription, machine: " laptop" }] },
    ],
    [
      "machine for a lophn event",
      { subscriptions: [{ source: "lophn", event: "x", machine: "laptop" }] },
    ],
    [
      "one source and event on two computers",
      {
        subscriptions: [
          { ...subscription, machine: "laptop" },
          { ...subscription, machine: "desk" },
        ],
      },
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
  // 다른 컴퓨터의 앱 event를 받는 구독은 그 컴퓨터의 이름을 싣는다. 이름이 없는 구독의 정규형은 그대로다.
  const remote = validateDeclaration({
    ...declarationWith([]),
    subscriptions: [{ ...subscription, machine: "my laptop" }],
  });
  assert.ok(remote.ok);
  assert.deepStrictEqual(remote.value.subscriptions, [
    { ...subscription, machine: "my laptop" },
  ]);
  const local = validateDeclaration({
    ...declarationWith([]),
    events: [{ ...event, across_machines: false }],
  });
  const plainEvent = validateDeclaration({
    ...declarationWith([]),
    events: [event],
  });
  assert.ok(local.ok && plainEvent.ok);
  assert.deepStrictEqual(local.value, plainEvent.value);
});

// widgets와 phone.use는 grant가 될 수 있는 것을 선언 검사가 정하는 경계다. widgets 칸이 없는 옛 선언의 hash는 그대로다.
test("phone.use의 scope가 {capability} 하나가 아니거나 모르는 capability면, widgets의 key가 겹치거나 screen이 phone 화면이 아니면 거절한다", () => {
  const phoneScreen = {
    key: "home",
    label: "Home",
    path: "/phone",
    places: ["phone"],
  };
  const tabScreen = { ...phoneScreen, key: "main", places: ["tab"] };
  const widget = { key: "weather", label: "Weather", screen: "home" };
  const phoneUse = {
    kind: "phone.use",
    scope: { capability: "location.get" },
    reason: "Find places nearby.",
  };
  const base = { ...declarationWith([]), screens: [phoneScreen, tabScreen] };

  const rejected: [string, Record<string, unknown>][] = [
    ["empty scope", { permissions: [{ ...phoneUse, scope: {} }] }],
    [
      "unknown capability",
      {
        permissions: [{ ...phoneUse, scope: { capability: "camera.shoot" } }],
      },
    ],
    [
      "extra scope field",
      {
        permissions: [
          {
            ...phoneUse,
            scope: { capability: "location.get", host: "localhost" },
          },
        ],
      },
    ],
    ["same capability twice", { permissions: [phoneUse, { ...phoneUse }] }],
    ["duplicate widget key", { widgets: [widget, { ...widget }] }],
    ["screen is a tab screen", { widgets: [{ ...widget, screen: "main" }] }],
    ["screen does not exist", { widgets: [{ ...widget, screen: "gone" }] }],
    ["bad key", { widgets: [{ ...widget, key: "Weather" }] }],
    ["label too long", { widgets: [{ ...widget, label: "x".repeat(41) }] }],
    [
      "five widgets",
      {
        widgets: ["a", "b", "c", "d", "e"].map((key) => ({ ...widget, key })),
      },
    ],
  ];
  for (const [label, extra] of rejected) {
    const result = validateDeclaration({ ...base, ...extra });
    assert.ok(!result.ok, label);
    assert.equal(result.error.code, "invalid_input", label);
  }

  const accepted = validateDeclaration({
    ...base,
    permissions: [phoneUse],
    widgets: [widget, { key: "plain", label: "Plain" }],
  });
  assert.ok(accepted.ok);
  assert.deepStrictEqual(accepted.value.permissions[0]?.scope, {
    capability: "location.get",
  });
  const plain = validateDeclaration(base);
  const empty = validateDeclaration({ ...base, widgets: [] });
  assert.ok(plain.ok && empty.ok && !("widgets" in plain.value));
  assert.deepStrictEqual(empty.value, plain.value);
});

// runs_on은 앱 backend가 어디서 도는지를 정하는 유일한 칸이다. 칸이 없는 옛 선언의 hash는 그대로다. 옛 release의 봉인한
// 선언에 남은 sync_to는 다시 읽을 때(sealed)만 받는다: 거절하면 켜 둔 옛 release가 뜨지 않는다.
test("runs_on이 정규 꼴이 아니거나 폰 화면 없이 phone이거나 ['phone']에 돌릴 곳 없는 것이 있고, sync가 표 → destination 이름 꼴이 아니거나 destination이 둘 이상이거나 ['phone']과 같이 있으면 거절하고, sync_to는 봉인한 선언에서만 받는다", () => {
  const phoneScreen = {
    key: "home",
    label: "Home",
    path: "/phone",
    places: ["phone"],
  };
  const tabScreen = { ...phoneScreen, key: "main", places: ["tab"] };
  const base = { ...declarationWith([]), screens: [phoneScreen] };
  const phoneOnly = ["phone"];

  const rejected: [string, Record<string, unknown>][] = [
    ["empty", { runs_on: [] }],
    ["duplicate", { runs_on: ["phone", "phone"] }],
    ["other order", { runs_on: ["phone", "computer"] }],
    ["unknown", { runs_on: ["cloud"] }],
    ["not an array", { runs_on: "phone" }],
    ["sync not an object", { sync: "personal" }],
    ["sync value not a name", { sync: { notes: "Personal" } }],
    ["sync value with a path", { sync: { notes: "/home/me/sync" } }],
    ["sync value too long", { sync: { notes: `a${"b".repeat(32)}` } }],
    ["sync value not a string", { sync: { notes: 1 } }],
    ["sync of a lophn table", { sync: { lophn_sync_row: "personal" } }],
    [
      "sync to two destinations",
      { sync: { notes: "computers", archive: "personal" } },
    ],
    [
      "sync on a phone-only app",
      { sync: { notes: "personal" }, runs_on: phoneOnly },
    ],
    ["sync_to in a new declaration", { sync_to: "personal" }],
    [
      "phone without a phone screen",
      { runs_on: phoneOnly, screens: [tabScreen] },
    ],
    [
      "sync without a phone screen",
      { runs_on: ["computer", "phone"], screens: [tabScreen] },
    ],
    ["phone with a command", { runs_on: phoneOnly, commands: [command] }],
    [
      "phone with a subscription",
      { runs_on: phoneOnly, subscriptions: [{ source: "lophn", event: "x" }] },
    ],
    [
      "phone with an external operation",
      {
        runs_on: phoneOnly,
        operations: [{ ...operation, effect: "external" }],
      },
    ],
    [
      "phone with a widget",
      {
        runs_on: phoneOnly,
        widgets: [{ key: "w", label: "W", screen: "home" }],
      },
    ],
    [
      "phone with a tab screen",
      { runs_on: phoneOnly, screens: [phoneScreen, tabScreen] },
    ],
  ];
  for (const [label, extra] of rejected) {
    const result = validateDeclaration({ ...base, ...extra });
    assert.ok(!result.ok, label);
    assert.equal(result.error.code, "invalid_input", label);
  }

  for (const runsOn of [["computer"], ["computer", "phone"], phoneOnly]) {
    const result = validateDeclaration({
      ...base,
      runs_on: runsOn,
      commands: runsOn.length === 1 && runsOn[0] === "phone" ? [] : [command],
    });
    assert.ok(result.ok, JSON.stringify(runsOn));
    assert.deepStrictEqual(result.value.runs_on, runsOn);
  }
  const plain = validateDeclaration(base);
  assert.ok(plain.ok && !("runs_on" in plain.value));
  assert.ok(plain.ok && !("sync" in plain.value));
  const empty = validateDeclaration({ ...base, sync: {} });
  assert.ok(empty.ok);
  assert.deepStrictEqual(empty.value, plain.value);
  for (const runsOn of [undefined, ["computer"], ["computer", "phone"]]) {
    const synced = validateDeclaration({
      ...base,
      ...(runsOn === undefined ? {} : { runs_on: runsOn }),
      sync: { notes: "personal", tags: "personal" },
    });
    assert.ok(synced.ok, JSON.stringify(runsOn));
    assert.deepStrictEqual(synced.value.sync, {
      notes: "personal",
      tags: "personal",
    });
  }
  const sealed = validateDeclaration(
    { ...base, sync_to: "personal" },
    { sealed: true },
  );
  assert.ok(sealed.ok);
  assert.equal(sealed.value.sync_to, "personal");
  assert.ok(
    !validateDeclaration(
      { ...base, sync_to: "personal", sync: { notes: "personal" } },
      { sealed: true },
    ).ok,
  );
});

// fs 경로는 절대 경로이거나 home 기준 `~`·`~/…`다. `~`는 펴지 않고 적힌 대로 저장한다(grant와 동의 글이 그 글자열로 키가 된다).
test("fs 권한 경로는 ~와 ~/…를 적힌 그대로 받고 ~user, ~\\, .. 은 거절한다", () => {
  const withPath = (path: string) =>
    validateDeclaration({
      ...declarationWith([]),
      permissions: [
        {
          kind: "fs.read",
          scope: { path, recursive: true },
          reason: "Read notes.",
        },
      ],
    });
  for (const path of ["~", "~/a/b", "~/.claude/projects", "/home/alice"]) {
    const accepted = withPath(path);
    assert.ok(accepted.ok, path);
    assert.deepStrictEqual(accepted.value.permissions[0]?.scope, {
      path,
      recursive: true,
    });
  }
  for (const path of ["~user/a", "~\\a", "~/a/../b", "~/./a", "a/b", ""]) {
    assert.ok(!withPath(path).ok, path);
  }
});
