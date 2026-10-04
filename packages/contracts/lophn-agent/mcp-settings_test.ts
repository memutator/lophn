import { assert } from "@std/assert";
import { settingDefinitionSchema } from "../platform/mod.ts";
import {
  extensionSettingsSchema,
  mcpAuthSchema,
  mcpServerConfigSchema,
  mcpServersSetting,
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
