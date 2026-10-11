import { assert, assertEquals } from "@std/assert";
import {
  AGENT_BODY_MAX_BYTES,
  agentDefinitionSchema,
  agentFrontmatterSchema,
  agentIssueSchema,
  agentKindOf,
  agentListRowSchema,
  agentNameKey,
  agentPlaceAllowsRole,
  agentSettingsSchema,
  isBuiltinAgentName,
  profileSchema,
  RESOLVED_FIELDS,
  resolvedAgentSchema,
  valueSourceSchema,
} from "./agent-values.ts";

const asg = "asg_01arz3ndektsv4rrffq69g5fav";
const prj = "prj_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const ctx = "ctx_01arz3ndektsv4rrffq69g5fav";
const ctx2 = "ctx_01arz3ndektsv4rrffq69g5faw";
const pvd = "pvd_01arz3ndektsv4rrffq69g5fav";
const hash = "ab".repeat(32);

const model = {
  provider: pvd,
  model_name: "gpt-5",
  option_values: { effort: "high" },
};

Deno.test("lophn-agent/agents#R13: a profile is one icon or one uploaded image name", () => {
  assert(profileSchema.safeParse({ kind: "icon", icon: "dock" }).success);
  assert(
    profileSchema.safeParse({ kind: "image", image: "avatar.webp" }).success,
  );
  assert(
    profileSchema.safeParse({ kind: "image", image: "avatar.jpg" }).success,
  );
  for (const image of ["avatar.svg", "avatar.gif", "../avatar.png", "me.png"]) {
    assert(!profileSchema.safeParse({ kind: "image", image }).success, image);
  }
  assert(!profileSchema.safeParse({ kind: "icon", icon: "Dock" }).success);
  assert(!profileSchema.safeParse({ kind: "icon" }).success);
  assert(
    !profileSchema.safeParse({
      kind: "icon",
      icon: "dock",
      image: "avatar.png",
    }).success,
  );
});

Deno.test("lophn-agent/agents#R11: every definition field is optional and null is not a value", () => {
  assert(agentDefinitionSchema.safeParse({ body: "" }).success);
  assert(agentFrontmatterSchema.safeParse({}).success);
  const full = {
    name: "Reviewer",
    profile: { kind: "icon", icon: "roles" },
    model,
    contexts: [ctx, ctx2],
    app_reads: [{ app, command: "status" }],
    skills_off: ["slides"],
    mcp_off: [{ server_name: "files" }, {
      server_name: "web",
      original_tool: "fetch",
    }],
    safe_tools: [{ server_name: "web", original_tool: "search" }],
    permissions: { tools: ["document.list", "document.read_section"] },
    body: "Read the project documents.",
  };
  assert(agentDefinitionSchema.safeParse(full).success);
  for (const field of ["name", "profile", "model", "permissions", "contexts"]) {
    assert(
      !agentDefinitionSchema.safeParse({ ...full, [field]: null }).success,
      `${field}: null`,
    );
  }
  assert(!agentDefinitionSchema.safeParse({ body: "x", color: "red" }).success);
  assert(!agentDefinitionSchema.safeParse({ name: "x" }).success);
});

Deno.test("lophn-agent/agents#R14: a model choice carries no credential or price", () => {
  assert(agentDefinitionSchema.safeParse({ model, body: "" }).success);
  assert(
    !agentDefinitionSchema.safeParse({
      model: { ...model, api_key: "secret" },
      body: "",
    }).success,
  );
  assert(
    !agentDefinitionSchema.safeParse({
      model: { ...model, price: 3 },
      body: "",
    }).success,
  );
});

Deno.test("lophn-agent/agents#R22: permissions are single action names without bundles or wildcards", () => {
  const parse = (tools: string[]) =>
    agentDefinitionSchema.safeParse({ permissions: { tools }, body: "" });
  assert(parse(["document.list", "app.call_read_command"]).success);
  assert(parse([]).success);
  for (const bad of ["document", "document.*", "*", "Document.list", ""]) {
    assert(!parse([bad]).success, bad);
  }
  assert(!parse(["document.list", "document.list"]).success);
});

Deno.test("lophn-agent/agents#R5 lophn-agent/agents#R15: lists reject duplicates", () => {
  const check = (patch: Record<string, unknown>) =>
    agentDefinitionSchema.safeParse({ ...patch, body: "" }).success;
  assert(check({ contexts: [ctx, ctx2] }));
  assert(!check({ contexts: [ctx, ctx] }));
  assert(check({ app_reads: [{ app, command: "a" }, { app, command: "b" }] }));
  assert(!check({ app_reads: [{ app, command: "a" }, { app, command: "a" }] }));
  assert(!check({ app_reads: [{ app, command: "*" }] }));
  assert(!check({ skills_off: ["a", "a"] }));
  assert(
    !check({ mcp_off: [{ server_name: "s" }, { server_name: "s" }] }),
  );
  assert(
    !check({
      safe_tools: [
        { server_name: "s", original_tool: "t" },
        { server_name: "s", original_tool: "t" },
      ],
    }),
  );
  assert(!check({ safe_tools: [{ server_name: "s" }] }));
});

Deno.test("lophn-agent/agents#R24: the body is limited to the instruction file size in UTF-8 bytes", () => {
  assertEquals(AGENT_BODY_MAX_BYTES, 32_768);
  const body = (text: string) =>
    agentDefinitionSchema.safeParse({ body: text });
  assert(body("x".repeat(AGENT_BODY_MAX_BYTES)).success);
  assert(!body("x".repeat(AGENT_BODY_MAX_BYTES + 1)).success);
  // 한 글자가 3 byte다: 글자 수는 상한 아래여도 byte가 넘으면 거절한다.
  assert(!body("한".repeat(10_923)).success);
  assert(body("한".repeat(10_922)).success);
});

Deno.test("lophn-agent/agents#R5: names compare without case or surrounding spaces and built-in names are reserved", () => {
  assertEquals(agentNameKey("  Reviewer "), agentNameKey("reviewer"));
  assert(isBuiltinAgentName("LOPHN"));
  assert(isBuiltinAgentName(" context engineer "));
  assert(isBuiltinAgentName("App Engineer"));
  assert(!isBuiltinAgentName("Reviewer"));
  assert(!agentDefinitionSchema.safeParse({ name: "   ", body: "x" }).success);
});

Deno.test("lophn-agent/agents#R10: a place settings file holds only models and permissions", () => {
  assert(agentSettingsSchema.safeParse({}).success);
  assert(
    agentSettingsSchema.safeParse({
      models: { lophn: model, operator: model },
      permissions: { tools: ["document.list"] },
    }).success,
  );
  assert(!agentSettingsSchema.safeParse({ contexts: [ctx] }).success);
  assert(
    !agentSettingsSchema.safeParse({ profile: { kind: "icon", icon: "x" } })
      .success,
  );
  assert(!agentSettingsSchema.safeParse({ models: { boss: model } }).success);
  assert(
    !agentSettingsSchema.safeParse({
      models: { lophn: { ...model, extra: 1 } },
    })
      .success,
  );
});

Deno.test("lophn-agent/agents#R7: roles and places that can meet", () => {
  const project = { kind: "project" } as const;
  const inApp = { kind: "app" } as const;
  assert(agentPlaceAllowsRole("lophn", project));
  assert(agentPlaceAllowsRole("lophn", inApp));
  assert(agentPlaceAllowsRole("operator", project));
  assert(agentPlaceAllowsRole("operator", inApp));
  assert(agentPlaceAllowsRole("context_engineer", project));
  assert(!agentPlaceAllowsRole("context_engineer", inApp));
  assert(agentPlaceAllowsRole("app_engineer", inApp));
  assert(!agentPlaceAllowsRole("app_engineer", project));
  assertEquals(agentKindOf("lophn"), "built_in");
  assertEquals(agentKindOf("operator"), "operator");
});

Deno.test("lophn-agent/agents#R12: a source names the place exactly for the place and definition layers", () => {
  const place = { kind: "project", id: prj };
  for (const layer of ["default", "workspace", "session"]) {
    assert(valueSourceSchema.safeParse({ layer, place: null }).success);
    assert(!valueSourceSchema.safeParse({ layer, place }).success);
  }
  for (const layer of ["place", "definition"]) {
    assert(valueSourceSchema.safeParse({ layer, place }).success);
    assert(!valueSourceSchema.safeParse({ layer, place: null }).success);
  }
  assert(!valueSourceSchema.safeParse({ layer: "agent", place: null }).success);
});

Deno.test("lophn-agent/agents#R24: an issue names the field and one reason code", () => {
  assert(
    agentIssueSchema.safeParse({ field: "contexts.1", code: "duplicate" })
      .success,
  );
  assert(!agentIssueSchema.safeParse({ field: "", code: "duplicate" }).success);
  assert(!agentIssueSchema.safeParse({ field: "name", code: "bad" }).success);
});

const source = { layer: "default", place: null };
const resolved = {
  assignment: asg,
  role: "operator",
  place: { kind: "project", id: prj },
  name: "Reviewer",
  profile: { kind: "icon", icon: "roles" },
  agent_instructions: hash,
  model,
  tools: ["document.list"],
  skills: ["slides"],
  mcp: [{ server_name: "web", original_tool: "search" }],
  contexts: [ctx],
  contexts_reason: null,
  app_reads: [],
  safe_tools: [],
  sources: Object.fromEntries(RESOLVED_FIELDS.map((field) => [field, source])),
  hash,
};

Deno.test("lophn-agent/agents#R25: a resolved agent has one source per field and a hash", () => {
  assert(resolvedAgentSchema.safeParse(resolved).success);
  const { model: _model, ...withoutModel } = resolved;
  assert(!resolvedAgentSchema.safeParse(withoutModel).success);
  const { hash: _hash, ...withoutHash } = resolved;
  assert(!resolvedAgentSchema.safeParse(withoutHash).success);
  const { tools: _tools, ...sourcesWithoutTools } = resolved.sources;
  assert(
    !resolvedAgentSchema.safeParse({
      ...resolved,
      sources: sourcesWithoutTools,
    }).success,
  );
  assert(
    !resolvedAgentSchema.safeParse({
      ...resolved,
      sources: { ...resolved.sources, extra: source },
    }).success,
  );
});

Deno.test("lophn-agent/agents#R16 lophn-agent/agents#R17: a resolved agent keeps contexts, reasons and app reads coupled to role and place", () => {
  const builtinOnApp = {
    ...resolved,
    role: "lophn",
    name: "lophn",
    place: { kind: "app", id: app },
    contexts: [],
    contexts_reason: "no_project",
  };
  assert(resolvedAgentSchema.safeParse(builtinOnApp).success);
  assert(
    !resolvedAgentSchema.safeParse({ ...builtinOnApp, contexts: [ctx] })
      .success,
  );
  assert(
    !resolvedAgentSchema.safeParse({
      ...builtinOnApp,
      role: "context_engineer",
    }).success,
  );
  const appRead = [{ app, command: "status" }];
  assert(
    resolvedAgentSchema.safeParse({
      ...resolved,
      place: { kind: "app", id: app },
      contexts: [],
      app_reads: appRead,
    }).success,
  );
  assert(
    !resolvedAgentSchema.safeParse({
      ...builtinOnApp,
      contexts_reason: null,
      app_reads: appRead,
    }).success,
  );
});

Deno.test("lophn-agent/agents#R7: a list row shows the assignment, kind, name, profile, model summary and state", () => {
  const row = {
    assignment: asg,
    role: "operator",
    kind: "operator",
    name: "Reviewer",
    profile: { kind: "icon", icon: "roles" },
    model: {
      provider: pvd,
      model_name: "gpt-5",
      source: { layer: "workspace", place: null },
    },
    state: "enabled",
    issues: [],
  };
  assert(agentListRowSchema.safeParse(row).success);
  assert(agentListRowSchema.safeParse({ ...row, model: null }).success);
  assert(
    agentListRowSchema.safeParse({
      ...row,
      issues: [{ field: "body", code: "required" }],
    }).success,
  );
  assert(!agentListRowSchema.safeParse({ ...row, kind: "built_in" }).success);
  assert(!agentListRowSchema.safeParse({ ...row, state: "withdrawn" }).success);
});
