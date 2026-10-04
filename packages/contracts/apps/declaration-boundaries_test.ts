import { assert, assertEquals } from "@std/assert";
import {
  agentContextDeclarationSchema,
  annotationWriteInputSchema,
  PACKAGE_KINDS,
  packageSchema,
  permissionRequirementSchema,
  permissionScopeSchema,
  validateBlueprint,
} from "./mod.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const OTHER = "app_01bryz6s41s4z4k7p41s4z4k7p";
const DOCUMENT = "doc_01aryz6s41s4z4k7p41s4z4k7p";

function command(extra: Record<string, unknown> = {}) {
  return {
    key: "lookup",
    label: "Lookup",
    description: "Reads one account",
    effect: "read",
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  };
}

function blueprint(extra: Record<string, unknown> = {}) {
  return {
    name: "Calendar",
    description: "Keeps one calendar",
    screens: [],
    commands: [command()],
    automatic_tasks: [],
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
    ...extra,
  };
}

Deno.test("apps/blueprint#R5, apps/blueprint#R6: effect and confirm remain declarations independent of secret use", () => {
  for (const effect of ["read", "write", "external"]) {
    for (const confirm of [false, true]) {
      const result = validateBlueprint(blueprint({
        commands: [command({ effect, confirm })],
        permissions: [{
          kind: "secret.use",
          scope: { name: "calendar.access_token" },
          reason: "Authenticate the calendar request",
        }],
      }));
      assert(result.ok);
      assertEquals(result.value.commands[0]?.effect, effect);
      assertEquals(result.value.commands[0]?.confirm, confirm);
    }
  }
  assert(
    !validateBlueprint(blueprint({
      commands: [command({ effect: ["read", "write"] })],
    })).ok,
  );
});

Deno.test("apps/blueprint#R12, apps/blueprint#R13, apps/permissions#R13: document declarations use exact refs and declared save keys", () => {
  const document = {
    key: "report",
    name: "Report",
    description: "Saves the account report",
    format: {
      name: "@lophn/format-markdown",
      module_hash: "ab".repeat(32),
      explicit: true,
    },
    document: DOCUMENT,
  };
  const permission = {
    kind: "document.save",
    scope: { key: "report" },
    reason: "Save the report",
  };
  const input = blueprint({ documents: [document], permissions: [permission] });
  const result = validateBlueprint(input);
  assert(result.ok);
  assertEquals(result.value.documents[0], document);
  assert(permissionRequirementSchema.safeParse(permission).success);
  for (
    const bad of [
      { ...document, document: APP },
      { ...document, content: "Inline document bytes" },
      {
        ...document,
        format: { ...document.format, module_hash: "not-a-hash" },
      },
    ]
  ) {
    assert(!validateBlueprint(blueprint({ documents: [bad] })).ok);
  }
  assert(
    !validateBlueprint(blueprint({
      documents: [document, document],
    })).ok,
  );
  assert(
    !validateBlueprint(blueprint({
      documents: [document],
      permissions: [{ ...permission, scope: { key: "other" } }],
    })).ok,
  );
});

Deno.test("apps/blueprint#R14, apps/automations#R1, apps/automations#R13: automation binds the declared command and normalized fixed input", () => {
  const declared = command({
    effect: "external",
    input: {
      type: "object",
      properties: { account: { type: "string", default: "primary" } },
      additionalProperties: false,
    },
  });
  const automation = {
    key: "sync",
    label: "Sync",
    when: { kind: "on_start" },
    command: "lookup",
    input: {},
  };
  const result = validateBlueprint(blueprint({
    commands: [declared],
    automatic_tasks: [automation],
  }));
  assert(result.ok);
  assertEquals(result.value.automatic_tasks[0]?.input, { account: "primary" });
  for (
    const bad of [
      { ...automation, command: "not-declared" },
      { ...automation, input: { account: 1 } },
      { ...automation, when: { kind: "cron", cron: "* * * * *" } },
    ]
  ) {
    assert(
      !validateBlueprint(blueprint({
        commands: [declared],
        automatic_tasks: [bad],
      })).ok,
    );
  }
  assert(
    !validateBlueprint(blueprint({
      commands: [{ ...declared, confirm: true }],
      automatic_tasks: [automation],
    })).ok,
  );
});

Deno.test("apps/blueprint#R15: display text changes do not replace a command key", () => {
  const first = validateBlueprint(blueprint());
  const changed = validateBlueprint(blueprint({
    commands: [
      command({ label: "Find account", description: "Finds an account" }),
    ],
  }));
  assert(first.ok && changed.ok);
  assertEquals(first.value.commands[0]?.key, changed.value.commands[0]?.key);
  assert(first.value.commands[0]?.label !== changed.value.commands[0]?.label);
});

Deno.test("apps/agent-context#R1: context and annotation targets reference the matching read and write declarations", () => {
  const context = {
    screen: "home",
    read_command: "lookup",
    sensitive_paths: ["/data/token"],
    annotation_targets: [{
      key: "hint",
      label: "Hint",
      write_command: "annotate",
    }],
  };
  const input = blueprint({
    screens: [{ key: "home", label: "Home", path: "/home", sizes: ["panel"] }],
    commands: [command(), command({ key: "annotate", effect: "write" })],
    agent_context: [context],
  });
  assert(validateBlueprint(input).ok);
  assert(agentContextDeclarationSchema.safeParse(context).success);
  for (
    const bad of [
      { ...context, screen: "other" },
      { ...context, read_command: "annotate" },
      {
        ...context,
        annotation_targets: [{
          ...context.annotation_targets[0],
          write_command: "lookup",
        }],
      },
      { ...context, sensitive_paths: ["/data/token", "/data/token"] },
    ]
  ) {
    assert(!validateBlueprint({ ...input, agent_context: [bad] }).ok);
  }
});

Deno.test("apps/agent-context#R5: annotation input preserves its exact view and expected revision without body authority", () => {
  const input = {
    screen: "home",
    view_session: "view-1",
    expected_revision: "revision-1",
    target: "hint",
    text: "Try the alternate branch",
  };
  assertEquals(annotationWriteInputSchema.parse(input), input);
  const { expected_revision: _revision, ...missing } = input;
  assert(!annotationWriteInputSchema.safeParse(missing).success);
  assert(
    !annotationWriteInputSchema.safeParse({ ...input, expected_revision: "" })
      .success,
  );
  assert(
    !annotationWriteInputSchema.safeParse({ ...input, authorized: true })
      .success,
  );
});

Deno.test("apps/permissions#R3, apps/permissions#R7, apps/permissions#R14: grant inputs retain exact scopes and reject authority claims", () => {
  const fetch = {
    kind: "net.fetch" as const,
    host: "api.example.com",
    port: 443,
  };
  assertEquals(permissionScopeSchema.parse(fetch), fetch);
  assert(permissionScopeSchema.safeParse({ ...fetch, port: 8443 }).success);
  assert(
    !permissionScopeSchema.safeParse({ ...fetch, approved: true }).success,
  );
  const fs = {
    kind: "fs.read" as const,
    path: "/workspace/notes",
    recursive: false,
  };
  assertEquals(permissionScopeSchema.parse(fs), fs);
  assert(
    !permissionScopeSchema.safeParse({ ...fs, protected_path_override: true })
      .success,
  );
  const secret = { kind: "secret.use" as const, name: "calendar.access_token" };
  assertEquals(permissionScopeSchema.parse(secret), secret);
  assert(
    !permissionScopeSchema.safeParse({ ...secret, value: "raw-secret" })
      .success,
  );
});

Deno.test("apps/permissions#R12: normalized network requests sort deterministically and reject duplicate scopes", () => {
  const first = {
    kind: "net.fetch",
    reason: "First host",
    scope: { host: "a.test", port: 443 },
  };
  const second = {
    kind: "net.fetch",
    reason: "Second host",
    scope: { host: "b.test", port: 443 },
  };
  const left = validateBlueprint(blueprint({ permissions: [first, second] }));
  const right = validateBlueprint(blueprint({ permissions: [second, first] }));
  assert(left.ok && right.ok);
  assertEquals(left.value, right.value);
  assert(
    !validateBlueprint(
      blueprint({
        permissions: [first, { ...first, reason: "Another reason" }],
      }),
    ).ok,
  );
});

Deno.test("apps/connections#R1, apps/permissions#R27: directed app use and agent command scopes remain separate", () => {
  const result = validateBlueprint(
    blueprint({
      app_connections: [{
        app: OTHER,
        commands: ["lookup"],
        reason: "Read accounts",
      }],
    }),
    { app: APP },
  );
  assert(result.ok);
  const grant = { kind: "agent.commands" as const, commands: ["lookup"] };
  assertEquals(permissionScopeSchema.parse(grant), grant);
  assert(
    !permissionScopeSchema.safeParse({ ...grant, commands: ["lookup*"] })
      .success,
  );
  assert(!permissionScopeSchema.safeParse({ ...grant, app: OTHER }).success);
  assert(
    !validateBlueprint(blueprint({
      permissions: [{
        ...grant,
        scope: { commands: ["lookup"] },
        reason: "Read",
      }],
    })).ok,
  );
});

Deno.test("apps/sdk#R3, apps/sdk#R4, apps/sdk#R34: catalog values and pinned dependencies preserve exact names, hashes and versions", () => {
  assertEquals(PACKAGE_KINDS, ["component", "capability", "domain", "format"]);
  const value = {
    id: "pkg_01aryz6s41s4z4k7p41s4z4k7p",
    name: "@lophn/blueprint",
    description: "Declares and checks an app",
    kind: "domain",
    versions: [{
      version: "1.0.0",
      bundle_hash: "ab".repeat(32),
      guide_hash: "cd".repeat(32),
    }],
  };
  assertEquals(packageSchema.parse(value), value);
  assert(
    validateBlueprint(
      blueprint({
        sdk_dependencies: [{
          name: value.name,
          version: "9007199254740993.0.0",
        }],
      }),
    ).ok,
  );
  for (const version of ["^1.0.0", "~1.0.0", "latest", "1.0.0-01"]) {
    assert(
      !validateBlueprint(
        blueprint({ sdk_dependencies: [{ name: value.name, version }] }),
      ).ok,
    );
  }
  assert(
    !packageSchema.safeParse({
      ...value,
      versions: [{ ...value.versions[0], guide_hash: "not-a-hash" }],
    }).success,
  );
});
