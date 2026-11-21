// app-detail이 core를 읽는 hook. 화면 값마다 route 여럿을 `useFollowedRead` 하나로 읽어 그 route들의 `reads`에 맞는
// 변경이 오면 다시 읽고, 이 화면이 쓰는 모양(source.ts의 view type)으로 옮긴다. 호출 기록과 grant에 나온 다른 앱·agent·session
// 이름은 목록마다 수가 달라 route로 따라가지 않고, 목록을 다시 읽을 때 한 번씩 읽는다.

import type { z } from "zod";

import {
  type ActivationQueueEntry,
  activationsCompare,
  activationsQueue,
  type AppGrant,
  appGet,
  appGrantsList,
  type AppInvocation,
  appInvocations,
  type AppRemoteCallRecord,
  appRemoteCalls,
  appRewindPlan,
  appRuntime,
  appSdkStatus,
  appsOAuthState,
  type AppToolCaller,
  noticesList,
  type ReleaseRecord,
  releasesGetRecord,
  releasesListRecords,
  type RewindPlan,
  appUpdateState,
  type UpdateState,
} from "../../../../protocol/apps/mod.ts";
import {
  appIcon,
  appTools,
} from "../../../../protocol/apps/declaration/read.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import {
  type MachineCandidate,
  resolveMachine,
} from "../../../../protocol/machine/requester.ts";
import { machinesList, rosterList } from "../../../../protocol/remote/mod.ts";
import { secretStatus } from "../../../../protocol/secrets/secret-file.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import {
  type ReadHandle,
  readRoute,
  readsOf,
  useCoreRead,
  useFollowedRead,
} from "../../desktop/connection/core-read.ts";
import {
  phoneCapabilityText,
  shortId,
} from "../../desktop/connection/waiting/model.ts";
import {
  iconViewOf,
  type IconView,
} from "../../parts/icon-upload/icon-reader.ts";
import type {
  AccessView,
  ActivationStep,
  MachinesView,
  ActivityRow,
  ActivityView,
  AppNoticeRow,
  AppToolRow,
  Caller,
  CallState,
  Effect,
  ReleaseCard,
  ReleaseChanges,
  ResourceKind,
  ResourceRow,
  RewindItem,
  RewindPlanView,
  RunState,
  RunView,
  SdkRow,
  SecretInfo,
  UnresolvedSubscription,
  VersionView,
} from "./source.ts";

const RELEASE_LIMIT = 200;
const GRANT_LIMIT = 200;
const ACTIVITY_LIMIT = 100;
const NOTICE_LIMIT = 20;

// 못 읽어도 화면을 막지 않는 읽기의 값. 실패는 null이다.
const valueOr = <T>(read: { ok: true; value: T } | { ok: false }) =>
  read.ok ? read.value : null;

/** 목록에 나온 이름들을 build 한 번 안에서 한 번만 읽는다. 못 읽으면 이름 없이 보인다. */
function lookups(core: CoreSource) {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    let found = cache.get(key) as Promise<T> | undefined;
    if (found === undefined) {
      found = read();
      cache.set(key, found);
    }
    return found;
  };
  return {
    appName: (app: string) =>
      once(
        `app:${app}`,
        async () =>
          valueOr(await readRoute(core, appGet, { app }))?.app.name ?? null,
      ),
    releaseNumber: (release: string) =>
      once(
        `release:${release}`,
        async () =>
          valueOr(await readRoute(core, releasesGetRecord, { release }))
            ?.release?.number ?? null,
      ),
    session: (session: string) =>
      once(`session:${session}`, async () => {
        const read = valueOr(
          await readRoute(core, workspaceSessionRead, { session }),
        );
        return read === null
          ? null
          : { agent: read.session.agent, title: read.session.title };
      }),
    // 부른 agent는 몇 안 되어 id마다 한 번 읽는다. lophn도 workspace마다 이름이 달라 그 id로 읽는다.
    agentName: (agent: string) =>
      once(
        `agent:${agent}`,
        async () =>
          valueOr(await readRoute(core, agentRead, { agent }))?.effective.name
            .value ?? null,
      ),
    // 다른 컴퓨터의 이름은 이 컴퓨터의 명단에서 찾는다. 명단에 없거나 읽지 못하면 짧은 id다.
    machineName: async (machine: string) =>
      (
        await once(`machines`, async () => {
          const read = valueOr(await readRoute(core, machinesList, {}));
          return new Map(
            (read?.machines ?? []).map((one) => [one.machine, one.name]),
          );
        })
      ).get(machine) ?? shortId(machine),
    tools: (app: string) =>
      once(`tools:${app}`, async () => {
        const read = valueOr(await readRoute(core, appTools, { app }));
        return new Map<string, Effect>(
          read === null
            ? []
            : read.tools.map((tool) => [tool.name, tool.effect]),
        );
      }),
  };
}

type Names = ReturnType<typeof lookups>;

// ---- Run, Icon, Folders ----

export function useRunView(app: string): ReadHandle<RunView> {
  return useFollowedRead<RunView>(
    async (core) => {
      const [found, runtime] = await Promise.all([
        readRoute(core, appGet, { app }),
        readRoute(core, appRuntime, { app }),
      ]);
      if (!found.ok || !runtime.ok) return { ok: false };
      const { state, reason } = runtime.value.state;
      const shown: RunState =
        state === "unavailable" && reason?.code === "crash_loop"
          ? "halted"
          : (state as RunState);
      return {
        ok: true,
        value: { enabled: found.value.app.run_enabled, state: shown },
      };
    },
    [...readsOf(appGet, { app }), ...readsOf(appRuntime, { app })],
    app,
  );
}

export function useIconView(app: string): IconView | null {
  const read = useCoreRead(appIcon, { app }).loaded;
  return read.state === "ready" ? iconViewOf(read.value) : null;
}

export function useFolders(app: string): ReadHandle<readonly string[]> {
  return useFollowedRead<readonly string[]>(
    async (core) => {
      const found = await readRoute(core, appGet, { app });
      return found.ok
        ? {
            ok: true,
            value: found.value.app.folders.map((folder) => folder.path),
          }
        : found;
    },
    readsOf(appGet, { app }),
    app,
  );
}

// ---- Version ----

const short = (commit: string) => commit.slice(0, 7);

// ---- Machines ----

function machinesView(state: UpdateState): MachinesView {
  const label = (release: UpdateState["machines"][number]["release"]) =>
    release === null
      ? null
      : release.number === null
        ? short(release.code_commit)
        : `r${release.number}`;
  const target = state.machines.find(
    (row) =>
      row.release !== null && row.release.code_commit === state.follow.release,
  );
  return {
    follow: {
      step: state.follow.state,
      target: target === undefined ? null : label(target.release),
      reason: state.follow.reason,
    },
    machines: state.machines.map((row) => ({
      machine: row.machine,
      name: row.name,
      thisMachine: row.this_machine,
      release: label(row.release),
      lophnVersion: row.lophn_version,
      exchange: row.exchange,
      held: state.held
        .filter((held) => held.machine === row.machine)
        .map((held) => ({
          changes: held.changes,
          full: held.full,
          why: held.why,
        })),
    })),
  };
}

/** 폴더로 맞추지 않는 앱(not_found)이면 null이다. */
export function useMachinesView(app: string): ReadHandle<MachinesView | null> {
  return useFollowedRead<MachinesView | null>(
    async (core) => {
      const reply = await core.call({
        kind: appUpdateState.kind,
        resource: appUpdateState.resource,
        method: appUpdateState.method,
        body: { app },
      });
      if (reply.ok) {
        return {
          ok: true,
          value: machinesView(reply.value as UpdateState),
        };
      }
      return reply.error?.code === "not_found"
        ? { ok: true, value: null }
        : { ok: false };
    },
    readsOf(appUpdateState, { app }),
    app,
  );
}

/** 활성 release의 원격 event 구독 가운데 지금 명단에서 다른 컴퓨터 하나로 풀리지 않는 것만 추린다(core subscriptions.ts와 같은 규칙). */
export function unresolvedSubscriptionsOf(
  subscriptions: readonly {
    readonly source: string;
    readonly event: string;
    readonly machine?: string;
  }[],
  computers: readonly MachineCandidate[],
): UnresolvedSubscription[] {
  const unresolved: UnresolvedSubscription[] = [];
  for (const sub of subscriptions) {
    if (sub.machine === undefined) continue;
    const found = resolveMachine(sub.machine, computers);
    if (!found.ok || found.value.self) {
      unresolved.push({
        source: sub.source,
        event: sub.event,
        machine: sub.machine,
        reason: found.ok
          ? "self"
          : found.error.code === "invalid_input"
            ? "ambiguous"
            : "not_found",
      });
    }
  }
  return unresolved;
}

/** 활성 release 선언의 `subscriptions[].machine` 가운데 풀지 못한 구독 목록. 명단·release가 바뀌면 다시 읽는다. */
export function useUnresolvedSubscriptions(
  app: string,
): ReadHandle<readonly UnresolvedSubscription[]> {
  return useFollowedRead<readonly UnresolvedSubscription[]>(
    async (core) => {
      const [tools, roster] = await Promise.all([
        readRoute(core, appTools, { app }),
        readRoute(core, rosterList, {}),
      ]);
      if (!tools.ok || !roster.ok) return { ok: true, value: [] };
      const subscriptions = tools.value.subscriptions ?? [];
      if (!subscriptions.some((sub) => sub.machine !== undefined)) {
        return { ok: true, value: [] };
      }
      const computers: MachineCandidate[] = roster.value.devices.flatMap(
        (device) =>
          device.kind === "computer" &&
          !device.disputed &&
          device.machine !== null
            ? [
                {
                  machine: device.machine,
                  device: device.id,
                  name: device.name,
                  self: device.this,
                },
              ]
            : [],
      );
      return {
        ok: true,
        value: unresolvedSubscriptionsOf(subscriptions, computers),
      };
    },
    [...readsOf(appTools, { app }), ...readsOf(rosterList, {})],
    app,
  );
}

const STEP_ORDER: readonly ActivationStep["key"][] = [
  "hold",
  "drain",
  "stop",
  "migrate",
  "start",
];

/** 줄 항목이 알려 주는 지금 단계까지는 끝, 그 단계는 하는 중, 나머지는 대기다. */
function stepsOf(entry: ActivationQueueEntry | undefined): ActivationStep[] {
  const at = entry?.step == null ? -1 : STEP_ORDER.indexOf(entry.step);
  return STEP_ORDER.map((key, index) => ({
    key,
    state:
      at < 0 ? "wait" : index < at ? "done" : index === at ? "now" : "wait",
    count:
      entry === undefined
        ? null
        : key === "hold"
          ? entry.held_calls > 0
            ? entry.held_calls
            : null
          : key === "migrate"
            ? entry.migration_steps > 0
              ? entry.migration_steps
              : null
            : null,
  }));
}

function versionView(
  releases: readonly ReleaseRecord[],
  active: string | null,
  queue: readonly ActivationQueueEntry[],
  sdks: readonly SdkRow[],
): VersionView {
  const newest = [...releases].sort((a, b) => b.number - a.number);
  const activations = releases
    .flatMap((release) =>
      release.activated_at === null ? [] : [release.activated_at],
    )
    .sort();
  const card = (release: ReleaseRecord): ReleaseCard => ({
    id: release.id,
    number: release.number,
    commit: short(release.code_commit),
    dataSchema: release.data_schema,
    appliedAt: release.activated_at,
    // 이 release 다음에 활성이 된 release의 시각이 물러난 시각이다.
    replacedAt:
      release.status === "superseded" && release.activated_at !== null
        ? (activations.find((at) => at > release.activated_at!) ?? null)
        : null,
  });
  const current = newest.find((release) => release.id === active) ?? null;
  const entry = queue[0];
  const activating =
    entry === undefined
      ? newest.find((release) => release.status === "activating")
      : newest.find((release) => release.id === entry.release);
  const failed = newest.find(
    (release) =>
      release.status === "failed" && release.number > (current?.number ?? 0),
  );
  return {
    active: current === null ? null : card(current),
    sdks,
    applying:
      activating === undefined
        ? null
        : {
            id: activating.id,
            number: activating.number,
            phase: entry?.phase ?? "running",
            steps: stepsOf(entry),
          },
    failed:
      activating !== undefined || failed === undefined
        ? null
        : {
            id: failed.id,
            number: failed.number,
            triedAt: failed.activation?.started_at ?? null,
            reason: failed.failure?.summary ?? "",
          },
    earlier: newest
      .filter((release) => release.status === "superseded")
      .map(card),
  };
}

export function useVersionView(app: string): ReadHandle<VersionView> {
  const releasesInput = { app, limit: RELEASE_LIMIT };
  return useFollowedRead<VersionView>(
    async (core) => {
      const [releases, found, queue, sdk] = await Promise.all([
        readRoute(core, releasesListRecords, releasesInput),
        readRoute(core, appGet, { app }),
        readRoute(core, activationsQueue, { app }),
        readRoute(core, appSdkStatus, { app }),
      ]);
      if (!releases.ok || !found.ok || !queue.ok) return { ok: false };
      return {
        ok: true,
        value: versionView(
          releases.value.releases,
          found.value.app.active_release,
          queue.value.entries,
          // SDK 상태를 못 읽어도 release 화면은 보인다.
          valueOr(sdk)?.apps[0]?.sdks.map((entry) => ({
            sdk: entry.sdk,
            pinned: entry.pinned,
            current: entry.current,
            level: entry.level,
          })) ?? [],
        ),
      };
    },
    [
      ...readsOf(releasesListRecords, releasesInput),
      ...readsOf(appGet, { app }),
      ...readsOf(activationsQueue, { app }),
      ...readsOf(appSdkStatus, { app }),
    ],
    app,
  );
}

/** 이 release를 지금 활성 release와 견준 늘어난 선언과 손실 단계. */
export function useReleaseChanges(
  release: string,
): ReadHandle<ReleaseChanges | null> {
  return useFollowedRead<ReleaseChanges | null>(
    async (core) => {
      const [compared, record] = await Promise.all([
        readRoute(core, activationsCompare, { release }),
        readRoute(core, releasesGetRecord, { release }),
      ]);
      if (!compared.ok || !record.ok) return { ok: false };
      return {
        ok: true,
        value: await releaseChanges(core, compared.value, record.value),
      };
    },
    [
      ...readsOf(activationsCompare, { release }),
      ...readsOf(releasesGetRecord, { release }),
    ],
    release,
  );
}

async function releaseChanges(
  core: CoreSource,
  compared: z.output<typeof activationsCompare.output>,
  record: z.output<typeof releasesGetRecord.output>,
): Promise<ReleaseChanges | null> {
  if (record.release === null) return null;
  const comparison = compared.comparison;
  const lookup = lookups(core);
  const fromNumber =
    comparison.previous_release === null
      ? null
      : await lookup.releaseNumber(comparison.previous_release);
  const addedTools = await Promise.all(
    comparison.added_tools.map(async (item) => ({
      app: item.app,
      appName: await lookup.appName(item.app),
      tool: item.tool,
    })),
  );
  return {
    fromNumber,
    toNumber: record.release.number,
    first: comparison.first,
    addedResources: comparison.added_resources,
    addedTools,
    lossSteps: comparison.loss_steps.map((step) => ({
      from: step.from,
      to: step.to,
      loss: step.loss.map((loss) => ({
        kind: loss.kind,
        table: loss.table,
        column: loss.column ?? null,
      })),
    })),
  };
}

// ---- Access ----

type OAuthLine = z.output<typeof appsOAuthState.output>["secrets"][number];

function secretInfo(
  scope: Extract<AppGrant["scope"], { kind: "secret.use" }>,
  configured: boolean | null,
  line: OAuthLine | undefined,
): SecretInfo {
  const oauth = scope.oauth;
  return {
    configured,
    oauth:
      oauth === undefined
        ? null
        : {
            authorizeHost: new URL(oauth.authorization_endpoint).host,
            scopes: oauth.scopes,
            clientId: line?.client_id ?? null,
            clientSecretSet: line?.client_secret_set ?? false,
            state: line?.state ?? "none",
            reason: line?.reason ?? null,
          },
  };
}

const RESOURCE_KINDS: Partial<Record<AppGrant["scope"]["kind"], ResourceKind>> =
  {
    "fs.read": "file-read",
    "fs.write": "file-write",
    "net.fetch": "network",
    "net.listen": "listen",
    "secret.use": "secret",
    "notify.send": "notify",
    "phone.use": "phone",
  };

function resourceOf(grant: AppGrant, secret?: SecretInfo): ResourceRow | null {
  const scope = grant.scope;
  const kind = RESOURCE_KINDS[scope.kind];
  if (kind === undefined) return null;
  const name =
    "path" in scope
      ? scope.path
      : "host" in scope
        ? `${scope.host}:${scope.port}`
        : "name" in scope
          ? scope.name
          : "capability" in scope
            ? phoneCapabilityText(scope.capability)
            : "";
  return {
    grant: grant.id,
    kind,
    name,
    grantedAt: grant.created_at,
    revoked: grant.status === "revoked",
    ...(secret === undefined ? {} : { secret }),
  };
}

export function useAccessView(app: string): ReadHandle<AccessView> {
  const grantsInput = { app, limit: GRANT_LIMIT };
  return useFollowedRead<AccessView>(
    async (core) => {
      const [listedRead, statusRead, oauthRead, foundRead] = await Promise.all([
        readRoute(core, appGrantsList, grantsInput),
        // 이름을 주지 않으면 값이 든 secret 이름을 모두 준다. grant를 읽기 전에 물을 수 있다.
        readRoute(core, secretStatus, {}),
        // OAuth secret이 없는 앱도 읽는다. 못 읽으면 sign-in 줄이 처음 상태로 보인다.
        readRoute(core, appsOAuthState, { app }),
        readRoute(core, appGet, { app }),
      ]);
      if (!listedRead.ok || !foundRead.ok) return { ok: false };
      const listed = listedRead.value;
      const oauth = valueOr(oauthRead);
      const found = foundRead.value;
      const lookup = lookups(core);
      // 다른 컴퓨터는 사람의 허락이 없으면 secret 상태를 내주지 않는다(forbidden). 그때는 값이 든지 모른다고 보인다.
      const configured = statusRead.ok
        ? new Set(
            statusRead.value.secrets
              .filter((item) => item.configured)
              .map((item) => item.name),
          )
        : null;
      const lines = new Map(
        (oauth?.secrets ?? []).map((line) => [line.name, line]),
      );
      const resources: ResourceRow[] = [];
      const appTools: AppToolRow[] = [];
      for (const grant of listed.grants) {
        const scope = grant.scope;
        if (scope.kind !== "app.call") {
          const row = resourceOf(
            grant,
            scope.kind === "secret.use"
              ? secretInfo(
                  scope,
                  configured === null ? null : configured.has(scope.name),
                  lines.get(scope.name),
                )
              : undefined,
          );
          if (row !== null) resources.push(row);
          continue;
        }
        const [appName, effects] = await Promise.all([
          lookup.appName(scope.app),
          lookup.tools(scope.app),
        ]);
        appTools.push({
          grant: grant.id,
          app: scope.app,
          appName,
          tools: scope.app_tools.map((tool) => ({
            tool,
            effect: effects.get(tool) ?? null,
          })),
          grantedAt: grant.created_at,
          revoked: grant.status === "revoked",
        });
      }
      return {
        ok: true,
        value: { appName: found.app.name, resources, appTools },
      };
    },
    [
      ...readsOf(appGrantsList, grantsInput),
      ...readsOf(secretStatus, {}),
      ...readsOf(appsOAuthState, { app }),
      ...readsOf(appGet, { app }),
    ],
    app,
  );
}

// ---- Activity ----

const RESULT_KEYS = ["message", "summary", "text", "result"] as const;

function resultText(summary: AppInvocation["summary"]): string {
  for (const key of RESULT_KEYS) {
    const value = summary[key];
    if (typeof value === "string") return value;
  }
  return Object.keys(summary).length === 0 ? "" : JSON.stringify(summary);
}

function stateOf(invocation: AppInvocation): CallState {
  switch (invocation.status) {
    case "running":
      return invocation.started_at === null ? "waiting" : "running";
    case "succeeded":
      return "done";
    case "failed":
    case "denied":
      return "failed";
    case "unknown":
      return "unknown";
  }
}

async function callerOf(
  caller: AppToolCaller | null,
  start: "activation" | "restart",
  names: Names,
): Promise<Caller> {
  if (caller === null) return { kind: "start", reason: start };
  switch (caller.kind) {
    case "person":
      return { kind: "person" };
    case "agent": {
      const session = await names.session(caller.session);
      const name =
        session === null ? null : await names.agentName(session.agent);
      return {
        kind: "agent",
        agent: session?.agent ?? "",
        name,
        session: caller.session,
        title: session?.title ?? null,
        turn: caller.turn,
        toolCall: caller.tool_call,
      };
    }
    case "app": {
      const [appName, releaseNumber] = await Promise.all([
        names.appName(caller.app),
        names.releaseNumber(caller.release),
      ]);
      return { kind: "app", app: caller.app, appName, releaseNumber };
    }
    // 제목은 읽지 않는다. job이 지워졌을 수 있다.
    case "program":
      return { kind: "program" };
    case "flow":
      return { kind: "flow" };
    // 다른 컴퓨터가 부른 것이다. 사람이 한 것으로 보이면 안 된다. agent 이름은 그 컴퓨터가 쓴 값이다.
    case "remote": {
      const by = caller.requester;
      const [machine, appName] = await Promise.all([
        names.machineName(caller.machine),
        by.kind === "app" ? names.appName(by.app) : null,
      ]);
      return {
        kind: "remote",
        machine,
        requester:
          by.kind === "agent"
            ? { kind: "agent", name: by.name }
            : by.kind === "app"
              ? { kind: "app", app: by.app, name: appName }
              : { kind: by.kind },
      };
    }
    case "event":
      return {
        kind: "event",
        machine:
          caller.machine === undefined
            ? null
            : await names.machineName(caller.machine),
        publisherName:
          caller.publisher === "lophn"
            ? "lophn"
            : await names.appName(caller.publisher),
        event: caller.event,
      };
  }
}

const startReason = (operation: AppInvocation["operation"]) =>
  operation.kind === "start" && operation.reason === "restart"
    ? ("restart" as const)
    : ("activation" as const);

// operation과 command 호출은 화면에서 모두 "call" 줄이다. 이름이 호출 이름이다.
const kindOf = (operation: AppInvocation["operation"]) =>
  operation.kind === "start" || operation.kind === "data_change"
    ? operation.kind
    : ("call" as const);

const nameOf = (operation: AppInvocation["operation"]) =>
  operation.kind === "operation" || operation.kind === "command"
    ? operation.name
    : null;

function outboundStateOf(status: AppRemoteCallRecord["status"]): CallState {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "done";
    case "failed":
    case "denied":
      return "failed";
    case "unknown":
      return "unknown";
  }
}

async function outboundRowOf(
  record: AppRemoteCallRecord,
  names: Names,
): Promise<ActivityRow> {
  const by = record.caller;
  let caller: Caller;
  if (by.kind === "agent") {
    const session =
      by.session !== null ? await names.session(by.session) : null;
    const name = (await names.agentName(by.agent)) ?? by.name;
    caller = {
      kind: "agent",
      agent: by.agent,
      name,
      session: by.session,
      title: session?.title ?? null,
      turn: null,
      toolCall: null,
    };
  } else {
    caller = {
      kind: "app",
      app: by.app,
      appName: await names.appName(by.app),
      releaseNumber: null,
    };
  }
  const appName = await names.appName(record.app);
  return {
    id: record.id,
    at: record.finished_at ?? record.started_at,
    caller,
    tool: record.command,
    kind: "call",
    effect: "external",
    state: outboundStateOf(record.status),
    undone: false,
    releaseNumber: null,
    earlier: false,
    inputHash: null,
    result: record.error ?? "",
    remoteTarget: {
      machine: record.computer,
      app: record.app,
      appName,
    },
  };
}

export function useActivityView(app: string): ReadHandle<ActivityView> {
  const invocationsInput = {
    app,
    mode: "live" as const,
    limit: ACTIVITY_LIMIT,
  };
  const remoteToInput = { app, limit: ACTIVITY_LIMIT };
  const remoteFromInput = { caller_app: app, limit: ACTIVITY_LIMIT };
  const releasesInput = { app, limit: RELEASE_LIMIT };
  const noticesInput = { app, persistent: true, limit: NOTICE_LIMIT };
  return useFollowedRead<ActivityView>(
    async (core) => {
      const [
        invocationsRead,
        remoteToRead,
        remoteFromRead,
        releasesRead,
        foundRead,
        historyRead,
      ] = await Promise.all([
        readRoute(core, appInvocations, invocationsInput),
        readRoute(core, appRemoteCalls, remoteToInput),
        readRoute(core, appRemoteCalls, remoteFromInput),
        readRoute(core, releasesListRecords, releasesInput),
        readRoute(core, appGet, { app }),
        readRoute(core, noticesList, noticesInput),
      ]);
      if (!invocationsRead.ok || !foundRead.ok) return { ok: false };
      const invocations = invocationsRead.value;
      // release 번호를 못 읽어도 호출 기록은 보인다.
      const releases = valueOr(releasesRead);
      const found = foundRead.value;
      // 영구 기록이나 다른 컴퓨터 호출 기록을 못 읽어도 이 컴퓨터 호출 기록은 보이게 비운다.
      const history = valueOr(historyRead);
      const outboundMap = new Map<string, AppRemoteCallRecord>();
      for (const call of valueOr(remoteToRead)?.calls ?? []) {
        outboundMap.set(call.id, call);
      }
      for (const call of valueOr(remoteFromRead)?.calls ?? []) {
        outboundMap.set(call.id, call);
      }
      const active = found.app.active_release;
      const numbers = new Map(
        (releases?.releases ?? []).map((release) => [
          release.id,
          release.number,
        ]),
      );
      const lookup = lookups(core);
      const [localRows, outboundRows] = await Promise.all([
        Promise.all(
          invocations.invocations.map(async (invocation) => ({
            id: invocation.id,
            at: invocation.finished_at ?? invocation.started_at,
            caller: await callerOf(
              invocation.caller,
              startReason(invocation.operation),
              lookup,
            ),
            tool: nameOf(invocation.operation),
            kind: kindOf(invocation.operation),
            effect: invocation.effect,
            state: stateOf(invocation),
            undone: invocation.reverted_by !== null,
            releaseNumber: numbers.get(invocation.release) ?? null,
            earlier: active !== null && invocation.release !== active,
            inputHash: invocation.input_hash,
            result: resultText(invocation.summary),
          })),
        ),
        Promise.all(
          [...outboundMap.values()].map((record) =>
            outboundRowOf(record, lookup),
          ),
        ),
      ]);
      const rows: ActivityRow[] = [...localRows, ...outboundRows];
      // 새것부터. 아직 시작하지 않은 호출(시각 없음)은 맨 위에 둔다.
      rows.sort((a, b) =>
        a.at === null
          ? b.at === null
            ? 0
            : -1
          : b.at === null
            ? 1
            : b.at.localeCompare(a.at),
      );
      const notices: AppNoticeRow[] = (history?.notices ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        at: row.created_at,
        unread: row.read_at === null,
      }));
      return { ok: true, value: { rows, notices } };
    },
    [
      ...readsOf(appInvocations, invocationsInput),
      ...readsOf(appRemoteCalls, remoteToInput),
      ...readsOf(appRemoteCalls, remoteFromInput),
      ...readsOf(releasesListRecords, releasesInput),
      ...readsOf(appGet, { app }),
      ...readsOf(noticesList, noticesInput),
    ],
    app,
  );
}

function rewindOutcome(item: RewindPlan["items"][number]) {
  if (item.external) return "stays" as const;
  return item.reverts_db || item.effect === "read"
    ? ("undone" as const)
    : ("cannot" as const);
}

/** 고른 호출부터 최신까지 되돌아갈 목록. 도는 호출이 끝나면(app_activity) 다시 읽어 rewind 진행도 이것으로 본다. */
export function useRewindPlan(
  app: string,
  from: string,
): ReadHandle<RewindPlanView> {
  const input = { app, from_invocation: from };
  return useFollowedRead<RewindPlanView>(
    async (core) => {
      const read = await readRoute(core, appRewindPlan, input);
      if (!read.ok) return read;
      const { plan } = read.value;
      const lookup = lookups(core);
      const items: RewindItem[] = await Promise.all(
        plan.items.map(async (item) => ({
          invocation: item.invocation,
          at: item.started_at,
          tool: nameOf(item.operation),
          kind: kindOf(item.operation),
          effect: item.effect,
          caller: await callerOf(
            item.caller,
            startReason(item.operation),
            lookup,
          ),
          outcome: rewindOutcome(item),
          running: item.running,
        })),
      );
      items.sort((a, b) => b.at.localeCompare(a.at));
      return {
        ok: true,
        value: {
          from,
          items,
          blocked:
            plan.blocked === null
              ? null
              : { invocation: plan.blocked.invocation },
        },
      };
    },
    readsOf(appRewindPlan, input),
    `${app}\0${from}`,
  );
}
