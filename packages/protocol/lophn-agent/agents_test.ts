import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { contextListRoute } from "../projects/mod.ts";
import { routePath } from "../base/route.ts";
import { agentIssuesDetailsSchema } from "./agent-values.ts";
import {
  AGENT_EVENTS,
  AGENT_ROUTES,
  agentProfilesRead,
  agentProfilesUpload,
  agentSaved,
  agentsDelete,
  agentsList,
  agentsRead,
  agentsSave,
  changePlaceAgentSettingsInputSchema,
  deleteAgentInputSchema,
  placeAgentSettingsChange,
  placeAgentSettingsChanged,
  placeAgentSettingsRead,
  readAgentInputSchema,
  readPlaceAgentSettingsInputSchema,
  saveAgentInputSchema,
  uploadAgentProfileInputSchema,
} from "./agents.ts";

const asg = "asg_01arz3ndektsv4rrffq69g5fav";
const prj = "prj_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const pvd = "pvd_01arz3ndektsv4rrffq69g5fav";
const hash = "ab".repeat(32);
const place = { kind: "project", id: prj };
const model = { provider: pvd, model_name: "gpt-5", option_values: {} };

Deno.test("lophn-agent/agents#R3: eight routes list, read, save and delete agents, handle profile images and place settings", () => {
  assertEquals(AGENT_ROUTES.map(routePath), [
    "/v1/agents/list",
    "/v1/agents/read",
    "/v1/agents/save",
    "/v1/agents/delete",
    "/v1/agent-profiles/upload",
    "/v1/agent-profiles/read",
    "/v1/place-agent-settings/read",
    "/v1/place-agent-settings/change",
  ]);
  assertEquals(AGENT_ROUTES.map((route) => route.kind), [
    "read",
    "read",
    "command",
    "command",
    "upload",
    "file",
    "read",
    "command",
  ]);
  for (const route of AGENT_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assert(!route.errors.includes("internal"));
  }
});

Deno.test("lophn-agent/agents#R8: only the user writes or deletes a definition, never an agent", () => {
  for (
    const route of [
      agentsSave,
      agentsDelete,
      agentProfilesUpload,
      placeAgentSettingsChange,
    ]
  ) {
    assertEquals(route.actors, ["user"]);
  }
  for (const route of AGENT_ROUTES) {
    assert(!route.actors.includes("agent"));
    assert(!route.actors.includes("coding_agent"));
  }
  assertEquals(agentsList.actors, ["user", "machine"]);
  assertEquals(agentsRead.actors, ["user", "machine"]);
});

Deno.test("lophn-agent/agents#R4: save overwrites the whole file under a file hash and a new Operator has no assignment", () => {
  const newOperator = saveAgentInputSchema.safeParse({
    place,
    definition: { name: "Reviewer", body: "Review the drafts." },
  });
  assert(newOperator.success);
  assert(
    saveAgentInputSchema.safeParse({
      place,
      assignment: asg,
      definition: { model, body: "" },
    }).success,
  );
  assert(!saveAgentInputSchema.safeParse({ place, definition: {} }).success);
  assert(
    !saveAgentInputSchema.safeParse({
      place: { kind: "global", id: null },
      definition: { body: "x" },
    }).success,
  );
  assert(
    !saveAgentInputSchema.safeParse({
      place,
      definition: { body: "x" },
      version: 3,
    }).success,
  );
  assert(agentsSave.compare?.safeParse({ hash: null }).success);
  assert(agentsSave.compare?.safeParse({ hash }).success);
  assert(!agentsSave.compare?.safeParse({}).success);
  assert(!agentsSave.compare?.safeParse({ hash: "x" }).success);
  assert(
    agentsSave.output.safeParse({ assignment: asg, role: "operator", hash })
      .success,
  );
});

Deno.test("lophn-agent/agents#R2: delete takes only an assignment and compares the file hash", () => {
  assert(deleteAgentInputSchema.safeParse({ assignment: asg }).success);
  assert(!deleteAgentInputSchema.safeParse({}).success);
  assert(!deleteAgentInputSchema.safeParse({ assignment: prj }).success);
  assert(!deleteAgentInputSchema.safeParse({ assignment: asg, place }).success);
  assert(agentsDelete.compare?.safeParse({ hash }).success);
  assert(!agentsDelete.compare?.safeParse({ hash: null }).success);
});

Deno.test("lophn-agent/agents#R7: list and read name the place and the assignment", () => {
  assert(readAgentInputSchema.safeParse({ place, assignment: asg }).success);
  assert(
    readAgentInputSchema.safeParse({
      place: { kind: "app", id: app },
      assignment: asg,
    }).success,
  );
  assert(!readAgentInputSchema.safeParse({ assignment: asg }).success);
  assert(agentsList.input.safeParse({ place }).success);
  assert(!agentsList.input.safeParse({}).success);
  assert(!agentsList.input.safeParse({ place, state: "enabled" }).success);
});

Deno.test("lophn-agent/agents#R13: a profile image upload takes png, jpg or webp up to 1 MiB and never svg", () => {
  const input = {
    place,
    assignment: asg,
    content_type: "image/png",
    bytes: 1024,
  };
  assert(uploadAgentProfileInputSchema.safeParse(input).success);
  for (const content_type of ["image/jpeg", "image/webp"]) {
    assert(
      uploadAgentProfileInputSchema.safeParse({ ...input, content_type })
        .success,
    );
  }
  for (const content_type of ["image/svg+xml", "image/gif", "text/html"]) {
    assert(
      !uploadAgentProfileInputSchema.safeParse({ ...input, content_type })
        .success,
      content_type,
    );
  }
  assert(
    uploadAgentProfileInputSchema.safeParse({ ...input, bytes: 1_048_576 })
      .success,
  );
  assert(
    !uploadAgentProfileInputSchema.safeParse({ ...input, bytes: 1_048_577 })
      .success,
  );
  assert(
    !uploadAgentProfileInputSchema.safeParse({ ...input, bytes: 0 }).success,
  );
  assertEquals(agentProfilesUpload.max_bytes, 1_048_576);
  assert(
    agentProfilesUpload.output.safeParse({
      profile: { kind: "image", image: "avatar.png" },
    }).success,
  );
  assert(
    !agentProfilesUpload.output.safeParse({
      profile: { kind: "image", image: "avatar.svg" },
    }).success,
  );
  assertEquals(agentProfilesRead.kind, "file");
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: the upload route declares unavailable for a failed image write", () => {
  assertEquals(agentProfilesUpload.errors, [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ]);
});

Deno.test("lophn-agent/agents#R10: place settings belong to one project or app and carry only models and permissions", () => {
  for (const target of [place, { kind: "app", id: app }]) {
    assert(
      readPlaceAgentSettingsInputSchema.safeParse({ place: target }).success,
    );
  }
  // Workspace 층은 agent-model-defaults와 platform/settings가 맡는다.
  assert(
    !readPlaceAgentSettingsInputSchema.safeParse({
      place: { kind: "workspace" },
    }).success,
  );
  assert(!readPlaceAgentSettingsInputSchema.safeParse({}).success);
  const change = (settings: unknown) =>
    changePlaceAgentSettingsInputSchema.safeParse({ place, settings })
      .success;
  assert(change({}));
  assert(change({ models: { operator: model }, permissions: { tools: [] } }));
  assert(!change({ contexts: [] }));
  assert(!change({ profile: { kind: "icon", icon: "dock" } }));
  assert(placeAgentSettingsChange.compare?.safeParse({ hash: null }).success);
  assertEquals(placeAgentSettingsRead.name, "ReadPlaceAgentSettings");
  assertEquals(placeAgentSettingsChange.name, "ChangePlaceAgentSettings");
});

Deno.test("lophn-agent/agents#R28: save, delete and settings change leave a hash-only event", () => {
  assertEquals(AGENT_EVENTS.map((event) => event.type), [
    "AgentSaved",
    "AgentDeleted",
    "PlaceAgentSettingsChanged",
  ]);
  assert(
    agentSaved.payload.safeParse({
      place,
      role: "operator",
      before_hash: null,
      after_hash: hash,
    }).success,
  );
  // 내용의 전후는 event에 실리지 않는다: 이전 내용을 되돌려 읽는 길이 없다.
  const payload = agentSaved.payload.parse({
    place,
    role: "operator",
    before_hash: null,
    after_hash: hash,
    before: "the old text",
  });
  assertEquals(Object.keys(payload).sort(), [
    "after_hash",
    "before_hash",
    "place",
    "role",
  ]);
  assert(agentSaved.subject.safeParse(asg).success);
  assert(!agentSaved.subject.safeParse(prj).success);
  assert(placeAgentSettingsChanged.subject.safeParse(prj).success);
  assert(placeAgentSettingsChanged.subject.safeParse(app).success);
  assert(!placeAgentSettingsChanged.subject.safeParse(null).success);
  assert(!placeAgentSettingsChanged.subject.safeParse(asg).success);
  assert(
    placeAgentSettingsChanged.payload.safeParse({
      place,
      before_hash: hash,
      after_hash: hash,
    }).success,
  );
});

const meta = { as_of_seq: "42", next_cursor: null };
const workspace = { layer: "workspace", place: null };

Deno.test("lophn-agent/agents#R12 lophn-agent/agents#R24: read returns the definition with each value's source, or the reasons the file is wrong", () => {
  const effective = {
    name: { value: "Reviewer", source: { layer: "definition", place } },
    profile: { value: { kind: "icon", icon: "roles" }, source: workspace },
    model: { value: model, source: workspace },
    permissions: { value: { tools: ["document.list"] }, source: workspace },
  };
  const read = {
    ...meta,
    assignment: asg,
    role: "operator",
    kind: "operator",
    place,
    definition: { name: "Reviewer", body: "Review." },
    hash,
    effective,
    issues: [],
  };
  assert(agentsRead.output.safeParse(read).success);
  const broken = {
    ...read,
    definition: null,
    effective: { ...effective, model: null },
    issues: [{ field: "contexts.1", code: "duplicate" }],
  };
  assert(agentsRead.output.safeParse(broken).success);
  const unsourced = { ...effective, model: { value: model } };
  assert(
    !agentsRead.output.safeParse({ ...read, effective: unsourced }).success,
  );
  assert(
    agentIssuesDetailsSchema.safeParse({
      issues: [{ field: "name", code: "required" }],
    }).success,
  );
  assert(!agentIssuesDetailsSchema.safeParse({ issues: [] }).success);
});

Deno.test("lophn-agent/agents#R7 lophn-agent/agents#R12: list returns rows and settings read returns the place, its fields and the model each role really uses", () => {
  const row = {
    assignment: asg,
    role: "lophn",
    kind: "built_in",
    name: "lophn",
    profile: { kind: "icon", icon: "dock" },
    model: null,
    state: "enabled",
    counts: { contexts: null, skills: 0, mcp: 0 },
    issues: [],
  };
  assert(agentsList.output.safeParse({ ...meta, agents: [row] }).success);
  assert(
    !agentsList.output.safeParse({
      ...meta,
      agents: [{ ...row, kind: "operator" }],
    })
      .success,
  );
  const settings = {
    ...meta,
    place,
    settings: { models: { operator: model } },
    hash,
    effective_models: {
      lophn: { value: model, source: workspace },
      operator: { value: model, source: { layer: "place", place } },
    },
  };
  assert(placeAgentSettingsRead.output.safeParse(settings).success);
  assert(
    !placeAgentSettingsRead.output.safeParse({
      ...settings,
      effective_models: { boss: { value: model, source: workspace } },
    }).success,
  );
});

Deno.test("lophn-agent/agents#R16: run preparation reads the place's active contexts as machine, and every agent read is open to it", () => {
  // built-in agent의 context는 실행 때 자리 project의 active 전부로 풀리므로 준비하는 machine이 목록을 읽는다.
  assert(contextListRoute.actors.includes("machine"));
  // 정의 파일, 자리 설정, Workspace 기본 model도 같은 길로 읽는다.
  for (const route of [agentsRead, placeAgentSettingsRead]) {
    assert(route.actors.includes("machine"));
  }
});
