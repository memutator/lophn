// agent-I34: Agents 탭·Operator editor의 core 통로. fake core로 route 이름·입력·비교 기준과 응답을 화면 모양으로
// 옮기는 일, 거절의 항목별 이유(R24)가 그대로 나오는지를 본다. 실제 core 위의 흐름은 core-source-real-core_test가 본다.
import { assert, assertEquals } from "@std/assert";

import type {
  AgentIssue,
  AgentListRow,
  ValueSource,
} from "../../../../../packages/protocol/lophn-agent/agent-values.ts";
import type { CatalogEntry } from "../../../../../packages/protocol/lophn-agent/models.ts";
import type { AgentEffective } from "./views.ts";
import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type { InstructionsApi } from "../../../ipc/instructions.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreAgentsSource } from "./core-source.ts";

const PROJECT = "prj_01k6p0000000000000000000aa";
const PLACE = { kind: "project", id: PROJECT };
const OPERATOR = "asg_01k6p0000000000000000000a2";
const PROVIDER = "pvd_01k6p0000000000000000000a1";
const HASH = "a".repeat(64);
const NEXT_HASH = "b".repeat(64);
const WORKSPACE: ValueSource = { layer: "workspace", place: null };
const SONNET = {
  provider: PROVIDER,
  model_name: "Sonnet 5.5",
  option_values: { effort: "medium" },
};
const HAIKU = {
  provider: PROVIDER,
  model_name: "Haiku 5.5",
  option_values: {},
};
const META = { as_of_seq: "1", next_cursor: null };

type Route = (body: Record<string, unknown>) => CoreReply | Promise<CoreReply>;

function routedCore(
  routes: Record<string, Route>,
): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        const route = routes[`${input.kind}:${input.resource}/${input.method}`];
        return Promise.resolve(
          route
            ? route(input.body as Record<string, unknown>)
            : { ok: false, error: { code: "not_found", message: "" } },
        );
      },
    },
  };
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });
const fail = (code: string, details?: unknown): CoreReply => ({
  ok: false,
  error: {
    code,
    message: `${code} message`,
    ...(details === undefined ? {} : { details }),
  } as { code: string; message: string },
});

const ROW: AgentListRow = {
  assignment: OPERATOR,
  role: "operator",
  kind: "operator",
  name: "Release notes",
  profile: { kind: "icon", icon: "edit" },
  model: { provider: PROVIDER, model_name: "Sonnet 5.5", source: WORKSPACE },
  state: "enabled",
  issues: [],
  counts: { contexts: 1, skills: 1, mcp: 1 },
};

const SERVER = {
  name: "github",
  revision: 2,
  enabled: true,
  call_timeout_ms: 60000,
  classifications: {},
  transport: "stdio",
  stdio: { executable: "/usr/bin/github-mcp", args: [], env: {} },
};

function settingsRead(
  settings: Record<string, unknown>,
  hash: string | null = HASH,
): CoreReply {
  return ok({
    place: PLACE,
    settings,
    hash,
    effective_models: { operator: { value: SONNET, source: WORKSPACE } },
    ...META,
  });
}

function extensionsRead(servers: unknown[] = [SERVER]): CoreReply {
  return ok({
    place: PLACE,
    settings: { revision: 1, mcp_servers: servers },
    hash: HASH,
    skills: [{
      name: "summarize-notes",
      description: "Summarize notes",
      source_kind: "place",
    }],
    shadowed: [],
    skipped: [],
    ...META,
  });
}

const COMMON_READS: Record<string, Route> = {
  "read:agents/list": () => ok({ agents: [ROW], ...META }),
  "read:place-agent-settings/read": () =>
    settingsRead({ permissions: { tools: ["documents.read"] } }),
  "read:place-extension-settings/read": () => extensionsRead(),
  "read:global-skills/read": () =>
    ok({
      skills: [],
      skills_off: ["summarize-notes"],
      shadowed: [],
      skipped: [],
      ...META,
    }),
};

Deno.test("shell/workspace#R36 [agent-I34]: overview는 목록·자리 설정·확장 설정을 읽어 탭 값으로 옮긴다", async () => {
  const { core, calls } = routedCore({
    ...COMMON_READS,
    "read:place-agent-settings/read": () =>
      settingsRead({
        models: { context_engineer: HAIKU },
        permissions: { tools: ["documents.read", "documents.edit"] },
      }),
  });
  const result = await coreAgentsSource(core, { instructions: undefined })
    .overview(PROJECT);
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.agents, [ROW]);
  assertEquals(result.value.chosenModels, { context_engineer: HAIKU });
  assertEquals(result.value.effectiveModels, {
    operator: { value: SONNET, source: WORKSPACE },
  });
  // project가 끈 skill은 전역 skills_off를 따른다.
  assertEquals(result.value.skills, [{ name: "summarize-notes", on: false }]);
  assertEquals(result.value.mcpServers, [{ name: "github", on: true }]);
  assertEquals(result.value.permissions, [
    { tool: "documents.read", label: "documents.read", on: true },
    { tool: "documents.edit", label: "documents.edit", on: true },
  ]);
  assertEquals(result.value.instructions, { text: "" });
  assertEquals(calls[0], {
    kind: "read",
    resource: "agents",
    method: "list",
    body: { place: PLACE },
  });
});

Deno.test("shell/workspace#R36 [agent-I34]: 목록이나 자리 설정을 읽지 못하면 overview는 core의 오류 code로 실패하고 확장 설정은 못 읽어도 그 칸만 비운다", async () => {
  const failing = routedCore({
    ...COMMON_READS,
    "read:agents/list": () => fail("unavailable"),
  });
  assertEquals(
    await coreAgentsSource(failing.core, { instructions: undefined })
      .overview(PROJECT),
    { ok: false, message: "unavailable" },
  );
  const settingsDown = routedCore({
    ...COMMON_READS,
    "read:place-agent-settings/read": () => fail("forbidden"),
  });
  assertEquals(
    await coreAgentsSource(settingsDown.core, { instructions: undefined })
      .overview(PROJECT),
    { ok: false, message: "forbidden" },
  );
  const extensionsDown = routedCore({
    ...COMMON_READS,
    "read:place-extension-settings/read": () => fail("unavailable"),
  });
  const partial = await coreAgentsSource(extensionsDown.core, {
    instructions: undefined,
  }).overview(PROJECT);
  assert(partial.ok);
  assertEquals(partial.value.skills, []);
  assertEquals(partial.value.mcpServers, []);
  assertEquals(partial.value.agents.length, 1);
});

Deno.test("shell/workspace#R37 [agent-I34]: project의 LOPHN.md는 지침 통로가 연 문서의 본문에서 읽고 파일이 없으면 빈 글이다", async () => {
  const bridge = (
    document: string | null,
  ): InstructionsApi => ({
    open: () =>
      Promise.resolve({
        ok: true,
        value: { document, version: document === null ? null : "ver_1" },
      }),
    create: () => Promise.reject(new Error("not used")),
  });
  const { core, calls } = routedCore({
    ...COMMON_READS,
    "worker:documents/read": () =>
      ok({
        text: "# phroner\nShort answers.",
        complete: true,
        next_cursor: null,
      }),
  });
  const read = await coreAgentsSource(core, { instructions: bridge("doc_1") })
    .overview(PROJECT);
  assert(read.ok);
  assertEquals(read.value.instructions, { text: "# phroner\nShort answers." });
  const worker = calls.find((call) => call.kind === "worker")!;
  assertEquals(worker.body, {
    reference: { document: "doc_1", version: "ver_1", section: null },
  });

  const absent = await coreAgentsSource(core, { instructions: bridge(null) })
    .overview(PROJECT);
  assert(absent.ok);
  assertEquals(absent.value.instructions, { text: "" });
});

Deno.test("shell/workspace#R38 [agent-I34]: 새 Operator 저장은 assignment 없이 hash null을 비교 기준으로 보내고 새 id와 hash를 돌려준다", async () => {
  const { core, calls } = routedCore({
    "command:agents/save": () =>
      ok({ assignment: OPERATOR, role: "operator", hash: HASH }),
  });
  const result = await coreAgentsSource(core).saveAgent(PROJECT, {
    assignment: null,
    hash: null,
    definition: { name: "Digest", body: "Summarize." },
  });
  assertEquals(result, {
    ok: true,
    value: { assignment: OPERATOR, role: "operator", hash: HASH },
  });
  const body = calls[0]!.body as Record<string, unknown>;
  assertEquals(body.input, {
    place: PLACE,
    definition: { name: "Digest", body: "Summarize." },
  });
  assertEquals(body.compare, { hash: null });
  assertEquals(body.prepared, []);
  assert(typeof body.idempotency_key === "string");
  assertEquals(calls[0]!.kind, "command");
});

Deno.test("shell/workspace#R38 [agent-I34]: 있는 Operator 저장은 assignment와 읽을 때의 hash를 싣는다", async () => {
  const { core, calls } = routedCore({
    "command:agents/save": () =>
      ok({ assignment: OPERATOR, role: "operator", hash: NEXT_HASH }),
  });
  await coreAgentsSource(core).saveAgent(PROJECT, {
    assignment: OPERATOR,
    hash: HASH,
    definition: { body: "x" },
  });
  const body = calls[0]!.body as Record<string, unknown>;
  assertEquals(
    (body.input as Record<string, unknown>).assignment,
    OPERATOR,
  );
  assertEquals(body.compare, { hash: HASH });
});

Deno.test("shell/workspace#R24 [agent-I34]: 저장 거절의 항목별 이유는 invalid_input의 details에서 그대로 나오고 다른 오류는 code만 나온다", async () => {
  const issues: AgentIssue[] = [
    { field: "name", code: "reserved_name" },
    { field: "contexts.1", code: "missing_reference" },
  ];
  const refused = await coreAgentsSource(
    routedCore({
      "command:agents/save": () => fail("invalid_input", { issues }),
    }).core,
  ).saveAgent(PROJECT, {
    assignment: null,
    hash: null,
    definition: { body: "" },
  });
  assertEquals(refused, { ok: false, message: "invalid_input", issues });

  const conflict = await coreAgentsSource(
    routedCore({
      "command:agents/save": () => fail("conflict"),
    }).core,
  ).saveAgent(PROJECT, {
    assignment: OPERATOR,
    hash: HASH,
    definition: { body: "" },
  });
  assertEquals(conflict, { ok: false, message: "conflict", issues: [] });

  // details가 모양에 맞지 않으면 이유 목록을 꾸며 내지 않는다.
  const odd = await coreAgentsSource(
    routedCore({
      "command:agents/save": () => fail("invalid_input", { issues: "nope" }),
    }).core,
  ).saveAgent(PROJECT, {
    assignment: null,
    hash: null,
    definition: { body: "" },
  });
  assertEquals(odd, { ok: false, message: "invalid_input", issues: [] });
});

Deno.test("shell/workspace#R38 [agent-I34]: Operator 삭제는 assignment와 읽을 때의 hash로 보낸다", async () => {
  const { core, calls } = routedCore({
    "command:agents/delete": () => ok({ assignment: OPERATOR, hash: HASH }),
  });
  assertEquals(
    await coreAgentsSource(core).deleteAgent(PROJECT, OPERATOR, HASH),
    { ok: true, value: null },
  );
  const body = calls[0]!.body as Record<string, unknown>;
  assertEquals(body.input, { assignment: OPERATOR });
  assertEquals(body.compare, { hash: HASH });
});

Deno.test("shell/workspace#R38 [agent-I34]: readAgent는 정의·hash·칸별 값과 출처·이유를 editor 값으로 옮기고 파일이 틀렸으면 빈 정의에 이유를 싣는다", async () => {
  const effective: AgentEffective = {
    name: { value: "Release notes", source: WORKSPACE },
    profile: {
      value: { kind: "icon", icon: "edit" },
      source: { layer: "default", place: null },
    },
    model: { value: SONNET, source: WORKSPACE },
    permissions: {
      value: { tools: ["documents.read"] },
      source: { layer: "default", place: null },
    },
  };
  const base = {
    assignment: OPERATOR,
    role: "operator",
    kind: "operator",
    place: PLACE,
    effective,
    ...META,
  };
  const good = routedCore({
    "read:agents/read": () =>
      ok({
        ...base,
        definition: { name: "Release notes", body: "Watch.", contexts: [] },
        hash: HASH,
        issues: [],
      }),
  });
  const read = await coreAgentsSource(good.core).readAgent(PROJECT, OPERATOR);
  assert(read.ok, JSON.stringify(read));
  assertEquals(read.value, {
    assignment: OPERATOR,
    role: "operator",
    kind: "operator",
    definition: { name: "Release notes", body: "Watch.", contexts: [] },
    hash: HASH,
    effective,
    issues: [],
  });
  assertEquals(good.calls[0]!.body, { place: PLACE, assignment: OPERATOR });

  const broken = routedCore({
    "read:agents/read": () =>
      ok({
        ...base,
        definition: null,
        hash: HASH,
        issues: [{ field: "frontmatter", code: "malformed" }],
      }),
  });
  const bad = await coreAgentsSource(broken.core).readAgent(PROJECT, OPERATOR);
  assert(bad.ok);
  assertEquals(bad.value.definition, { body: "" });
  assertEquals(bad.value.hash, HASH);
  assertEquals(bad.value.issues, [{ field: "frontmatter", code: "malformed" }]);
});

Deno.test("shell/workspace#R38 [agent-I34]: newOperator는 assignment 없이 hash가 null이고 상속 model은 자리 설정이 준 operator 값이다", async () => {
  const { core } = routedCore(COMMON_READS);
  const result = await coreAgentsSource(core).newOperator(PROJECT);
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.assignment, null);
  assertEquals(result.value.role, "operator");
  assertEquals(result.value.kind, "operator");
  assertEquals(result.value.hash, null);
  assertEquals(result.value.definition, { body: "" });
  assertEquals(result.value.effective.model, {
    value: SONNET,
    source: WORKSPACE,
  });
  assertEquals(result.value.effective.permissions.value, {
    tools: ["documents.read"],
  });
});

Deno.test("shell/workspace#R37 [agent-I34]: role의 model을 고르면 자리 설정을 읽어 그 칸만 바꾸고 읽을 때의 hash로 보내며 비우면 칸을 뺀다", async () => {
  const changes: Record<string, unknown>[] = [];
  let current: Record<string, unknown> = {
    models: { operator: SONNET, lophn: HAIKU },
    permissions: { tools: ["documents.read"] },
  };
  const { core } = routedCore({
    "read:place-agent-settings/read": () => settingsRead(current),
    "command:place-agent-settings/change": (body) => {
      changes.push(body);
      current = (body.input as { settings: Record<string, unknown> }).settings;
      return ok({ place: PLACE, hash: NEXT_HASH });
    },
  });
  const source = coreAgentsSource(core);
  assertEquals(await source.changeRoleModel(PROJECT, "operator", HAIKU), {
    ok: true,
    value: null,
  });
  assertEquals(changes[0]!.input, {
    place: PLACE,
    settings: {
      models: { operator: HAIKU, lophn: HAIKU },
      permissions: { tools: ["documents.read"] },
    },
  });
  assertEquals(changes[0]!.compare, { hash: HASH });

  await source.changeRoleModel(PROJECT, "operator", null);
  await source.changeRoleModel(PROJECT, "lophn", null);
  // 마지막 model까지 비우면 models 칸 자체가 없다.
  assertEquals(changes.at(-1)!.input, {
    place: PLACE,
    settings: { permissions: { tools: ["documents.read"] } },
  });
});

Deno.test("shell/workspace#R37 [agent-I34]: 자리 설정이 바뀌어 conflict면 그 code가 그대로 나온다", async () => {
  const { core } = routedCore({
    "read:place-agent-settings/read": () => settingsRead({}),
    "command:place-agent-settings/change": () => fail("conflict"),
  });
  assertEquals(
    await coreAgentsSource(core).changeRoleModel(PROJECT, "operator", HAIKU),
    { ok: false, message: "conflict" },
  );
});

Deno.test("shell/workspace#R37 [agent-I34]: Permissions 켬·끔은 자리 설정의 권한 목록에서 그 동작만 더하고 뺀다", async () => {
  const changes: Record<string, unknown>[] = [];
  const { core } = routedCore({
    "read:place-agent-settings/read": () =>
      settingsRead({ permissions: { tools: ["documents.read"] } }),
    "command:place-agent-settings/change": (body) => {
      changes.push(body);
      return ok({ place: PLACE, hash: NEXT_HASH });
    },
  });
  const source = coreAgentsSource(core);
  await source.setPermission(PROJECT, "documents.edit", true);
  await source.setPermission(PROJECT, "documents.read", false);
  assertEquals(changes.map((change) => change.input), [
    {
      place: PLACE,
      settings: {
        permissions: { tools: ["documents.read", "documents.edit"] },
      },
    },
    { place: PLACE, settings: { permissions: { tools: [] } } },
  ]);
});

Deno.test("shell/workspace#R37 [agent-I34]: MCP server 켬·끔은 자리의 서버 목록 전체에서 그 서버의 enabled만 바꿔 읽을 때의 hash로 보낸다", async () => {
  const changes: Record<string, unknown>[] = [];
  const other = { ...SERVER, name: "linear", enabled: false };
  const { core } = routedCore({
    "read:place-extension-settings/read": () => extensionsRead([SERVER, other]),
    "command:place-extension-settings/change": (body) => {
      changes.push(body);
      return ok({ place: PLACE, hash: NEXT_HASH });
    },
  });
  const source = coreAgentsSource(core);
  assertEquals(await source.setMcp(PROJECT, "linear", true), {
    ok: true,
    value: null,
  });
  assertEquals(changes[0]!.input, {
    place: PLACE,
    mcp_servers: [SERVER, { ...other, enabled: true }],
  });
  assertEquals(changes[0]!.compare, { hash: HASH });
  assertEquals(await source.setMcp(PROJECT, "nope", true), {
    ok: false,
    message: "not_found",
  });
  assertEquals(changes.length, 1);
});

Deno.test("shell/workspace#R37 [agent-I34]: project 단위 skill 켬·끔 route는 없어 unavailable이다", async () => {
  const { core, calls } = routedCore(COMMON_READS);
  assertEquals(
    await coreAgentsSource(core).setSkill(PROJECT, "summarize-notes", false),
    { ok: false, message: "unavailable" },
  );
  assertEquals(calls, []);
});

Deno.test("shell/workspace#R41 [agent-I34]: models는 provider와 catalog와 즐겨찾기를 모으고 provider 목록은 cursor를 끝까지 따른다", async () => {
  const pages = [
    {
      providers: [{
        id: PROVIDER,
        name: "Anthropic",
        definition: { key: "anthropic" },
      }],
      next_cursor: "c1",
    },
    {
      providers: [{
        id: "pvd_01k6p0000000000000000000a2",
        name: "OpenAI",
        definition: { key: "openai" },
      }],
      next_cursor: null,
    },
  ];
  let page = 0;
  // 통로는 응답을 그대로 넘기므로 시험이 보는 칸만 둔다.
  const entry = {
    provider_definition: "anthropic",
    model_name: "Sonnet 5.5",
    options: null,
  } as unknown as CatalogEntry;
  const { core } = routedCore({
    "read:providers/list": () => ok(pages[page++]),
    "read:agent-model-catalog/read": () =>
      ok({ state: {}, entries: [entry], ...META }),
    "read:model-favorites/read": () =>
      ok({
        favorites: {
          items: [{ provider: PROVIDER, model_name: "Sonnet 5.5" }],
          settings_seq: "4",
        },
        ...META,
      }),
  });
  const result = await coreAgentsSource(core).models();
  assert(result.ok, JSON.stringify(result));
  assertEquals(result.value.providers, [
    { id: PROVIDER, name: "Anthropic", definition: "anthropic" },
    {
      id: "pvd_01k6p0000000000000000000a2",
      name: "OpenAI",
      definition: "openai",
    },
  ]);
  assertEquals(result.value.catalog, [entry]);
  assertEquals(result.value.favorites, [
    { provider: PROVIDER, model_name: "Sonnet 5.5" },
  ]);
});

Deno.test("shell/workspace#R41 [agent-I34]: 즐겨찾기를 바꾸면 읽은 settings_seq를 비교 기준으로 새 순서 전체를 보낸다", async () => {
  const changes: Record<string, unknown>[] = [];
  const items = [{ provider: PROVIDER, model_name: "Haiku 5.5" }];
  const { core } = routedCore({
    "read:model-favorites/read": () =>
      ok({ favorites: { items: [], settings_seq: "4" }, ...META }),
    "command:model-favorites/change": (body) => {
      changes.push(body);
      return ok({ favorites: { items, settings_seq: "5" } });
    },
  });
  assertEquals(await coreAgentsSource(core).setFavorites(items), {
    ok: true,
    value: items,
  });
  assertEquals(changes[0]!.input, { items });
  assertEquals(changes[0]!.compare, { settings_seq: "4" });
});

Deno.test("shell/workspace#R39 [agent-I34]: 이미지 올리기와 읽기는 renderer가 부를 수 있는 route가 없어 unavailable이고 주소는 비어 있다", async () => {
  const { core, calls } = routedCore({});
  const source = coreAgentsSource(core);
  assertEquals(
    await source.uploadImage(
      PROJECT,
      OPERATOR,
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
    ),
    { ok: false, message: "unavailable" },
  );
  assertEquals(source.imageSrc(PROJECT, OPERATOR, "avatar.png"), "");
  assertEquals(calls, []);
});
