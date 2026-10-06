// AppDetailSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만 옮긴 것이다.
import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type {
  AccessKind,
  AccessView,
  ActivityRow,
  AppDecision,
  AppDetailSource,
  BlueprintView,
  Comparison,
  GrantRow,
  SourceResult,
  VersionRow,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 10;
const PREVIEW_POLLS = 40;
const PREVIEW_POLL_MS = 250;

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다(contracts#T13).
const PARENT_WINDOW = "requesting-window";

/** preload의 보호 창 열기. 없는 창에서는 undefined다. */
export type OpenDecision = (
  intent: {
    request: {
      kind: "owner_decision";
      concern: string;
      decision: string;
      targets: string[];
    };
    parentWindow: string;
  },
) => Promise<unknown>;

export function windowDecision(): OpenDecision | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenDecision };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

const read = <T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: unknown,
) => call<T>(core, "read", resource, method, body);

interface Paged {
  next_cursor: string | null;
}

/** 목록 read를 끝까지 모은다. */
async function collect<T, P extends Paged>(
  core: CoreSource,
  resource: string,
  body: Record<string, unknown>,
  items: (page: P) => T[],
): Promise<SourceResult<T[]>> {
  const found: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result: SourceResult<P> = await read<P>(
      core,
      resource,
      "list",
      cursor === undefined ? body : { ...body, cursor },
    );
    if (!result.ok) return result;
    found.push(...items(result.value));
    if (result.value.next_cursor === null) break;
    cursor = result.value.next_cursor;
  }
  return { ok: true, value: found };
}

interface ReleaseValue {
  id: string;
  number: number;
  status: VersionRow["status"];
  created_at: string;
  ticket_source: { ticket: string } | null;
  tests: string[];
  failure: { summary: string } | null;
  data_schema: number;
}

function versionOf(value: ReleaseValue): VersionRow {
  return {
    id: value.id,
    number: value.number,
    status: value.status,
    createdAt: value.created_at,
    ticket: value.ticket_source?.ticket ?? null,
    tests: value.tests,
    failure: value.failure?.summary ?? null,
    dataFormat: value.data_schema,
  };
}

interface ComparisonValue {
  previous_release: string | null;
  added_permissions: string[];
  removed_permissions: string[];
  added_commands: string[];
  removed_commands: string[];
  command_changes: { command: string; kinds: string[] }[];
  external_commands: string[];
  added_automations: string[];
  removed_automations: string[];
  changed_automations: string[];
  added_screens: string[];
  removed_screens: string[];
  changed_screens: string[];
  data_schema: { from: number; to: number };
  data_changes: { description: string }[];
  review_required: boolean;
}

function comparisonOf(value: ComparisonValue): Comparison {
  return {
    previous: value.previous_release,
    addedPermissions: value.added_permissions,
    removedPermissions: value.removed_permissions,
    addedCommands: value.added_commands,
    removedCommands: value.removed_commands,
    changedCommands: value.command_changes.map((change) => ({
      command: change.command,
      kinds: change.kinds,
    })),
    externalCommands: value.external_commands,
    addedAutomations: value.added_automations,
    removedAutomations: value.removed_automations,
    changedAutomations: value.changed_automations,
    addedScreens: value.added_screens,
    removedScreens: value.removed_screens,
    changedScreens: value.changed_screens,
    dataFrom: value.data_schema.from,
    dataTo: value.data_schema.to,
    dataChanges: value.data_changes.map((change) => change.description),
    reviewRequired: value.review_required,
  };
}

type Scope =
  | { path: string }
  | { host: string; port: number }
  | { name: string }
  | { key: string }
  | { app: string; commands: string[] }
  | { commands: string[] }
  | { automation: string; command: string; input_hash: string };

function exactOf(scope: Scope): string {
  if ("path" in scope) return scope.path;
  if ("host" in scope) return `${scope.host}:${scope.port}`;
  if ("name" in scope) return scope.name;
  if ("key" in scope) return scope.key;
  if ("automation" in scope) return scope.automation;
  if ("app" in scope) return scope.app;
  return scope.commands.join(", ");
}

interface GrantValue {
  id: string;
  kind: AccessKind;
  scope: Scope;
  status: "active" | "revoked";
}

function grantOf(value: GrantValue): GrantRow {
  const scope = value.scope;
  return {
    id: value.id,
    kind: value.kind,
    active: value.status === "active",
    exact: exactOf(scope),
    targetApp: "app" in scope ? scope.app : null,
    commands: "commands" in scope ? scope.commands : [],
    automation: "automation" in scope ? scope.automation : null,
    inputHash: "input_hash" in scope ? scope.input_hash : null,
  };
}

interface BlueprintValue {
  release: string;
  commands: { key: string; label: string }[];
  screens: { key: string; sizes: string[] }[];
  automations: {
    key: string;
    label: string;
    command: string;
    when: { kind: "on_start" } | { kind: "interval"; interval_ms: number };
  }[];
  declarations: {
    app_connections: { app: string; commands: string[] }[];
    automations: { key: string; external: boolean; input_hash: string }[];
  };
}

function blueprintOf(value: BlueprintValue): BlueprintView {
  return {
    release: value.release,
    commands: value.commands.map((command) => ({
      key: command.key,
      label: command.label,
    })),
    automations: value.automations.map((automation) => {
      const declared = value.declarations.automations.find((entry) =>
        entry.key === automation.key
      );
      return {
        key: automation.key,
        label: automation.label,
        command: automation.command,
        when: automation.when.kind === "on_start"
          ? { kind: "on_start" }
          : { kind: "interval", intervalMs: automation.when.interval_ms },
        external: declared?.external ?? false,
        inputHash: declared?.input_hash ?? "",
      };
    }),
    fullScreen:
      value.screens.find((screen) => screen.sizes.includes("full"))?.key ??
        null,
    connections: value.declarations.app_connections.map((entry) => ({
      app: entry.app,
      commands: entry.commands,
    })),
  };
}

interface InvocationValue {
  id: string;
  status: ActivityRow["status"];
  operation: ActivityRow["operation"];
  trigger: ActivityRow["trigger"];
  mode: ActivityRow["mode"];
  caller: { kind: ActivityRow["caller"]; app?: string };
  started_at: string | null;
  finished_at: string | null;
}

function activityOf(value: InvocationValue): ActivityRow {
  return {
    id: value.id,
    status: value.status,
    operation: value.operation,
    trigger: value.trigger,
    mode: value.mode,
    caller: value.caller.kind,
    callerApp: value.caller.app ?? null,
    at: value.finished_at ?? value.started_at,
  };
}

/** 결정 하나가 열 보호 창의 대상. 정확한 값은 창이 core를 다시 읽어 보인다. */
function intentOf(decision: AppDecision) {
  switch (decision.kind) {
    case "use_version":
      return {
        concern: "apps/releases",
        decision: "start_activation",
        targets: [decision.release],
      };
    case "change_access":
      return {
        concern: "apps/permissions",
        decision: "grant_access",
        targets: [decision.app],
      };
    case "remove_access":
      return {
        concern: "apps/permissions",
        decision: "revoke_grant",
        targets: [decision.grant],
      };
    case "turn_on_automation":
      return {
        concern: "apps/automations",
        decision: "enable_automation",
        targets: [decision.app],
      };
    case "connect_apps":
      return {
        concern: "apps/connections",
        decision: "connect_apps",
        targets: [decision.app],
      };
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function coreAppDetailSource(
  core: CoreSource,
  openDecision: OpenDecision | undefined = windowDecision(),
): AppDetailSource {
  return {
    async versions(app) {
      const [releases, current] = await Promise.all([
        collect<ReleaseValue, { releases: ReleaseValue[] } & Paged>(
          core,
          "releases",
          { app, limit: 200 },
          (page) => page.releases,
        ),
        read<{ app: { active_release: string | null } }>(core, "apps", "get", {
          app,
        }),
      ]);
      if (!releases.ok) return releases;
      if (!current.ok) return current;
      return {
        ok: true,
        value: {
          current: current.value.app.active_release,
          versions: releases.value.map(versionOf).sort((a, b) =>
            b.number - a.number
          ),
        },
      };
    },

    async compare(release) {
      const result = await read<{ comparison: ComparisonValue }>(
        core,
        "releases",
        "compare",
        { release },
      );
      return result.ok
        ? { ok: true, value: comparisonOf(result.value.comparison) }
        : result;
    },

    async testResults(tests) {
      const found = await Promise.all(tests.map(async (id) => {
        const result = await read<{ verification: { result: string } }>(
          core,
          "problems",
          "get-verification",
          { verification: id, detail: false },
        );
        return result.ok
          ? {
            ok: true as const,
            value: {
              id,
              result: result.value.verification.result as
                | "pass"
                | "fail"
                | "inconclusive",
            },
          }
          : result;
      }));
      const failed = found.find((entry) => !entry.ok);
      if (failed && !failed.ok) return failed;
      return {
        ok: true,
        value: found.flatMap((entry) => entry.ok ? [entry.value] : []),
      };
    },

    async taskChecks(ticket) {
      const result = await read<{
        completion_seq: string | null;
        checks: { result: "pass" | "fail" | "inconclusive" }[];
      }>(core, "tickets", "checks", { ticket });
      if (!result.ok) return result;
      const checks = result.value.checks;
      return {
        ok: true,
        value: {
          reported: result.value.completion_seq !== null,
          passed: checks.filter((check) => check.result === "pass").length,
          failed: checks.filter((check) => check.result === "fail").length,
          unclear:
            checks.filter((check) => check.result === "inconclusive").length,
        },
      };
    },

    async startCheck(app) {
      const result = await read<{
        observation: {
          release: string | null;
          mode: string;
          ready: boolean;
        } | null;
      }>(core, "apps", "runtime", { app });
      if (!result.ok) return result;
      const observation = result.value.observation;
      return {
        ok: true,
        value: observation === null || observation.mode !== "live"
          ? null
          : { release: observation.release, ready: observation.ready },
      };
    },

    async blueprint(app) {
      const result = await read<BlueprintValue>(core, "apps", "blueprint", {
        app,
      });
      if (!result.ok) {
        return result.code === "not_found" ? { ok: true, value: null } : result;
      }
      return { ok: true, value: blueprintOf(result.value) };
    },

    async access(app) {
      const result = await read<
        {
          grants: GrantValue[];
          display?: {
            requirements: {
              kind: AccessKind;
              scope: Scope;
              reason: string;
              granted: boolean;
            }[];
            combination_warnings: { key: string }[];
          } | null;
        } & Paged
      >(core, "grants", "list", { app, limit: 200 });
      if (!result.ok) return result;
      const display = result.value.display ?? null;
      const view: AccessView = {
        grants: result.value.grants.map(grantOf),
        requirements: (display?.requirements ?? []).map((requirement) => ({
          kind: requirement.kind,
          exact: exactOf(requirement.scope),
          reason: requirement.reason,
          granted: requirement.granted,
        })),
        warnings: (display?.combination_warnings ?? []).map((warning) =>
          warning.key
        ),
      };
      return { ok: true, value: view };
    },

    async runtime(app) {
      const result = await read<{
        state: {
          state: "preparing" | "stopped" | "running" | "unavailable";
          termination_pending: boolean;
        };
      }>(core, "apps", "runtime", { app });
      return result.ok
        ? {
          ok: true,
          value: {
            state: result.value.state.state,
            terminationPending: result.value.state.termination_pending,
          },
        }
        : result;
    },

    async secrets(names) {
      if (names.length === 0) return { ok: true, value: [] };
      const result = await read<{
        secrets: { name: string; configured: boolean }[];
      }>(core, "secrets", "list", { names });
      return result.ok
        ? {
          ok: true,
          value: result.value.secrets.map((secret) => ({
            name: secret.name,
            stored: secret.configured,
          })),
        }
        : result;
    },

    async automations(app) {
      const result = await read<{
        automations: { key: string; runnable: boolean; observed: boolean }[];
        observed_at: string | null;
      }>(core, "apps", "automations", { app });
      return result.ok
        ? {
          ok: true,
          value: {
            automations: result.value.automations.map((entry) => ({
              key: entry.key,
              runnable: entry.runnable,
              observed: entry.observed,
            })),
            observedAt: result.value.observed_at,
          },
        }
        : result;
    },

    async activity(app) {
      const result = await read<{ invocations: InvocationValue[] }>(
        core,
        "invocations",
        "list",
        { app, limit: 50 },
      );
      if (!result.ok) return result;
      const rows = result.value.invocations.map(activityOf);
      rows.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
      return { ok: true, value: rows };
    },

    async appName(app) {
      const result = await read<{ app: { name: string } }>(
        core,
        "apps",
        "get",
        { app },
      );
      return result.ok ? result.value.app.name : null;
    },

    async startPreview(app, release) {
      const got = await read<{ release: { bundle_hash: string } | null }>(
        core,
        "releases",
        "get",
        { release },
      );
      if (!got.ok) return got;
      if (got.value.release === null) {
        return { ok: false, code: "not_found" };
      }
      const started = await read<{ process_nonce: string }>(
        core,
        "previews",
        "start",
        {
          input: {
            app,
            bundle_hash: got.value.release.bundle_hash,
            release,
            fixture_hash: null,
          },
        },
      );
      if (!started.ok) return started;
      const nonce = started.value.process_nonce;
      // 시작 요청은 준비 전에 돌아온다. 앱 view는 준비된 preview에만 붙는다.
      for (let poll = 0; poll < PREVIEW_POLLS; poll += 1) {
        const seen = await read<{
          observation: { ready: boolean; reason?: unknown } | null;
        }>(core, "previews", "get", { app, process_nonce: nonce });
        if (!seen.ok) return seen;
        const observation = seen.value.observation;
        if (observation?.ready) return { ok: true, value: { nonce } };
        if (observation?.reason !== undefined) {
          return { ok: false, code: "unavailable" };
        }
        await wait(PREVIEW_POLL_MS);
      }
      return { ok: false, code: "unavailable" };
    },

    async stopPreview(app, preview) {
      await read(core, "previews", "stop", {
        app,
        process_nonce: preview.nonce,
      });
    },

    async decide(decision) {
      if (openDecision === undefined) {
        return { ok: false, code: "unavailable" };
      }
      try {
        const opened = await openDecision({
          request: { kind: "owner_decision", ...intentOf(decision) },
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: string; code?: string };
        return typeof opened?.windowId === "string"
          ? { ok: true, value: true }
          : { ok: false, code: opened?.code ?? "unavailable" };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    // grant.revoke는 앱의 grant 집합 seq를 비교 기준으로 받고 contract가 confirmation을 필수로
    // 둔다. 지금 grants.list는 그 seq를 내지 않고 automation.run의 확인 없는 회수 경로가 없어
    // 부를 수 없다(apps#T4·T20으로 넘김). 부를 수 없다고 알린다.
    turnOffAutomation: () =>
      Promise.resolve({ ok: false, code: "unavailable" }),
  };
}
