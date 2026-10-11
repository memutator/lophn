import { err, ok, type Result, sha256Hex } from "../../../packages/base/mod.ts";
import { contextList } from "../../../packages/contracts/documents/mod.ts";
import { grantsList } from "../../../packages/contracts/apps/mod.ts";
import {
  type AgentDefinition,
  type AgentIssue,
  type AgentRole,
  type AgentSettings,
  agentsRead,
  assignmentRead,
  type CatalogEntry,
  finishRun,
  mcpServersSetting,
  modelDefaultsRead,
  placeAgentSettingsRead,
  providerRead,
  runBody,
  runRead,
  sessionRead,
  skillFoldersSetting,
} from "../../../packages/contracts/lophn-agent/mod.ts";
import {
  routePath,
  settingsGet,
} from "../../../packages/contracts/platform/mod.ts";
import { RUN_LIMIT_SETTING_KEYS } from "../../../packages/lophn-agent/harness/run-loop/mod.ts";
import type { CatalogRefresherHandle } from "../catalog.ts";
import type { CoreCall } from "../core-call.ts";
import type { CoreCalls } from "../main.ts";

// run 준비 시험이 함께 쓰는 가짜 core. 준비가 읽는 route만 고정한 값으로 답하고, 부른 route와 저장한 blob,
// 끝낸 run을 기록한다. 네트워크는 쓰지 않는다.

export const SUFFIX = "01arz3ndektsv4rrffq69g5fav";
export const RUN = `run_${SUFFIX}`;
export const ASG = `asg_${SUFFIX}`;
export const PST = `pst_${SUFFIX}`;
export const PVD = `pvd_${SUFFIX}`;
export const PVD2 = `pvd_${SUFFIX.slice(0, -1)}w`;
export const MSG = `msg_${SUFFIX}`;
export const SES = `ses_${SUFFIX}`;
export const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
export const OTHER_PRJ = "prj_01arz3ndektsv4rrffq69g5fa9";
export const APP = "app_01arz3ndektsv4rrffq69g5fa2";
export const CTX1 = "ctx_01arz3ndektsv4rrffq69g5fb1";
export const CTX2 = "ctx_01arz3ndektsv4rrffq69g5fb2";
export const HASH = "ab".repeat(32);
export const AT = "2026-10-05T00:00:00.000Z";

export const MODEL = (provider = PVD, model_name = "gpt") => ({
  provider,
  model_name,
  option_values: {} as Record<string, string>,
});

type Place = { kind: "project" | "app"; id: string };

export type WorldOptions = {
  role?: AgentRole;
  // assignment의 scope. 기본은 built-in이면 전역이고 Operator면 PRJ다.
  scope?: { kind: "all" | "project" | "app"; id: string | null };
  // 없으면 session 없는 run이다.
  session?: Place | null;
  workspaceModels?: Partial<Record<AgentRole, ReturnType<typeof MODEL>>>;
  placeSettings?: AgentSettings;
  placeSettingsInvalid?: boolean;
  definition?: AgentDefinition | null;
  agentIssues?: AgentIssue[];
  activeContexts?: string[];
  // 등록 skill 폴더 root. skill 이름은 그 폴더의 것이다.
  skillRoot?: string;
  // 이어 하기: run 기준과 resolved agent 본문.
  basisBody?: unknown;
  agentBody?: unknown;
  runSession?: boolean;
};

export type World = {
  calls: CoreCalls;
  log: { path: string; body: unknown }[];
  blobs: { purpose: string; value: unknown }[];
  finished: { input: Record<string, unknown> }[];
  paths(): string[];
  bodiesOf(path: string): unknown[];
  blob(purpose: string): unknown;
};

export function readMeta() {
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

export function reply(
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

function source(layer: string, place: Place | null = null) {
  return { layer, place };
}

export function openWorld(options: WorldOptions = {}): World {
  const role = options.role ?? "lophn";
  const scope = options.scope ??
    (role === "operator"
      ? { kind: "project" as const, id: PRJ }
      : role === "app_engineer"
      ? { kind: "app" as const, id: APP }
      : { kind: "all" as const, id: null });
  const session = options.session === undefined
    ? { kind: "project" as const, id: PRJ }
    : options.session;
  const log: World["log"] = [];
  const blobs: World["blobs"] = [];
  const finished: World["finished"] = [];

  const machine: CoreCall = (path, body) => {
    log.push({ path, body });
    if (path === routePath(runRead)) {
      return reply(runRead.output, runRecord(session !== null));
    }
    if (path === routePath(assignmentRead)) {
      return reply(assignmentRead.output, assignmentRecord(role, scope));
    }
    if (path === routePath(sessionRead)) {
      if (session === null) {
        return Promise.resolve(err({ code: "not_found", message: "none" }));
      }
      return reply(sessionRead.output, {
        session: sessionRecord(session),
        ...readMeta(),
      });
    }
    if (path === routePath(agentsRead)) {
      const input = body as { place: Place };
      return reply(agentsRead.output, {
        assignment: ASG,
        role,
        kind: role === "operator" ? "operator" : "built_in",
        place: input.place,
        definition: options.definition ?? null,
        hash: options.definition == null ? null : HASH,
        effective: {
          name: { value: "agent", source: source("default") },
          profile: {
            value: { kind: "icon", icon: "dock" },
            source: source("default"),
          },
          model: null,
          permissions: { value: { tools: [] }, source: source("default") },
        },
        issues: options.agentIssues ?? [],
        ...readMeta(),
      });
    }
    if (path === routePath(placeAgentSettingsRead)) {
      if (options.placeSettingsInvalid) {
        return Promise.resolve(err({
          code: "invalid_input",
          message: "place settings file is invalid",
        }));
      }
      return reply(placeAgentSettingsRead.output, {
        place: (body as { place: Place }).place,
        settings: options.placeSettings ?? {},
        hash: null,
        effective_models: {},
        ...readMeta(),
      });
    }
    if (path === routePath(modelDefaultsRead)) {
      const models = options.workspaceModels ?? {};
      return reply(modelDefaultsRead.output, {
        defaults: {
          lophn: models.lophn ?? null,
          context_engineer: models.context_engineer ?? null,
          app_engineer: models.app_engineer ?? null,
          operator: models.operator ?? null,
          summaries: null,
          settings_seq: "1",
        },
        ...readMeta(),
      });
    }
    if (path === routePath(contextList)) {
      return reply(contextList.output, {
        contexts: (options.activeContexts ?? []).map((id) => ({
          id,
          title: "context",
          purpose: "why",
          items: [],
          revision: "1",
          status: "active",
        })),
        complete: true,
        ...readMeta(),
      });
    }
    if (path === routePath(providerRead)) {
      const id = (body as { provider: string }).provider;
      return reply(providerRead.output, providerRecord(id));
    }
    if (path === routePath(grantsList)) {
      return reply(grantsList.output, { grants: [], ...readMeta() });
    }
    if (path === routePath(settingsGet)) {
      const keys = (body as { keys?: readonly string[] }).keys ?? [];
      return reply(settingsGet.output, settingsRecord(options, keys));
    }
    if (path === routePath(runBody)) {
      const kind = (body as { kind: string }).kind;
      const value = kind === "run_basis"
        ? options.basisBody
        : kind === "run_agent"
        ? options.agentBody
        : undefined;
      if (value === undefined) {
        return Promise.resolve(err({ code: "not_found", message: "none" }));
      }
      return reply(runBody.output, {
        kind,
        id: RUN,
        run: RUN,
        hash: HASH,
        size_bytes: 10,
        value,
        ...readMeta(),
      });
    }
    if (path === routePath(finishRun)) {
      const input = (body as { input: Record<string, unknown> }).input;
      finished.push({ input });
      return reply(finishRun.output, {
        id: RUN,
        state: "finished",
        state_seq: "2",
        outcome: input["outcome"],
        result: input["result"],
        finished_at: AT,
      });
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
    options: [],
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
  const calls: CoreCalls = {
    machine,
    agentCall: () => () =>
      Promise.resolve(err({ code: "unavailable", message: "no agent call" })),
    blobs: {
      async prepare(purpose, bytes) {
        blobs.push({
          purpose,
          value: JSON.parse(new TextDecoder().decode(bytes)),
        });
        return ok({ hash: await sha256Hex(bytes), size_bytes: bytes.length });
      },
    },
    redact: (text) => Promise.resolve(text),
    catalog,
  };
  return {
    calls,
    log,
    blobs,
    finished,
    paths: () => log.map((entry) => entry.path),
    bodiesOf: (path) =>
      log.filter((entry) => entry.path === path).map((entry) => entry.body),
    blob(purpose) {
      const found = blobs.find((blob) => blob.purpose === purpose);
      if (found === undefined) throw new Error(`no ${purpose} blob`);
      return found.value;
    },
  };
}

function settingsRecord(options: WorldOptions, keys: readonly string[]) {
  const values = new Map<string, unknown>([
    [
      skillFoldersSetting.key,
      options.skillRoot === undefined ? [] : [options.skillRoot],
    ],
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

function runRecord(hasSession: boolean) {
  return {
    run: {
      id: RUN,
      assignment: ASG,
      session: hasSession ? SES : null,
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

function sessionRecord(place: Place) {
  return {
    id: SES,
    assignment: ASG,
    work_place: place,
    title: null,
    archived: false,
    state: "open",
    forked_from: null,
    opening_context: null,
    model_selection: null,
    compaction: null,
    closed_reason: null,
    closed_at: null,
    state_seq: "1",
  };
}

function assignmentRecord(
  role: AgentRole,
  scope: { kind: string; id: string | null },
) {
  const operator = role === "operator";
  return {
    assignment: {
      id: ASG,
      role,
      preset: PST,
      preset_revision: 1,
      scope,
      // 구성 칸은 assignment 정리가 끝나면 사라진다. 그 전의 모양 검사를 지나도록 Operator만 채운다.
      outputs: operator
        ? [{ document: "doc_01arz3ndektsv4rrffq69g5fav", content: "notes" }]
        : [],
      read_apps: [],
      read_commands: [],
      schedule: operator ? { first_at: AT, every_ms: 60_000 } : null,
      approval: operator ? `apr_${SUFFIX}` : null,
      state: "enabled",
      pause_reason: null,
      last_due_at: null,
      revision: 1,
    },
    ...readMeta(),
  };
}

function providerRecord(id: string) {
  return {
    provider: {
      id,
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
