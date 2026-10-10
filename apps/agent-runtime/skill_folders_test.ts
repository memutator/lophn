import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { grantsList } from "../../packages/contracts/apps/mod.ts";
import {
  assignmentRead,
  type CatalogEntry,
  mcpServersSetting,
  presetRead,
  providerRead,
  runRead,
  skillFoldersSetting,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  routePath,
  settingsGet,
} from "../../packages/contracts/platform/mod.ts";
import { RUN_LIMIT_SETTING_KEYS } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import type { CatalogRefresherHandle } from "./catalog.ts";
import type { CoreCall } from "./core-call.ts";
import type { CoreCalls } from "./main.ts";
import { productDriver } from "./product-driver.ts";

const SUFFIX = "01arz3ndektsv4rrffq69g5fav";
const RUN = `run_${SUFFIX}`;
const ASG = `asg_${SUFFIX}`;
const PST = `pst_${SUFFIX}`;
const PVD = `pvd_${SUFFIX}`;
const MSG = `msg_${SUFFIX}`;
const HASH = "ab".repeat(32);
const AT = "2026-10-05T00:00:00.000Z";

function readMeta() {
  return { as_of_seq: "1", next_cursor: null };
}

function setting(key: string, value: unknown, resolved: boolean) {
  return {
    key,
    resolved,
    value: resolved ? value : null,
    source_layer: resolved ? "common" as const : null,
    choices: [],
    revision: 1,
    apply_at: "next_run" as const,
  };
}

Deno.test("extensions#R1: 등록 폴더의 유효한 SKILL.md만 run context skills에 남고 잘못된 이름은 빠진다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-scan-" });
  const root = `${home}/registered`;
  const outside = `${home}/outside/other`;
  try {
    await Deno.mkdir(`${root}/review-notes/nested`, { recursive: true });
    await Deno.mkdir(`${root}/bad-notes`, { recursive: true });
    await Deno.mkdir(outside, { recursive: true });
    await Deno.writeTextFile(
      `${root}/review-notes/SKILL.md`,
      "---\nname: review-notes\ndescription: Reads review notes\n---\n본문\n",
    );
    await Deno.writeTextFile(
      `${root}/review-notes/nested/SKILL.md`,
      "---\nname: nested-notes\ndescription: Nested skill\n---\n본문\n",
    );
    await Deno.writeTextFile(
      `${root}/bad-notes/SKILL.md`,
      "---\nname: Bad_Name\ndescription: Bad skill name\n---\n본문\n",
    );
    await Deno.writeTextFile(
      `${outside}/SKILL.md`,
      "---\nname: other-notes\ndescription: Outside the registered folder\n---\n본문\n",
    );
    await Deno.symlink(outside, `${root}/alias`);

    const calls = fakeCalls(root);
    const driver = productDriver()(calls);
    const prepared = await driver.prepare({
      run: RUN,
      assignment: ASG,
      stateSeq: "1",
      reason: "priority",
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const loop = prepared.value.loop(
      {
        run: RUN,
        assignment: ASG,
        token: "token",
        credential_ref: "cred",
      },
      { run: RUN, state_seq: "1", basis: HASH },
    );
    const context = await loop.deps.ports.context();
    assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
    assertEquals(
      context.value.skills.map((skill) => skill.name),
      ["review-notes"],
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

function fakeCalls(root: string): CoreCalls {
  const machine: CoreCall = (path, body) => {
    if (path === routePath(runRead)) return reply(runRead.output, runRecord());
    if (path === routePath(assignmentRead)) {
      return reply(assignmentRead.output, assignmentRecord());
    }
    if (path === routePath(presetRead)) {
      return reply(presetRead.output, presetRecord());
    }
    if (path === routePath(providerRead)) {
      return reply(providerRead.output, providerRecord());
    }
    if (path === routePath(grantsList)) {
      return reply(grantsList.output, { grants: [], ...readMeta() });
    }
    if (path === routePath(settingsGet)) {
      const keys = (body as { keys?: readonly string[] }).keys ?? [];
      return reply(settingsGet.output, settingsRecord(root, keys));
    }
    return Promise.resolve(
      err({ code: "not_found", message: `no fixture for ${path}` }),
    );
  };
  const entry: CatalogEntry = {
    provider_definition: "local",
    model_name: "gpt",
    context_limit: 128000,
    input_limit: 120000,
    output_limit: 8000,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    reasoning: {
      mode: "named",
      levels: ["low", "high"],
      minimum_budget: null,
      maximum_budget: null,
      default_level: "low",
    },
    preview: false,
    deprecated: null,
    source: "models_dev",
    source_revision: "2026-10",
    checked_at: AT,
    received_at: AT,
    price_basis: null,
  };
  const store = {
    entries: [entry],
    state: {
      auto_update: false,
      etag: null,
      last_checked_at: null,
      last_received_at: null,
      last_failure: null,
      snapshot_hash: HASH,
    },
  };
  const catalog: CatalogRefresherHandle = {
    load: () => Promise.resolve(ok(store)),
    kickAutoUpdate() {},
    refreshNow: () => Promise.resolve(ok(store)),
  };
  return {
    machine,
    agentCall: () => () =>
      Promise.resolve(err({ code: "unavailable", message: "no agent call" })),
    blobs: {
      prepare: (_purpose, bytes) =>
        Promise.resolve(ok({ hash: HASH, size_bytes: bytes.length })),
    },
    redact: (text) => Promise.resolve(text),
    catalog,
  };
}

function reply(
  schema: {
    safeParse(
      value: unknown,
    ): { success: boolean; error?: { message: string } };
  },
  value: unknown,
): Promise<Result<unknown>> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return Promise.resolve(err({
      code: "internal",
      message: parsed.error?.message ?? "fixture does not match",
    }));
  }
  return Promise.resolve(ok(value));
}

function settingsRecord(root: string, keys: readonly string[]) {
  const values = new Map<string, unknown>([
    [skillFoldersSetting.key, [root]],
    [mcpServersSetting.key, []],
    [RUN_LIMIT_SETTING_KEYS.model_attempts, 30],
    [RUN_LIMIT_SETTING_KEYS.stall_ms, 300_000],
    [RUN_LIMIT_SETTING_KEYS.active_ms, 1_800_000],
  ]);
  return {
    settings: keys.map((key) =>
      setting(key, values.get(key) ?? null, values.has(key))
    ),
    revision: 1,
    defaults_revision: "defaults-1",
    ...readMeta(),
  };
}

function runRecord() {
  return {
    run: {
      id: RUN,
      assignment: ASG,
      session: null,
      source: { kind: "message", message: MSG },
      continued_from: null,
      start_after: null,
      start_confirmed_seq: null,
      state: "accepted",
      basis: null,
      waiting_on: null,
      started_at: null,
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
      finished_at: null,
      outcome: null,
      result: null,
      state_seq: "1",
      accepted_seq: "1",
    },
    ...readMeta(),
  };
}

function assignmentRecord() {
  return {
    assignment: {
      id: ASG,
      role: "lophn",
      preset: PST,
      preset_revision: 1,
      scope: { kind: "all", id: null },
      outputs: [],
      read_apps: [],
      read_commands: [],
      schedule: null,
      approval: null,
      state: "enabled",
      pause_reason: null,
      last_due_at: null,
      revision: 1,
    },
    ...readMeta(),
  };
}

function presetRecord() {
  return {
    preset: {
      id: PST,
      revision: 1,
      definition_hash: HASH,
      definition: {
        kind: "lophn",
        name: "lophn",
        origin: "product",
        prompt: HASH,
        capability: { bundles: [], tools: [] },
        context: [],
        mcp: { servers: [], tools: [] },
        safe_tools: [],
        skills: [],
        model: {
          provider: PVD,
          credentials: [],
          model_name: "gpt",
          reasoning_level: "low",
          options: {},
        },
        organizing_model: null,
        instructions: [],
      },
    },
    ...readMeta(),
  };
}

function providerRecord() {
  return {
    provider: {
      id: PVD,
      name: "Local",
      definition: {
        key: "local",
        display_name: "Local",
        protocols: ["openai-responses"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-10",
      },
      endpoint: "http://127.0.0.1:9",
      protocol: "openai-responses",
      enabled: true,
      credentials: [],
      last_check: null,
      revision: 1,
    },
    ...readMeta(),
  };
}
