import { assert, assertEquals } from "@std/assert";
import {
  type AgentRole,
  agentsRead,
  modelDefaultsRead,
  placeAgentSettingsRead,
  providerRead,
  resolvedAgentSchema,
  runBody,
  sessionRead,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { contextList as documentContextList } from "../../packages/contracts/documents/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import {
  productEnvironment,
  resolveAgent,
  roleCapsOf,
} from "../../packages/lophn-agent/agents/mod.ts";
import type { RunCredentials } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { productDriver } from "./product-driver.ts";
import {
  APP,
  ASG,
  CTX1,
  CTX2,
  MODEL,
  openWorld,
  OTHER_PRJ,
  PRJ,
  PVD,
  PVD2,
  RUN,
  SES,
  type WorldOptions,
} from "./testing/world.ts";

// run 준비: preset 판 대신 resolved agent를 만들어 run 기준에 고정한다(lophn-agent/agents R25~R27,
// harness/run-loop). 층은 core의 읽기 route로 모으고 provider 전송은 쓰지 않는다.

const SELECTION = {
  run: RUN,
  assignment: ASG,
  stateSeq: "1",
  session: SES,
  reason: "priority" as const,
};

async function prepare(options: WorldOptions) {
  const world = openWorld(options);
  const prepared = await productDriver()(world.calls).prepare({
    ...SELECTION,
    session: options.session === null ? null : SES,
  });
  return { world, prepared };
}

type Basis = {
  agent: { hash: string; sources: Record<string, { layer: string }> };
  initial_work_place: unknown;
  [key: string]: unknown;
};

Deno.test("lophn-agent/agents#R25 [agent-I10a]: a run fixes a resolved agent — hash and sources in the basis, the full value in its own blob, no preset", async () => {
  const { world, prepared } = await prepare({
    workspaceModels: { lophn: MODEL() },
    activeContexts: [CTX1, CTX2],
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const basis = world.blob("run_basis") as Basis;
  assertEquals("preset" in basis, false);
  const stored = world.blob("run_agent");
  const agent = resolvedAgentSchema.parse(stored);
  assertEquals(basis.agent.hash, agent.hash);
  assertEquals(basis.agent.sources, JSON.parse(JSON.stringify(agent.sources)));
  assertEquals(basis.agent.sources["model"]?.layer, "workspace");
  assertEquals(agent.name, "lophn");
  assertEquals(agent.place, { kind: "project", id: PRJ });
  assertEquals(agent.tools, [...roleCapsOf("lophn")]);
  assertEquals(agent.contexts, [CTX1, CTX2]);
  assertEquals(basis.initial_work_place, { kind: "project", id: PRJ });
  // StartRun이 두 blob을 영구 참조로 등록하도록 hash와 크기를 함께 싣는다. agent blob의 hash는 값의 hash와 다르다.
  const begin = prepared.value.begin;
  assert(begin.agent !== undefined && begin.agentSize !== undefined);
  assert(begin.agentSize > 0);
  assert(begin.agent !== agent.hash);
});

Deno.test("lophn-agent/agents#R27 [agent-I10a]: a built-in agent takes the settings of the session's work place and no other place", async () => {
  const { world, prepared } = await prepare({
    session: { kind: "project", id: OTHER_PRJ },
    workspaceModels: { lophn: MODEL() },
    placeSettings: { models: { lophn: MODEL(PVD2) } },
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const place = { kind: "project" as const, id: OTHER_PRJ };
  assertEquals(world.bodiesOf(routePath(agentsRead)), [{
    place,
    assignment: ASG,
  }]);
  assertEquals(world.bodiesOf(routePath(placeAgentSettingsRead)), [{ place }]);
  const agent = resolvedAgentSchema.parse(world.blob("run_agent"));
  assertEquals(agent.model.provider, PVD2);
  assertEquals(agent.sources.model, { layer: "place", place });
  assertEquals(agent.place, place);
});

Deno.test("lophn-agent/agents#R16 [agent-I10a]: a built-in agent in an app place has no context and says why, and never asks for the project's contexts", async () => {
  const { world, prepared } = await prepare({
    session: { kind: "app", id: APP },
    workspaceModels: { lophn: MODEL() },
    activeContexts: [CTX1],
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const agent = resolvedAgentSchema.parse(world.blob("run_agent"));
  assertEquals(agent.contexts, []);
  assertEquals(agent.contexts_reason, "no_project");
  assertEquals(world.bodiesOf(routePath(documentContextList)), []);
});

Deno.test("lophn-agent/agents#R9 lophn-agent/agents#R15 [agent-I10a]: an Operator takes its definition's model, contexts and the assignment's place even without a session", async () => {
  const { world, prepared } = await prepare({
    role: "operator",
    session: null,
    workspaceModels: { operator: MODEL() },
    definition: {
      name: "Reviewer",
      model: MODEL(PVD2),
      contexts: [CTX2],
      body: "Check the notes.",
    },
    activeContexts: [CTX1, CTX2],
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const place = { kind: "project" as const, id: PRJ };
  assertEquals(world.bodiesOf(routePath(agentsRead)), [{
    place,
    assignment: ASG,
  }]);
  const agent = resolvedAgentSchema.parse(world.blob("run_agent"));
  assertEquals(agent.name, "Reviewer");
  assertEquals(agent.model.provider, PVD2);
  assertEquals(agent.sources.model.layer, "definition");
  assertEquals(agent.contexts, [CTX2]);
  assertEquals(agent.tools, [...roleCapsOf("operator")]);
  // 제공 tool은 정의가 받은 목록이다: Operator는 문서를 만들거나 ticket을 만들지 못한다.
  const loop = prepared.value.loop(
    { run: RUN, assignment: ASG, token: "token", credential_ref: "cred" },
    { run: RUN, state_seq: "1", basis: "a".repeat(64) },
  );
  const context = await loop.deps.ports.context();
  assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
  const names = context.value.tools.map((tool) => tool.name);
  assert(names.includes("document.read_version"));
  assert(!names.includes("ticket.create"));
});

Deno.test("lophn-agent/agents#R21 lophn-agent/agents#R22 [agent-I10a]: the tools a run offers are the role's caps narrowed by the definition's permissions", async () => {
  const { prepared } = await prepare({
    workspaceModels: { lophn: MODEL() },
    definition: {
      permissions: {
        tools: ["document.list", "project.list", "ticket.create"],
      },
      body: "",
    },
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const loop = prepared.value.loop(
    { run: RUN, assignment: ASG, token: "token", credential_ref: "cred" },
    { run: RUN, state_seq: "1", basis: "a".repeat(64) },
  );
  const context = await loop.deps.ports.context();
  assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
  const names = context.value.tools.map((tool) => tool.name).sort();
  // 역할 상한 안의 이름만 남고 정의에 없는 동작은 빠진다.
  assert(names.includes("document.list"));
  assert(!names.includes("document.search"));
  assert(!names.includes("app.list"));
});

Deno.test("lophn-agent/agents#R25 lophn-agent/harness/run-loop#R5 [agent-I10a]: no model in any layer — the run does not start and ends with the reason", async () => {
  const { world, prepared } = await prepare({ workspaceModels: {} });
  assert(!prepared.ok);
  assertEquals(world.finished.length, 1);
  assertEquals(world.finished[0]!.input["outcome"], {
    kind: "failed",
    reason: "configuration_unavailable",
  });
  // 이유는 run 결과에 남고, 시작하지 않았으므로 기준 blob은 없다.
  assertEquals(world.blob("run_result"), { run: RUN, why: "model_required" });
  assertEquals(
    world.blobs.some((blob) => blob.purpose === "run_basis"),
    false,
  );
});

Deno.test("lophn-agent/agents#R24 [agent-I10a]: a wrong definition file or place settings file keeps that agent from starting, with the reason", async () => {
  const wrong = await prepare({
    workspaceModels: { lophn: MODEL() },
    agentIssues: [{ field: "model.provider", code: "missing_reference" }],
  });
  assert(!wrong.prepared.ok);
  assertEquals(wrong.world.finished.length, 1);
  assertEquals(wrong.world.blob("run_result"), {
    run: RUN,
    why: "agent_invalid",
  });
  const settings = await prepare({
    workspaceModels: { lophn: MODEL() },
    placeSettingsInvalid: true,
  });
  assert(!settings.prepared.ok);
  assertEquals(settings.world.blob("run_result"), {
    run: RUN,
    why: "agent_invalid",
  });
});

Deno.test("lophn-agent/agents#R27 lophn-agent/harness/model#R27 [agent-I11]: the model the session chose is the highest layer and its source is the session", async () => {
  const chosen = {
    ...MODEL(PVD2),
    option_values: { effort: "high" },
  };
  const { world, prepared } = await prepare({
    sessionModel: chosen,
    workspaceModels: { lophn: MODEL() },
    placeSettings: { models: { lophn: MODEL(PVD) } },
  });
  assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
  const agent = resolvedAgentSchema.parse(world.blob("run_agent"));
  assertEquals(agent.model, chosen);
  assertEquals(agent.sources.model, { layer: "session", place: null });
  const basis = world.blob("run_basis") as Basis;
  assertEquals(basis.agent.sources["model"]?.layer, "session");
  // 선택한 session만 바뀐다: 층의 다른 값은 그대로 합쳐진다.
  assertEquals(agent.place, { kind: "project", id: PRJ });
});

Deno.test("lophn-agent/agents#R27 lophn-agent/harness/model#R27 [agent-I11]: a session without a choice falls back to the lower layers, and a run without a session reads none", async () => {
  const fallback = await prepare({
    sessionModel: null,
    workspaceModels: { lophn: MODEL() },
  });
  assert(fallback.prepared.ok);
  const agent = resolvedAgentSchema.parse(fallback.world.blob("run_agent"));
  assertEquals(agent.sources.model?.layer, "workspace");
  // session 없는 run(Operator가 받은 일)은 session을 읽지 않고 선택도 없다.
  const none = await prepare({
    role: "operator",
    session: null,
    workspaceModels: { operator: MODEL() },
    definition: { name: "Reviewer", body: "Check the notes." },
  });
  assert(none.prepared.ok);
  assertEquals(none.world.bodiesOf(routePath(sessionRead)), []);
  assertEquals(
    resolvedAgentSchema.parse(none.world.blob("run_agent")).sources.model
      ?.layer,
    "workspace",
  );
});

Deno.test("lophn-agent/harness/model#R18 lophn-agent/harness/model#R27 [agent-I11]: resuming uses the model the run fixed even after the session chose another one", async () => {
  const fixed = MODEL(PVD2);
  const resolved = await resolveAgent({
    assignment: ASG,
    role: "lophn" as AgentRole,
    place: { kind: "project", id: PRJ },
    definition: null,
    workspace: { models: { lophn: MODEL(PVD) } },
    place_settings: {},
    session_model: fixed,
    environment: productEnvironment("lophn", {
      skills: [],
      mcp: [],
      active_contexts: [],
    }),
  });
  assert(resolved.ok);
  assertEquals(resolved.value.sources.model?.layer, "session");
  const basis = {
    agent: { hash: resolved.value.hash, sources: resolved.value.sources },
    initial_work_place: { kind: "project", id: PRJ },
  };
  // 그 사이 session은 다른 model을 골랐다. 다음 run부터 쓰고 이 run은 고정한 값으로 이어 간다.
  const world = openWorld({
    sessionModel: MODEL(PVD, "other"),
    basisBody: basis,
    agentBody: resolved.value,
  });
  const resumed = await productDriver()(world.calls).prepareResume!(
    RUN,
    {} as RunCredentials,
  );
  assert(resumed.ok, resumed.ok ? "" : JSON.stringify(resumed.error));
  assertEquals(world.bodiesOf(routePath(sessionRead)), []);
  assertEquals(
    world.bodiesOf(routePath(providerRead)).map((body) =>
      (body as { provider: string }).provider
    ),
    [PVD2],
  );
});

Deno.test("lophn-agent/agents#R26 [agent-I10a]: resuming uses the resolved agent the run fixed and reads no definition or setting again", async () => {
  const resolved = await resolveAgent({
    assignment: ASG,
    role: "lophn" as AgentRole,
    place: { kind: "project", id: PRJ },
    definition: null,
    workspace: { models: { lophn: MODEL(PVD2) } },
    place_settings: {},
    session_model: null,
    environment: productEnvironment("lophn", {
      skills: [],
      mcp: [],
      active_contexts: [CTX1],
    }),
  });
  assert(resolved.ok);
  const basis = {
    agent: { hash: resolved.value.hash, sources: resolved.value.sources },
    initial_work_place: { kind: "project", id: PRJ },
  };
  const world = openWorld({
    // 지금의 Workspace 기본은 다른 provider다. 고정한 값이 이긴다.
    workspaceModels: { lophn: MODEL(PVD) },
    basisBody: basis,
    agentBody: resolved.value,
  });
  const resumed = await productDriver()(world.calls).prepareResume!(
    RUN,
    {} as RunCredentials,
  );
  assert(resumed.ok, resumed.ok ? "" : JSON.stringify(resumed.error));
  for (
    const route of [
      agentsRead,
      placeAgentSettingsRead,
      modelDefaultsRead,
      documentContextList,
    ]
  ) {
    assertEquals(world.bodiesOf(routePath(route)), []);
  }
  assertEquals(
    world.bodiesOf(routePath(providerRead)).map((body) =>
      (body as { provider: string }).provider
    ),
    [PVD2],
  );
  assertEquals(world.bodiesOf(routePath(runBody)).length, 2);
});

Deno.test("lophn-agent/agents#R26 [agent-I10a]: a fixed agent that is missing or does not match the basis hash is not resumed", async () => {
  const resolved = await resolveAgent({
    assignment: ASG,
    role: "lophn",
    place: { kind: "project", id: PRJ },
    definition: null,
    workspace: { models: { lophn: MODEL() } },
    place_settings: {},
    session_model: null,
    environment: productEnvironment("lophn", {
      skills: [],
      mcp: [],
      active_contexts: [],
    }),
  });
  assert(resolved.ok);
  const basis = {
    agent: { hash: resolved.value.hash, sources: resolved.value.sources },
    initial_work_place: { kind: "project", id: PRJ },
  };
  const missing = openWorld({ basisBody: basis });
  const first = await productDriver()(missing.calls).prepareResume!(
    RUN,
    {} as RunCredentials,
  );
  assert(!first.ok);
  const other = openWorld({
    basisBody: basis,
    agentBody: { ...resolved.value, hash: "c".repeat(64) },
  });
  const second = await productDriver()(other.calls).prepareResume!(
    RUN,
    {} as RunCredentials,
  );
  assert(!second.ok);
});
