import { assert, assertEquals } from "@std/assert";
import { defineBlueprint } from "./define.ts";
import { APP, blueprint, command, document, OTHER, screen } from "./fixture.ts";
import { sameVerdict } from "./judge.ts";
import {
  type BlueprintOptions,
  type InputSchema,
  validateBlueprint,
} from "./mod.ts";

function expectOk(
  value: unknown,
  expectedOk: boolean,
  options?: BlueprintOptions,
  message?: string,
) {
  assertEquals(validateBlueprint(value, options).ok, expectedOk);
  sameVerdict(
    value,
    expectedOk,
    options,
    message === undefined ? undefined : { message },
  );
}

Deno.test("apps/blueprint#R15: screen과 command의 key는 label과 분리된다", () => {
  const first = blueprint({
    screens: [screen({ key: "home", label: "Home" })],
    commands: [
      command("undo", "write", {
        label: "Undo",
        revert: { supported: false },
      }),
      command("save", "write", { label: "Save" }),
    ],
  });
  const renamed = blueprint({
    screens: [screen({ key: "home", label: "Calendar home" })],
    commands: [
      command("undo", "write", {
        label: "Revert save",
        revert: { supported: false },
      }),
      command("save", "write", { label: "Write calendar" }),
    ],
  });
  expectOk(first, true);
  expectOk(renamed, true);
  const left = defineBlueprint(first);
  const right = defineBlueprint(renamed);
  assertEquals(
    left.screens.map((item) => item.key),
    right.screens.map((item) => item.key),
  );
  assertEquals(
    left.commands.map((item) => item.key),
    right.commands.map((item) => item.key),
  );
  assert(left.screens[0]?.label !== right.screens[0]?.label);
  assert(left.commands[0]?.label !== right.commands[0]?.label);
});

Deno.test("apps/blueprint#R16: 같은 corpus에서 작성형과 정본 판정이 같고 network·model 없이 돈다", () => {
  const duplicatedCommands = blueprint({
    commands: [
      command("save", "write", { revert: { supported: false } }),
      command("again", "write", { revert: { supported: false } }),
      command("again", "write", { revert: { supported: false } }),
    ],
  });
  const duplicatedScreens = blueprint({
    screens: [screen(), screen({ path: "/other" })],
  });
  const accepted = [
    blueprint(),
    blueprint({ screens: [screen({ sizes: ["panel", "card"] })] }),
    {
      ...duplicatedCommands,
      commands: [
        duplicatedCommands.commands[0],
        duplicatedCommands.commands[1],
      ],
    },
    {
      ...duplicatedScreens,
      screens: [duplicatedScreens.screens[0]],
    },
  ];
  const rejected: Array<[unknown, string]> = [
    [{ ...blueprint(), context: [] }, "blueprint unknown field context"],
    [
      blueprint({ screens: [screen({ sizes: [] })] }),
      "screen sizes must be nonempty",
    ],
    [
      blueprint({
        commands: [command("lookup", "read", {
          revert: { supported: true, command: "undo" },
        })],
      }),
      "read and external revert cannot be supported",
    ],
    [duplicatedCommands, "duplicate command"],
    [duplicatedScreens, "duplicate screen"],
  ];
  for (const value of accepted) {
    assertEquals(validateBlueprint(value).ok, true);
    expectOk(value, true);
  }
  for (const [value, message] of rejected) {
    assertEquals(validateBlueprint(value).ok, false);
    expectOk(value, false, undefined, message);
  }
  assertEquals(
    Object.keys(defineBlueprint(blueprint())).sort(),
    [
      "agent_context",
      "app_connections",
      "automatic_tasks",
      "commands",
      "description",
      "documents",
      "name",
      "permissions",
      "problem_codes",
      "screens",
      "sdk_dependencies",
    ],
  );
});

Deno.test("apps/blueprint#R18: 순서만 다른 작성형은 같은 정규 JSON이고 옛 context는 거절한다", () => {
  const first = defineBlueprint(blueprint({
    screens: [screen(), screen({ key: "week", label: "Week", path: "/week" })],
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write"),
      command("lookup", "read"),
    ],
  }));
  const reversed = defineBlueprint({
    sdk_dependencies: [],
    app_connections: [],
    agent_context: [],
    documents: [],
    problem_codes: [],
    permissions: [],
    automatic_tasks: [],
    commands: [
      command("lookup", "read"),
      command("save", "write"),
      command("undo", "write", { revert: { supported: false } }),
    ],
    screens: [
      screen({ key: "week", label: "Week", path: "/week" }),
      screen(),
    ],
    description: "Keeps one calendar",
    name: "Calendar",
  });
  assertEquals(JSON.stringify(first), JSON.stringify(reversed));
  assertEquals(
    first.commands.map((item) => item.key),
    ["lookup", "save", "undo"],
  );
  expectOk({ ...blueprint(), context: { screen: "home" } }, false);
  const legacy = validateBlueprint({ ...blueprint(), context: [] });
  assert(!legacy.ok);
  assert(legacy.ok === false && legacy.error.message.includes("context"));
});

Deno.test("apps/blueprint#R19: sizes가 비어 있거나 중복이면 거절한다", () => {
  expectOk(
    blueprint({ screens: [screen({ sizes: ["full", "panel"] })] }),
    true,
  );
  expectOk(
    blueprint({ screens: [screen({ sizes: [] })] }),
    false,
    undefined,
    "screen sizes must be nonempty",
  );
  const duplicated = blueprint({
    screens: [screen({ sizes: ["card", "card"] })],
  });
  expectOk(duplicated, false, undefined, "screen sizes are duplicated");
  const isolated = blueprint({ screens: [screen({ sizes: ["card"] })] });
  assertEquals(validateBlueprint(isolated).ok, true);
  expectOk(isolated, true);
});

Deno.test("apps/blueprint#R20: command와 input description이 비면 거절하고 blueprint에서 tool 계약을 찾는다", () => {
  const input: InputSchema = {
    type: "object",
    description: "calendar day",
    properties: {
      day: { type: "string", description: "ISO day", minLength: 10 },
    },
    required: ["day"],
    additionalProperties: false,
  };
  const value = blueprint({
    commands: [
      command("undo", "write", { revert: { supported: false } }),
      command("save", "write", {
        description: "Save one calendar day",
        confirm: true,
        input,
      }),
    ],
  });
  expectOk(value, true);
  const defined = defineBlueprint(value);
  const tool = defined.commands.find((item) => item.key === "save");
  assertEquals(tool?.description, "Save one calendar day");
  assertEquals(tool?.effect, "write");
  assertEquals(tool?.confirm, true);
  assertEquals(tool?.input?.required, ["day"]);
  assertEquals(tool?.input?.properties?.day.description, "ISO day");

  for (const description of ["", "   "]) {
    expectOk(
      blueprint({
        commands: [
          command("undo", "write", { revert: { supported: false } }),
          command("save", "write", { description }),
        ],
      }),
      false,
    );
    expectOk(
      blueprint({
        commands: [
          command("undo", "write", { revert: { supported: false } }),
          command("save", "write", {
            input: {
              type: "object",
              description,
              properties: { day: { type: "string", description: "ISO day" } },
              additionalProperties: false,
            },
          }),
        ],
      }),
      false,
    );
    expectOk(
      blueprint({
        commands: [
          command("undo", "write", { revert: { supported: false } }),
          command("save", "write", {
            input: {
              type: "object",
              properties: { day: { type: "string", description } },
              additionalProperties: false,
            },
          }),
        ],
      }),
      false,
    );
    expectOk(
      blueprint({
        commands: [
          command("undo", "write", { revert: { supported: false } }),
          command("save", "write", {
            input: {
              type: "array",
              items: { type: "string", description },
            },
          }),
        ],
      }),
      false,
    );
  }
});

Deno.test("apps/blueprint#R21: revert 누락, read·external의 supported=true, 없는 되돌림 command를 거절한다", () => {
  const base = blueprint().commands;
  const save = { ...base[1]! };
  delete (save as { revert?: unknown }).revert;
  expectOk({ ...blueprint(), commands: [base[0]!, save] }, false);
  expectOk(
    blueprint({
      commands: [command("lookup", "read", {
        revert: { supported: true, command: "undo" },
      })],
    }),
    false,
  );
  expectOk(
    blueprint({
      commands: [command("send", "external", {
        revert: { supported: true, command: "undo" },
      })],
    }),
    false,
  );
  expectOk(
    blueprint({
      commands: [
        command("undo", "write", { revert: { supported: false } }),
        command("save", "write", {
          revert: { supported: true, command: "missing" },
        }),
      ],
    }),
    false,
  );
  expectOk(
    blueprint({
      commands: [command("save", "write", {
        revert: { supported: true, command: "save" },
      })],
    }),
    false,
  );
  expectOk(
    blueprint({
      commands: [command("save", "write", {
        revert: { supported: false, command: "undo" },
      })],
    }),
    false,
  );
  const accepted = defineBlueprint(blueprint());
  assertEquals(accepted.commands.find((item) => item.key === "save")?.revert, {
    supported: true,
    command: "undo",
  });
});

Deno.test("apps/blueprint#R22: app_connections와 agent_context의 잘못된 자리와 옛 context를 거절한다", () => {
  const home = screen();
  const lookup = command("lookup", "read");
  const note = command("note", "write", { revert: { supported: false } });
  const context = {
    screen: "home",
    read_command: "lookup",
    sensitive_paths: ["/secret"],
    annotation_targets: [{
      key: "hint",
      label: "Hint",
      write_command: "note",
    }],
  };
  const valid = blueprint({
    screens: [home],
    commands: [lookup, note],
    agent_context: [context],
    app_connections: [{
      app: OTHER,
      commands: ["save"],
      reason: "reuse save",
    }],
    documents: [document()],
  });
  expectOk(valid, true, { app: APP });
  expectOk(
    blueprint({
      app_connections: [{ app: "calendar", commands: ["save"], reason: "x" }],
    }),
    false,
    { app: APP },
  );
  expectOk(
    blueprint({
      app_connections: [{ app: APP, commands: ["save"], reason: "self" }],
    }),
    false,
    { app: APP },
  );
  expectOk(
    blueprint({
      app_connections: [{ app: OTHER, commands: ["save*"], reason: "wild" }],
    }),
    false,
  );
  expectOk(
    blueprint({
      screens: [home],
      commands: [lookup, note],
      agent_context: [{ ...context, screen: "missing" }],
    }),
    false,
  );
  expectOk(
    blueprint({
      screens: [home],
      commands: [lookup, note],
      agent_context: [{ ...context, read_command: "note" }],
    }),
    false,
  );
  expectOk(
    blueprint({
      screens: [home],
      commands: [lookup, note],
      agent_context: [{
        ...context,
        annotation_targets: [{
          key: "hint",
          label: "Hint",
          write_command: "lookup",
        }],
      }],
    }),
    false,
  );
  expectOk({ ...valid, context: [] }, false, { app: APP });
});
