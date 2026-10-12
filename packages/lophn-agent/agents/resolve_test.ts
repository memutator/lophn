import { assert, assertEquals } from "@std/assert";
import { fingerprint, sha256Hex } from "../../base/mod.ts";
import {
  type AgentDefinition,
  type AgentPlace,
  type AgentRole,
  type AgentSettings,
  BUILTIN_AGENT_NAMES,
  type McpTool,
  type ModelChoice,
  type Profile,
  RESOLVED_FIELDS,
  resolvedAgentSchema,
} from "../../protocol/lophn-agent/mod.ts";
import {
  permissionIssues,
  resolveAgent,
  type ResolveInput,
} from "./resolve.ts";

const DATA = new URL("./testdata/", import.meta.url);
const PROJECT_DIR = "projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/";
const APP_DIR = "apps/app_01arz3ndektsv4rrffq69g5fa2/agents/";

function json<T>(path: string): T {
  return JSON.parse(Deno.readTextFileSync(new URL(path, DATA))) as T;
}

type Environment = {
  role_caps: Record<AgentRole, string[]>;
  default_profiles: Record<AgentRole, Profile>;
  skills: string[];
  mcp: McpTool[];
  active_contexts: Record<string, string[]>;
};

const ENV = json<Environment>("environment.json");
const WORKSPACE = json<AgentSettings>("workspace.json");

const PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const OTHER_PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa9",
};
const APP: AgentPlace = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };

const ASG = {
  lophn: "asg_01arz3ndektsv4rrffq69g5fa3",
  context_engineer: "asg_01arz3ndektsv4rrffq69g5fa4",
  app_engineer: "asg_01arz3ndektsv4rrffq69g5fa5",
  reviewer: "asg_01arz3ndektsv4rrffq69g5fa6",
  scribe: "asg_01arz3ndektsv4rrffq69g5fa7",
  watcher: "asg_01arz3ndektsv4rrffq69g5fa8",
};
const CTX1 = "ctx_01arz3ndektsv4rrffq69g5fb1";
const CTX2 = "ctx_01arz3ndektsv4rrffq69g5fb2";
const CTX3 = "ctx_01arz3ndektsv4rrffq69g5fb3";
const PVD1 = "pvd_01arz3ndektsv4rrffq69g5fc1";
const PVD2 = "pvd_01arz3ndektsv4rrffq69g5fc2";

function placeDir(place: AgentPlace): string {
  return place.kind === "project" ? PROJECT_DIR : APP_DIR;
}

type Build = {
  role: AgentRole;
  assignment: string;
  place: AgentPlace;
  definition: string | AgentDefinition | null;
};

// 파일에서 읽은 층(testdata)으로 입력을 만든다. 정의와 자리 설정은 파일을 파싱한 정답 JSON을 쓴다.
function input(build: Build): ResolveInput {
  const { role, assignment, place } = build;
  const definition = typeof build.definition === "string"
    ? json<AgentDefinition>(`${placeDir(place)}${build.definition}`)
    : build.definition;
  const hasSettings = place.id === PRJ.id || place.id === APP.id;
  return {
    assignment,
    role,
    place,
    definition,
    workspace: WORKSPACE,
    place_settings: hasSettings
      ? json<AgentSettings>(`${placeDir(place)}settings.json`)
      : {},
    session_model: null,
    environment: {
      role_caps: ENV.role_caps[role],
      default_profile: ENV.default_profiles[role],
      skills: ENV.skills,
      mcp: ENV.mcp,
      active_contexts: place.kind === "project"
        ? ENV.active_contexts[place.id] ?? []
        : [],
    },
  };
}

const CASES: { name: string; build: Build }[] = [
  {
    name: "project-lophn",
    build: {
      role: "lophn",
      assignment: ASG.lophn,
      place: PRJ,
      definition: "lophn.json",
    },
  },
  {
    name: "project-context-engineer",
    build: {
      role: "context_engineer",
      assignment: ASG.context_engineer,
      place: PRJ,
      definition: "context-engineer.json",
    },
  },
  {
    name: "project-operator-reviewer",
    build: {
      role: "operator",
      assignment: ASG.reviewer,
      place: PRJ,
      definition: `${ASG.reviewer}.json`,
    },
  },
  {
    name: "project-operator-scribe",
    build: {
      role: "operator",
      assignment: ASG.scribe,
      place: PRJ,
      definition: `${ASG.scribe}.json`,
    },
  },
  {
    name: "app-lophn-without-file",
    build: {
      role: "lophn",
      assignment: ASG.lophn,
      place: APP,
      definition: null,
    },
  },
  {
    name: "app-engineer",
    build: {
      role: "app_engineer",
      assignment: ASG.app_engineer,
      place: APP,
      definition: "app-engineer.json",
    },
  },
  {
    name: "app-operator-status-watcher",
    build: {
      role: "operator",
      assignment: ASG.watcher,
      place: APP,
      definition: `${ASG.watcher}.json`,
    },
  },
];

function named(name: string): Build {
  const found = CASES.find((entry) => entry.name === name);
  assert(found, name);
  return found.build;
}

async function resolved(value: ResolveInput) {
  const result = await resolveAgent(value);
  assert(result.ok, "resolve should succeed");
  return result.value;
}

function scribe(patch: Partial<ResolveInput> = {}): ResolveInput {
  return {
    ...input({
      role: "operator",
      assignment: ASG.scribe,
      place: PRJ,
      definition: `${ASG.scribe}.json`,
    }),
    ...patch,
  };
}

function reviewer(patch: Partial<ResolveInput> = {}): ResolveInput {
  return {
    ...input({
      role: "operator",
      assignment: ASG.reviewer,
      place: PRJ,
      definition: `${ASG.reviewer}.json`,
    }),
    ...patch,
  };
}

function withDefinition(
  base: ResolveInput,
  definition: Partial<AgentDefinition>,
): ResolveInput {
  return { ...base, definition: { ...base.definition!, ...definition } };
}

function without<T extends object>(value: T, key: keyof T): T {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const model = (
  provider: string,
  model_name: string,
  option_values: Record<string, string> = {},
): ModelChoice => ({ provider, model_name, option_values });

const SESSION = model(PVD2, "session-model", { effort: "minimal" });
const DEFINITION = model(PVD1, "definition-model", { effort: "high" });
const PLACE = model(PVD2, "place-model", { speed: "fast" });
const WORKSPACE_MODEL = model(PVD1, "workspace-model", { effort: "low" });

Deno.test("lophn-agent/agents#R25 [agent-I2]: files and settings from testdata resolve to the golden agents with their sources", async () => {
  for (const { name, build } of CASES) {
    const value = await resolved(input(build));
    assertEquals(value, json(`expected/${name}.json`), name);
    assert(resolvedAgentSchema.safeParse(value).success, name);
    assertEquals(
      Object.keys(value.sources).sort(),
      [...RESOLVED_FIELDS].sort(),
    );
  }
});

Deno.test("lophn-agent/agents#R9 [agent-I2]: the highest layer that has a model wins, and removing a layer falls to the one below", async () => {
  const layered = (): ResolveInput => ({
    ...withDefinition(scribe(), { model: DEFINITION }),
    workspace: { ...WORKSPACE, models: { operator: WORKSPACE_MODEL } },
    place_settings: { models: { operator: PLACE } },
    session_model: SESSION,
  });
  const place = PRJ;

  let value = await resolved(layered());
  assertEquals(value.model, SESSION);
  assertEquals(value.sources.model, { layer: "session", place: null });

  value = await resolved({ ...layered(), session_model: null });
  assertEquals(value.model, DEFINITION);
  assertEquals(value.sources.model, { layer: "definition", place });

  const noDefinition = without(layered().definition!, "model");
  value = await resolved({
    ...layered(),
    session_model: null,
    definition: noDefinition,
  });
  assertEquals(value.model, PLACE);
  assertEquals(value.sources.model, { layer: "place", place });

  value = await resolved({
    ...layered(),
    session_model: null,
    definition: noDefinition,
    place_settings: {},
  });
  assertEquals(value.model, WORKSPACE_MODEL);
  assertEquals(value.sources.model, { layer: "workspace", place: null });

  const none = await resolveAgent({
    ...layered(),
    session_model: null,
    definition: noDefinition,
    place_settings: {},
    workspace: { permissions: WORKSPACE.permissions },
  });
  assert(!none.ok);
  assertEquals(none.error.code, "invalid_input");
  assertEquals(none.error.details, {
    issues: [{ field: "model", code: "required" }],
  });
});

Deno.test("lophn-agent/agents#R14 [agent-I2]: a model is taken whole from one layer and options are never mixed across layers", async () => {
  const layers = {
    ...withDefinition(scribe(), { model: model(PVD2, "claude", {}) }),
    workspace: { models: { operator: WORKSPACE_MODEL } },
    place_settings: { models: { operator: PLACE } },
  };
  const value = await resolved(layers);
  assertEquals(value.model, model(PVD2, "claude", {}));
  const viaPlace = await resolved({
    ...layers,
    definition: without(layers.definition!, "model"),
  });
  assertEquals(viaPlace.model, PLACE);
  assertEquals(viaPlace.model.option_values, { speed: "fast" });
});

Deno.test("lophn-agent/agents#R11 [agent-I2]: an agent that never set a model follows the Workspace default and a set model ignores it", async () => {
  const before = await resolved(scribe());
  assertEquals(before.model, WORKSPACE.models!.operator);
  assertEquals(before.sources.model, { layer: "workspace", place: null });

  const changed = {
    ...scribe(),
    workspace: { ...WORKSPACE, models: { operator: WORKSPACE_MODEL } },
  };
  assertEquals((await resolved(changed)).model, WORKSPACE_MODEL);

  const pinned = {
    ...changed,
    definition: { ...changed.definition!, model: DEFINITION },
  };
  assertEquals((await resolved(pinned)).model, DEFINITION);
  const cleared = {
    ...pinned,
    definition: without(pinned.definition, "model"),
  };
  assertEquals((await resolved(cleared)).model, WORKSPACE_MODEL);
});

Deno.test("lophn-agent/agents#R10 [agent-I2]: each role reads only its own model key of the Workspace and place layers", async () => {
  const onlyLophn = {
    workspace: { models: { lophn: WORKSPACE_MODEL } },
    place_settings: {},
  };
  const forLophn = await resolved({
    ...input({
      role: "lophn",
      assignment: ASG.lophn,
      place: PRJ,
      definition: null,
    }),
    ...onlyLophn,
  });
  assertEquals(forLophn.model, WORKSPACE_MODEL);
  const forOperator = await resolveAgent({ ...scribe(), ...onlyLophn });
  assert(!forOperator.ok);
  const fromPlace = await resolved({
    ...scribe(),
    workspace: {},
    place_settings: { models: { operator: PLACE, lophn: WORKSPACE_MODEL } },
  });
  assertEquals(fromPlace.model, PLACE);
});

Deno.test("lophn-agent/agents#R12 [agent-I2]: every field has one source, and removing the definition's value moves it to the layer below", async () => {
  const value = await resolved(reviewer());
  const place = PRJ;
  assertEquals(value.sources.name, { layer: "definition", place });
  assertEquals(value.sources.profile, { layer: "definition", place });
  assertEquals(value.sources.model, { layer: "definition", place });
  assertEquals(value.sources.tools, { layer: "definition", place });
  assertEquals(value.sources.contexts, { layer: "definition", place });
  assertEquals(value.sources.agent_instructions, {
    layer: "definition",
    place,
  });

  const bare = await resolved(
    withDefinition(scribe(), {
      name: "Scribe",
      body: "Turn notes into drafts.",
    }),
  );
  assertEquals(bare.sources.model, { layer: "workspace", place: null });
  assertEquals(bare.sources.profile, { layer: "default", place: null });
  assertEquals(bare.sources.tools, { layer: "place", place });
  assertEquals(bare.sources.skills, { layer: "default", place: null });
  assertEquals(bare.sources.contexts, { layer: "default", place: null });

  const workspaceOnly = await resolved({ ...scribe(), place_settings: {} });
  assertEquals(workspaceOnly.sources.tools, {
    layer: "workspace",
    place: null,
  });
  const caps = await resolved({
    ...scribe(),
    place_settings: {},
    workspace: { models: WORKSPACE.models },
  });
  assertEquals(caps.sources.tools, { layer: "default", place: null });
});

Deno.test("lophn-agent/agents#R27 [agent-I2]: the same built-in agent takes the settings and contexts of the place it works in", async () => {
  const at = (place: AgentPlace, placeSettings: AgentSettings) => ({
    ...input({
      role: "lophn" as const,
      assignment: ASG.lophn,
      place,
      definition: null,
    }),
    place_settings: placeSettings,
  });
  const first = await resolved(at(PRJ, json(`${PROJECT_DIR}settings.json`)));
  assertEquals(first.model.model_name, "claude-sonnet");
  assertEquals(first.place, PRJ);
  assertEquals(first.contexts, [CTX1, CTX2]);

  const second = await resolved({
    ...at(OTHER_PRJ, {}),
    environment: { ...at(OTHER_PRJ, {}).environment, active_contexts: [CTX3] },
  });
  assertEquals(second.model, WORKSPACE.models!.lophn);
  assertEquals(second.sources.model, { layer: "workspace", place: null });
  assertEquals(second.place, OTHER_PRJ);
  assertEquals(second.contexts, [CTX3]);
});

Deno.test("lophn-agent/agents#R2 [agent-I2]: built-in agents have a fixed name and Operators take theirs from the definition", async () => {
  const lophn = await resolved(input(named("project-lophn")));
  assertEquals(lophn.name, BUILTIN_AGENT_NAMES.lophn);
  assertEquals(lophn.sources.name, { layer: "default", place: null });
  const engineer = await resolved(input(named("app-engineer")));
  assertEquals(engineer.name, BUILTIN_AGENT_NAMES.app_engineer);
  const hand = await resolved({
    ...input(named("project-lophn")),
    definition: { name: "Boss", body: "" },
  });
  assertEquals(hand.name, BUILTIN_AGENT_NAMES.lophn);
  assertEquals((await resolved(reviewer())).name, "Reviewer");
});

Deno.test("lophn-agent/agents#R15 [agent-I2]: an Operator reads only the contexts it chose, only the active ones, and none at all when it chose none", async () => {
  const chosen = await resolved(reviewer());
  assertEquals(chosen.contexts, [CTX1]);

  const archived = await resolved(
    withDefinition(reviewer(), { contexts: [CTX1, CTX3] }),
  );
  assertEquals(archived.contexts, [CTX1]);
  const reordered = await resolved(
    withDefinition(reviewer(), { contexts: [CTX2, CTX1] }),
  );
  assertEquals(reordered.contexts, [CTX2, CTX1]);

  const none = await resolved(scribe());
  assertEquals(none.contexts, []);
  assertEquals(none.contexts_reason, null);
  const cleared = await resolved({
    ...reviewer(),
    definition: without(reviewer().definition!, "contexts"),
  });
  assertEquals(cleared.contexts, []);
});

Deno.test("lophn-agent/agents#R16 [agent-I2]: a built-in agent gets every active context of its project and none, with a reason, in an app", async () => {
  const lophn = input(named("project-lophn"));
  assertEquals((await resolved(lophn)).contexts, [CTX1, CTX2]);
  const archived = {
    ...lophn,
    environment: { ...lophn.environment, active_contexts: [CTX1] },
  };
  assertEquals((await resolved(archived)).contexts, [CTX1]);
  const noContexts = {
    ...lophn,
    environment: { ...lophn.environment, active_contexts: [] },
  };
  const empty = await resolved(noContexts);
  assertEquals(empty.contexts, []);
  assertEquals(empty.contexts_reason, null);

  const inApp = await resolved(input(named("app-lophn-without-file")));
  assertEquals(inApp.contexts, []);
  assertEquals(inApp.contexts_reason, "no_project");
  const operatorInApp = await resolved(
    input(named("app-operator-status-watcher")),
  );
  assertEquals(operatorInApp.contexts_reason, null);
});

Deno.test("lophn-agent/agents#R16 [agent-I2]: App Engineer in its app gets the active contexts that read that app and no reason, while lophn in an app still gets none", async () => {
  const engineer = input(named("app-engineer"));
  const withApp = {
    ...engineer,
    environment: { ...engineer.environment, active_contexts: [CTX2, CTX1] },
  };
  const got = await resolved(withApp);
  assertEquals(got.contexts, [CTX2, CTX1]);
  assertEquals(got.contexts_reason, null);
  const none = await resolved(engineer);
  assertEquals(none.contexts, []);
  assertEquals(none.contexts_reason, null);
  const lophn = input(named("app-lophn-without-file"));
  const lophnApp = await resolved({
    ...lophn,
    environment: { ...lophn.environment, active_contexts: [CTX1] },
  });
  assertEquals(lophnApp.contexts, []);
  assertEquals(lophnApp.contexts_reason, "no_project");
});

Deno.test("lophn-agent/agents#R17 [agent-I2]: an app Operator keeps the app commands it chose and a built-in agent keeps none", async () => {
  const watcher = await resolved(input(named("app-operator-status-watcher")));
  assertEquals(watcher.app_reads, [
    { app: APP.id, command: "status" },
    { app: APP.id, command: "recent_errors" },
  ]);
  const handEdited = await resolved({
    ...input(named("app-lophn-without-file")),
    definition: {
      app_reads: [{ app: APP.id, command: "status" }],
      body: "",
    },
  });
  assertEquals(handEdited.app_reads, []);
});

Deno.test("lophn-agent/agents#R18 [agent-I2]: skills and MCP tools are all on unless the definition turned them off, and stale off entries do not block", async () => {
  const all = await resolved(scribe());
  assertEquals(all.skills, ["slides", "spreadsheet"]);
  assertEquals(all.mcp, ENV.mcp);

  const one = await resolved(reviewer());
  assertEquals(one.skills, ["slides"]);
  assertEquals(one.mcp, [
    { server_name: "web", original_tool: "search" },
    { server_name: "files", original_tool: "read" },
  ]);

  const registered = await resolved({
    ...reviewer(),
    environment: {
      ...reviewer().environment,
      skills: ["slides", "spreadsheet", "translate"],
    },
  });
  assertEquals(registered.skills, ["slides", "translate"]);

  const stale = await resolved(
    withDefinition(scribe(), {
      skills_off: ["gone"],
      mcp_off: [{ server_name: "gone" }, { server_name: "web" }],
    }),
  );
  assertEquals(stale.skills, ["slides", "spreadsheet"]);
  assertEquals(stale.mcp, [{ server_name: "files", original_tool: "read" }]);
});

Deno.test("lophn-agent/agents#R19 [agent-I2]: safe tool marks are carried as written", async () => {
  const marked = await resolved(
    withDefinition(reviewer(), {
      safe_tools: [
        { server_name: "web", original_tool: "search" },
        { server_name: "files", original_tool: "read" },
      ],
    }),
  );
  assertEquals(marked.safe_tools, [
    { server_name: "web", original_tool: "search" },
    { server_name: "files", original_tool: "read" },
  ]);
  assertEquals(marked.sources.safe_tools.layer, "definition");
  assertEquals((await resolved(scribe())).safe_tools, []);
});

Deno.test("lophn-agent/agents#R20 lophn-agent/agents#R21 [agent-I2]: an agent gets only the tools its role, the Workspace, the place and its own definition all allow", async () => {
  const tools = (await resolved(reviewer())).tools;
  assertEquals(tools, [
    "document.list",
    "document.search",
    "document.read_section",
    "question.submit",
  ]);

  // 직접 고친 정의가 자리보다 넓거나 role 상한 밖이어도 run에는 교집합만 간다.
  const wide = await resolved(
    withDefinition(reviewer(), {
      permissions: {
        tools: [
          "document.list",
          "document.save_version",
          "ticket.create",
          "question.submit",
        ],
      },
    }),
  );
  assertEquals(wide.tools, ["document.list", "question.submit"]);

  // 자리의 권한을 좁히면 다음 resolve부터 tool이 줄어든다.
  const narrowed = await resolved({
    ...reviewer(),
    place_settings: { permissions: { tools: ["document.list"] } },
  });
  assertEquals(narrowed.tools, ["document.list"]);
});

Deno.test("lophn-agent/agents#R22 [agent-I2]: new role actions reach an agent with no permissions field and never an agent that narrowed its tools", async () => {
  const grown = (value: ResolveInput): ResolveInput => ({
    ...value,
    workspace: { models: WORKSPACE.models },
    place_settings: {},
    environment: {
      ...value.environment,
      role_caps: [...value.environment.role_caps, "document.create"],
    },
  });
  const narrowed = await resolved(grown(reviewer()));
  assertEquals(narrowed.tools, [
    "document.list",
    "document.search",
    "document.read_section",
    "question.submit",
  ]);
  const open = await resolved(grown(scribe()));
  assert(open.tools.includes("document.create"));
  assertEquals(open.tools.length, ENV.role_caps.operator.length + 1);
});

Deno.test("lophn-agent/agents#R21 [agent-I2]: requested tools outside the allowed set are reported one by one", () => {
  assertEquals(
    permissionIssues(["a.x", "b.y", "c.z"], ["a.x", "c.z"]),
    [{ field: "permissions.tools.1", code: "over_cap" }],
  );
  assertEquals(
    permissionIssues(["a.x", "b.y"], [], "permissions.tools"),
    [
      { field: "permissions.tools.0", code: "over_cap" },
      { field: "permissions.tools.1", code: "over_cap" },
    ],
  );
  assertEquals(permissionIssues([], ["a.x"]), []);
  assertEquals(permissionIssues(["a.x"], ["a.x"]), []);
  assertEquals(
    permissionIssues(["z.z"], ["a.x"], "tools"),
    [{ field: "tools.0", code: "over_cap" }],
  );
});

Deno.test("lophn-agent/agents#R25 [agent-I2]: the same input resolves to the same value and hash without touching the input", async () => {
  const frozen = deepFreeze(reviewer());
  const first = await resolved(frozen);
  const second = await resolved(frozen);
  assertEquals(first, second);
  assertEquals(first.hash, second.hash);
  const { hash, ...rest } = first;
  assertEquals(hash, await fingerprint(rest));
  assertEquals(JSON.parse(JSON.stringify(first)), first);

  const other = await resolved(
    withDefinition(reviewer(), { model: SESSION }),
  );
  assert(other.hash !== first.hash);
  assertEquals(other.agent_instructions, first.agent_instructions);
});

Deno.test("lophn-agent/agents#R25 lophn-agent/agents#R6 [agent-I2]: the instructions blob is the definition body and nothing from the other fields", async () => {
  const value = await resolved(reviewer());
  assertEquals(
    value.agent_instructions,
    await sha256Hex(reviewer().definition!.body),
  );
  const edited = await resolved(
    withDefinition(reviewer(), { body: "Something else." }),
  );
  assertEquals(edited.agent_instructions, await sha256Hex("Something else."));
  assert(edited.hash !== value.hash);

  const noFile = await resolved(input(named("app-lophn-without-file")));
  assertEquals(noFile.agent_instructions, await sha256Hex(""));
  assertEquals(noFile.sources.agent_instructions, {
    layer: "default",
    place: null,
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I2]: what cannot become an agent is refused with a common error code", async () => {
  const missing = await resolveAgent({ ...scribe(), definition: null });
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");

  const wrongPlace = await resolveAgent({
    ...input(named("project-context-engineer")),
    place: APP,
  });
  assert(!wrongPlace.ok);
  assertEquals(wrongPlace.error.code, "invalid_input");
  assertEquals(wrongPlace.error.details, {
    issues: [{ field: "place", code: "not_allowed" }],
  });

  const unnamed = await resolveAgent({
    ...scribe(),
    definition: { body: "Turn notes into drafts." },
  });
  assert(!unnamed.ok);
  assertEquals(unnamed.error.details, {
    issues: [{ field: "name", code: "required" }],
  });
});
