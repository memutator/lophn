import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath, settingDefinitionSchema } from "../platform/mod.ts";
import {
  changePlaceExtensionSettingsInputSchema,
  EXTENSION_EVENTS,
  EXTENSION_ROUTES,
  extensionSettingsSchema,
  mcpAuthBegin,
  mcpAuthBeginInputSchema,
  mcpAuthComplete,
  mcpAuthCompleteInputSchema,
  mcpAuthSchema,
  mcpServerConfigSchema,
  mcpServersSetting,
  placeExtensionSettingsChange,
  placeExtensionSettingsChanged,
  placeExtensionSettingsRead,
  readPlaceExtensionSettingsInputSchema,
} from "./mcp-settings.ts";

const hash = "ab".repeat(32);

const stdio = {
  name: "notes",
  revision: 1,
  enabled: false,
  transport: "stdio",
  call_timeout_ms: 60_000,
  classifications: {
    search: { effect: "read", schema_hash: hash, reversible: false },
  },
  stdio: {
    executable: "/usr/bin/notes",
    args: [],
    cwd: null,
    env: {},
  },
};

Deno.test("lophn-agent/extensions#R13: transport is stdio or streamable http, never sse", () => {
  assert(mcpServerConfigSchema.safeParse(stdio).success);
  assert(
    mcpServerConfigSchema.safeParse({
      name: "remote",
      revision: 1,
      enabled: true,
      transport: "http",
      call_timeout_ms: 1000,
      classifications: {},
      http: {
        url: "https://mcp.example.test/rpc",
        headers: {},
        auth: { kind: "none" },
      },
    }).success,
  );
  assert(
    !mcpServerConfigSchema.safeParse({ ...stdio, transport: "sse" }).success,
  );
  assert(
    mcpServerConfigSchema.safeParse({
      ...stdio,
      stdio: {
        ...stdio.stdio,
        executable: "/usr/bin/notes",
      },
      http: { url: "https://x", headers: {}, auth: { kind: "none" } },
    }).success === false,
  );
});

Deno.test("lophn-agent/extensions#R16: auth is none, bearer, api key or oauth 2.1", () => {
  assert(mcpAuthSchema.safeParse({ kind: "none" }).success);
  assert(
    mcpAuthSchema.safeParse({ kind: "bearer", secret_ref: "sec:notes.token" })
      .success,
  );
  assert(
    mcpAuthSchema.safeParse({
      kind: "api_key",
      secret_ref: "sec:notes.key",
      header_name: "X-Api-Key",
    }).success,
  );
  assert(
    mcpAuthSchema.safeParse({
      kind: "oauth2",
      issuer: "https://issuer.example.test",
      client_id: "lophn",
      client_secret_ref: null,
      scopes: [],
      token_ref: null,
    }).success,
  );
  assert(!mcpAuthSchema.safeParse({ kind: "basic", user: "a" }).success);
});

Deno.test("lophn-agent/extensions#R19: call timeout is one to six hundred seconds", () => {
  assert(mcpServerConfigSchema.safeParse(stdio).success);
  assert(
    !mcpServerConfigSchema.safeParse({ ...stdio, call_timeout_ms: 999 })
      .success,
  );
  assert(
    !mcpServerConfigSchema.safeParse({
      ...stdio,
      call_timeout_ms: 600_001,
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R26: a tool classification is read, write or external", () => {
  assert(
    extensionSettingsSchema.safeParse({
      revision: 1,
      registered_folders: [],
      mcp_servers: [stdio],
    }).success,
  );
  assert(
    !extensionSettingsSchema.safeParse({
      revision: 1,
      registered_folders: [],
      mcp_servers: [stdio, { ...stdio, name: "notes" }],
    }).success,
  );
  assert(
    !mcpServerConfigSchema.safeParse({
      ...stdio,
      classifications: {
        search: { effect: "confirm", schema_hash: hash, reversible: false },
      },
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R12: the server list is one setting definition and rejects an unknown field", () => {
  const published = {
    key: mcpServersSetting.key,
    owner: mcpServersSetting.owner,
    display_name_key: mcpServersSetting.display_name_key,
    description: mcpServersSetting.description,
    value_meaning_key: mcpServersSetting.value_meaning_key,
    default_meaning_key: mcpServersSetting.default_meaning_key,
    affected_features: [...mcpServersSetting.affected_features],
    risk_key: mcpServersSetting.risk_key,
    revert_key: mcpServersSetting.revert_key,
    constraints: mcpServersSetting.constraints,
    required: mcpServersSetting.required,
    layers: [...mcpServersSetting.layers],
    apply_at: mcpServersSetting.apply_at,
    apply_at_key: mcpServersSetting.apply_at_key,
    machine_local: mcpServersSetting.machine_local,
    value_type: { type: "array" },
    default_present: true,
    default: [],
  };
  assert(settingDefinitionSchema.safeParse(published).success);
  assert(mcpServersSetting.value_type.safeParse([stdio]).success);
  assert(
    !mcpServersSetting.value_type.safeParse([{ ...stdio, token: "raw" }])
      .success,
  );
  assert(
    !mcpServerConfigSchema.safeParse({
      ...stdio,
      classifications: {
        search: {
          effect: "read",
          schema_hash: hash,
          reversible: false,
          grant: "ses_01arz3ndektsv4rrffq69g5fav",
        },
      },
    }).success,
  );
});

const prj = "prj_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const asg = "asg_01arz3ndektsv4rrffq69g5fav";
const projectPlace = { kind: "project", id: prj };
const appPlace = { kind: "app", id: app };

Deno.test("lophn-agent/extensions#R32 [agent-I19b, agent-I49]: two routes read and change the MCP servers of one place, a person alone changes them, and the global skills list is read beside them", () => {
  assertEquals(EXTENSION_ROUTES.map(routePath), [
    "/v1/place-extension-settings/read",
    "/v1/place-extension-settings/change",
    "/v1/global-skills/read",
  ]);
  assertEquals(EXTENSION_ROUTES.map((route) => route.kind), [
    "read",
    "command",
    "read",
  ]);
  assertEquals(placeExtensionSettingsRead.name, "ReadPlaceExtensionSettings");
  assertEquals(
    placeExtensionSettingsChange.name,
    "ChangePlaceExtensionSettings",
  );
  // 서버 등록은 사람만 정한다(R11): 변경은 user 하나, 읽기는 화면과 run 준비(machine)가 한다.
  assertEquals([...placeExtensionSettingsChange.actors], ["user"]);
  assert(placeExtensionSettingsRead.actors.includes("user"));
  assert(placeExtensionSettingsRead.actors.includes("machine"));
  for (const route of EXTENSION_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assert(!route.errors.includes("internal"));
  }
  assert(
    placeExtensionSettingsChange.compare?.safeParse({ hash: null }).success,
  );
  assert(
    placeExtensionSettingsChange.compare?.safeParse({ hash: "ab".repeat(32) })
      .success,
  );
  assert(!placeExtensionSettingsChange.compare?.safeParse({}).success);
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: the place is a project or an app and nothing else", () => {
  for (const place of [projectPlace, appPlace]) {
    assert(readPlaceExtensionSettingsInputSchema.safeParse({ place }).success);
    assert(
      changePlaceExtensionSettingsInputSchema.safeParse({
        place,
        mcp_servers: [],
      }).success,
    );
  }
  // 전역(Workspace)은 이 route가 아니라 platform/settings가 맡는다.
  assert(
    !readPlaceExtensionSettingsInputSchema.safeParse({
      place: { kind: "workspace" },
    }).success,
  );
  assert(!readPlaceExtensionSettingsInputSchema.safeParse({}).success);
  assert(
    !readPlaceExtensionSettingsInputSchema.safeParse({
      place: { kind: "project", id: asg },
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: a place list holds each server name once and nothing but servers", () => {
  const change = (mcp_servers: unknown, extra: Record<string, unknown> = {}) =>
    changePlaceExtensionSettingsInputSchema.safeParse({
      place: projectPlace,
      mcp_servers,
      ...extra,
    }).success;
  assert(change([stdio]));
  assert(!change([stdio, { ...stdio, revision: 2 }]));
  assert(!change([{ ...stdio, token: "raw" }]));
  // 선택은 agent 정의가 한다: 이 목록에 끈 서버나 tool 칸은 없다.
  assert(!change([stdio], { mcp_servers_off: [] }));
  assert(!change([stdio], { skills: [] }));
  assert(
    !change(
      Array.from({ length: 33 }, (_, index) => ({
        ...stdio,
        name: `server${index}`,
      })),
    ),
  );
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: a change leaves a hash-only event on the place", () => {
  assertEquals(EXTENSION_EVENTS.map((event) => event.type), [
    "PlaceExtensionSettingsChanged",
  ]);
  assert(placeExtensionSettingsChanged.subject.safeParse(prj).success);
  assert(placeExtensionSettingsChanged.subject.safeParse(app).success);
  assert(!placeExtensionSettingsChanged.subject.safeParse(asg).success);
  const payload = placeExtensionSettingsChanged.payload.parse({
    place: projectPlace,
    before_hash: null,
    after_hash: hash,
    mcp_servers: [stdio],
  });
  // 서버 설정(경로·헤더·secret 참조)은 event에 싣지 않는다. 전후는 hash뿐이다.
  assertEquals(Object.keys(payload).sort(), [
    "after_hash",
    "before_hash",
    "place",
  ]);
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: the read answers the servers, the file hash and the skills a place sees with the ones it hides", () => {
  const output = placeExtensionSettingsRead.output;
  const base = {
    place: projectPlace,
    settings: { revision: 1, mcp_servers: [stdio] },
    hash,
    skills: [
      { name: "review", description: "Review", source_kind: "place" },
      { name: "audit", description: "Audit", source_kind: "bundled" },
    ],
    shadowed: [{ name: "review", kept: "place", hidden: "registered" }],
    skipped: [{ path: "/data/projects/x/skills/Bad", reason: "bad name" }],
    as_of_seq: "1",
    next_cursor: null,
  };
  assert(output.safeParse(base).success);
  assert(output.safeParse({ ...base, hash: null }).success);
  assert(
    !output.safeParse({
      ...base,
      skills: [{ name: "x", description: "x", source_kind: "workspace" }],
    }).success,
  );
  assert(
    !output.safeParse({
      ...base,
      settings: { revision: 0, mcp_servers: [] },
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R16 [agent-I50]: OAuth begin and complete name the place the server is registered in, or null for a global server", () => {
  assertEquals(mcpAuthBegin.name, "BeginMcpAuth");
  assertEquals(mcpAuthComplete.name, "CompleteMcpAuth");
  const begin = (place: unknown) =>
    mcpAuthBeginInputSchema.safeParse({
      name: "notes",
      client_id: "lophn",
      scopes: [],
      place,
    }).success;
  const complete = (place: unknown) =>
    mcpAuthCompleteInputSchema.safeParse({
      name: "notes",
      callback_port: 4321,
      place,
    }).success;
  for (const accept of [begin, complete]) {
    assert(accept(projectPlace));
    assert(accept(appPlace));
    // 전역(Workspace) 서버는 자리 없이 null이다.
    assert(accept(null));
    // 자리 칸은 빠질 수 없고 project·app 밖의 모양이나 맞지 않는 id는 거절이다.
    assert(!accept(undefined));
    assert(!accept({ kind: "workspace" }));
    assert(!accept({ kind: "project", id: asg }));
    assert(!accept({ kind: "app", id: prj }));
  }
  // 자리 없는 옛 입력 모양은 받지 않는다.
  assert(
    !mcpAuthBeginInputSchema.safeParse({
      name: "notes",
      client_id: "lophn",
      scopes: [],
    }).success,
  );
  assert(
    !mcpAuthCompleteInputSchema.safeParse({
      name: "notes",
      callback_port: 4321,
    }).success,
  );
});
