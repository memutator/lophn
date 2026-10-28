// AppDetailSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output schema로
// 이미 검사했고, 아래 type은 그 schema에서 나온 protocol type이다. 거두기·돌아가기·상태 바꾸기는 사람의
// 결정이지만 확인 창 없이 이 탭에서 바로 보낸다.
import {
  type ActivationComparison,
  type ActivationQueueEntry,
  type AppGrant,
  type AppInvocation,
  appOAuthNames,
  type appsOAuthState,
  type AppToolCaller,
  type ReleaseRecord,
  type Rewind,
  type RewindPlan,
} from "../../../../protocol/apps/mod.ts";
import type { SecretFileStatus } from "../../../../protocol/secrets/secret-file.ts";
import type { OpenExternalApi } from "../../../ipc/open-external.ts";
import type { SecretInputOpenApi } from "../../../ipc/secret-input.ts";
import type { z } from "zod";

import type { CommandRoute } from "../../../../protocol/base/route.ts";
import { activationActivatePrevious } from "../../../../protocol/apps/activation/activation.ts";
import { appGrantRevoke } from "../../../../protocol/apps/grants.ts";
import type { CoreCall } from "../../../ipc/core.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { placeSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import {
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
} from "../../../../protocol/lophn-agent/mod.ts";
import { commandBody, type CompareOf } from "../../command-call.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import {
  enterSecret,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../../desktop/settings/core-call.ts";
import { coreDomainActions } from "../../workspace/domains/core-calls.ts";
import type { DomainView } from "../../workspace/source.ts";
import type {
  AccessView,
  ActivationStep,
  ActivityRow,
  AppDetailSource,
  AppDomainRow,
  AppToolRow,
  Caller,
  CallState,
  Effect,
  ReleaseCard,
  ReleaseChanges,
  ResourceKind,
  ResourceRow,
  RewindItem,
  SecretInfo,
  SourceResult,
  VersionView,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 10;
const ACTIVITY_LIMIT = 100;

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

/** 사람의 결정 command. 입력만 있고 비교·확인 참조는 없다. */
const command = <R extends CommandRoute>(
  core: CoreSource,
  route: R,
  input: z.input<R["input"]>,
) =>
  call<z.output<R["output"]>>(
    core,
    "command",
    route.resource,
    route.method,
    // compare를 선언한 route는 type이 막으므로 compare가 빈 route만 이 길을 쓴다.
    commandBody(route, {
      input,
      compare: {} as CompareOf<R>,
      key: crypto.randomUUID(),
    }),
  );

interface Paged {
  next_cursor: string | null;
}

/** 목록 read를 끝까지 모은다. */
async function collect<T, P extends Paged>(
  core: CoreSource,
  resource: string,
  method: string,
  body: Record<string, unknown>,
  items: (page: P) => T[],
): Promise<SourceResult<T[]>> {
  const found: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result: SourceResult<P> = await read<P>(
      core,
      resource,
      method,
      cursor === undefined ? body : { ...body, cursor },
    );
    if (!result.ok) return result;
    found.push(...items(result.value));
    if (result.value.next_cursor === null) break;
    cursor = result.value.next_cursor;
  }
  return { ok: true, value: found };
}

const releaseRecords = (core: CoreSource, app: string) =>
  collect<ReleaseRecord, { releases: ReleaseRecord[] } & Paged>(
    core,
    "releases",
    "list_records",
    { app, limit: 200 },
    (page) => page.releases,
  );

const activeRelease = async (core: CoreSource, app: string) => {
  const result = await read<{ app: { active_release: string | null } }>(
    core,
    "apps",
    "get",
    { app },
  );
  return result.ok
    ? { ok: true as const, value: result.value.app.active_release }
    : result;
};

const short = (commit: string) => commit.slice(0, 7);

// ---- Version ----

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

// ---- Access ----

type OAuthLine = z.output<typeof appsOAuthState.output>["secrets"][number];

function secretInfo(
  scope: Extract<AppGrant["scope"], { kind: "secret.use" }>,
  configured: boolean,
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

function resourceOf(grant: AppGrant, secret?: SecretInfo): ResourceRow | null {
  const scope = grant.scope;
  const kinds: Partial<Record<typeof scope.kind, ResourceKind>> = {
    "fs.read": "file-read",
    "fs.write": "file-write",
    "net.fetch": "network",
    "net.listen": "listen",
    "secret.use": "secret",
  };
  const kind = kinds[scope.kind];
  if (kind === undefined) return null;
  const name =
    "path" in scope
      ? scope.path
      : "host" in scope
        ? `${scope.host}:${scope.port}`
        : "name" in scope
          ? scope.name
          : "";
  return {
    grant: grant.id,
    kind,
    name,
    grantedAt: grant.created_at,
    // 접수한 거두기는 이 화면이 기억한다. core는 정리 중을 따로 읽게 하지 않는다.
    revoking: false,
    revoked: grant.status === "revoked",
    ...(secret === undefined ? {} : { secret }),
  };
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

/** 호출 기록에 나온 이름들을 한 번만 읽는다. 못 읽으면 이름 없이 보인다. */
function lookups(core: CoreSource) {
  const apps = new Map<string, Promise<string | null>>();
  const releases = new Map<string, Promise<number | null>>();
  const sessions = new Map<
    string,
    Promise<{ agent: string; title: string | null } | null>
  >();
  const agents = new Map<string, Promise<string | null>>();
  return {
    appName(app: string): Promise<string | null> {
      let found = apps.get(app);
      if (found === undefined) {
        found = read<{ app: { name: string } }>(core, "apps", "get", {
          app,
        }).then((result) => (result.ok ? result.value.app.name : null));
        apps.set(app, found);
      }
      return found;
    },
    releaseNumber(release: string): Promise<number | null> {
      let found = releases.get(release);
      if (found === undefined) {
        found = read<{ release: ReleaseRecord | null }>(
          core,
          "releases",
          "get_record",
          { release },
        ).then((result) =>
          result.ok ? (result.value.release?.number ?? null) : null,
        );
        releases.set(release, found);
      }
      return found;
    },
    session(session: string) {
      let found = sessions.get(session);
      if (found === undefined) {
        found = read<{
          session: { title: string | null; agent: string };
        }>(core, placeSessionRead.resource, placeSessionRead.method, {
          session,
        }).then((result) =>
          result.ok
            ? {
                agent: result.value.session.agent,
                title: result.value.session.title,
              }
            : null,
        );
        sessions.set(session, found);
      }
      return found;
    },
    // 부른 agent는 몇 안 되어 id마다 한 번 읽는다. lophn은 이름이 고정이다.
    agentName(agent: string): Promise<string | null> {
      if (agent === LOPHN_AGENT_ID) return Promise.resolve(LOPHN_AGENT_NAME);
      let found = agents.get(agent);
      if (found === undefined) {
        found = read<{ effective: { name: { value: string } } }>(
          core,
          agentRead.resource,
          agentRead.method,
          { agent },
        ).then((result) =>
          result.ok ? result.value.effective.name.value : null,
        );
        agents.set(agent, found);
      }
      return found;
    },
  };
}

async function callerOf(
  caller: AppToolCaller | null,
  start: "activation" | "restart",
  names: ReturnType<typeof lookups>,
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
  }
}

const startReason = (operation: AppInvocation["operation"]) =>
  operation.kind === "start" && operation.reason === "restart"
    ? ("restart" as const)
    : ("activation" as const);

const kindOf = (operation: AppInvocation["operation"]) =>
  operation.kind === "tool" ? ("tool" as const) : operation.kind;

function rewindOutcome(item: RewindPlan["items"][number]) {
  if (item.external) return "stays" as const;
  return item.reverts_db || item.effect === "read"
    ? ("undone" as const)
    : ("cannot" as const);
}

interface AppDetailDeps {
  /** 보호 입력 창. */
  openSecret: SecretInputOpenApi["open"] | undefined;
  openLink: OpenExternalApi["openExternal"] | undefined;
}

const stored = async <T>(
  reply: Promise<SourceResult<T>>,
): Promise<SourceResult<true>> => {
  const result = await reply;
  return result.ok ? { ok: true, value: true } : result;
};

export function coreAppDetailSource(
  core: CoreSource,
  deps: Partial<AppDetailDeps> = {},
): AppDetailSource {
  const openSecret =
    "openSecret" in deps ? deps.openSecret : windowSecretInputOpener();
  const openLink = "openLink" in deps ? deps.openLink : windowLinkOpener();
  return {
    ...coreDomainActions(core),

    async domains(app) {
      const [list, declared] = await Promise.all([
        collect<DomainView, { domains: DomainView[] } & Paged>(
          core,
          "domains",
          "list",
          { owner: { kind: "app", id: app }, status: "active" },
          (page) => page.domains,
        ),
        read<{ tools: { domain: string; public: boolean }[] }>(
          core,
          "apps",
          "tools",
          { app },
        ),
      ]);
      if (!list.ok) return list;
      // active release가 없는 앱은 tool을 읽지 못한다. 그래도 domain 목록은 보인다.
      const tools = declared.ok ? declared.value.tools : [];
      const rows: AppDomainRow[] = list.value.map((domain) => {
        const own = tools.filter((tool) => tool.domain === domain.name);
        return {
          id: domain.id,
          name: domain.name,
          title: domain.title,
          purpose: domain.purpose,
          status: domain.status,
          tools: own.length,
          shared: own.filter((tool) => tool.public).length,
        };
      });
      return { ok: true, value: rows };
    },

    async versions(app) {
      const [releases, active, queue] = await Promise.all([
        releaseRecords(core, app),
        activeRelease(core, app),
        read<{ entries: ActivationQueueEntry[] }>(
          core,
          "activations",
          "queue",
          { app },
        ),
      ]);
      if (!releases.ok) return releases;
      if (!active.ok) return active;
      if (!queue.ok) return queue;
      return {
        ok: true,
        value: versionView(releases.value, active.value, queue.value.entries),
      };
    },

    async changes(release) {
      const [compared, record] = await Promise.all([
        read<{ comparison: ActivationComparison }>(
          core,
          "activations",
          "compare",
          { release },
        ),
        read<{ release: ReleaseRecord | null }>(
          core,
          "releases",
          "get_record",
          { release },
        ),
      ]);
      if (!compared.ok) return compared;
      if (!record.ok) return record;
      if (record.value.release === null) {
        return { ok: false, code: "not_found" };
      }
      const comparison = compared.value.comparison;
      const names = lookups(core);
      const previous =
        comparison.previous_release === null
          ? null
          : await names.releaseNumber(comparison.previous_release);
      const addedTools = await Promise.all(
        comparison.added_tools.map(async (item) => ({
          app: item.app,
          appName: await names.appName(item.app),
          tool: item.tool,
        })),
      );
      const value: ReleaseChanges = {
        fromNumber: previous,
        toNumber: record.value.release.number,
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
      return { ok: true, value };
    },

    async rollback(release) {
      const reply = await command(core, activationActivatePrevious, {
        release,
        key: crypto.randomUUID(),
      });
      return reply.ok ? { ok: true, value: true } : reply;
    },

    async access(app) {
      const result = await collect<AppGrant, { grants: AppGrant[] } & Paged>(
        core,
        "app_grants",
        "list",
        { app, limit: 200 },
        (page) => page.grants,
      );
      if (!result.ok) return result;
      const names = lookups(core);
      const secrets = result.value.flatMap((grant) =>
        grant.scope.kind === "secret.use" ? [grant.scope] : [],
      );
      const none = Promise.resolve({ ok: true, value: null } as const);
      const [status, oauth, appName] = await Promise.all([
        secrets.length === 0
          ? none
          : call<{ secrets: SecretFileStatus[] }>(
              core,
              "memory",
              "secrets",
              "status",
              { names: secrets.map((scope) => scope.name) },
            ),
        secrets.some((scope) => scope.oauth !== undefined)
          ? call<z.output<typeof appsOAuthState.output>>(
              core,
              "memory",
              "apps",
              "oauth_state",
              { app },
            )
          : none,
        names.appName(app),
      ]);
      if (!status.ok) return status;
      if (!oauth.ok) return oauth;
      const configured = new Set(
        status.value?.secrets
          .filter((item) => item.configured)
          .map((item) => item.name),
      );
      const lines = new Map(
        oauth.value?.secrets.map((line) => [line.name, line]),
      );
      const resources: ResourceRow[] = [];
      const appTools: AppToolRow[] = [];
      for (const grant of result.value) {
        const scope = grant.scope;
        if (scope.kind !== "app.call") {
          const row = resourceOf(
            grant,
            scope.kind === "secret.use"
              ? secretInfo(
                  scope,
                  configured.has(scope.name),
                  lines.get(scope.name),
                )
              : undefined,
          );
          if (row !== null) resources.push(row);
          continue;
        }
        const [appName, declared] = await Promise.all([
          names.appName(scope.app),
          read<{ tools: { name: string; effect: Effect }[] }>(
            core,
            "apps",
            "tools",
            {
              app: scope.app,
            },
          ),
        ]);
        const effects = new Map<string, Effect>(
          declared.ok
            ? declared.value.tools.map((tool) => [tool.name, tool.effect])
            : [],
        );
        appTools.push({
          grant: grant.id,
          app: scope.app,
          appName,
          tools: scope.app_tools.map((tool) => ({
            tool,
            effect: effects.get(tool) ?? null,
          })),
          grantedAt: grant.created_at,
          revoking: false,
          revoked: grant.status === "revoked",
        });
      }
      const view: AccessView = { appName, resources, appTools };
      return { ok: true, value: view };
    },

    async revoke(grant) {
      const reply = await command(core, appGrantRevoke, { grant });
      return reply.ok ? { ok: true, value: true } : reply;
    },

    setSecretValue: (name, subject) =>
      enterSecret(openSecret, { name, purpose: "app", subject }),

    setOAuthClientId: (app, name, clientId) =>
      stored(
        call(core, "memory", "apps", "oauth_client_set", {
          app,
          name,
          client_id: clientId,
        }),
      ),

    setOAuthClientSecret: (name, subject) =>
      enterSecret(openSecret, {
        name: appOAuthNames(name).client,
        purpose: "app",
        subject,
      }),

    // 열 곳이 없거나 열기가 실패하면 시작한 sign-in이 남지 않게 닫는다.
    async signIn(app, name) {
      const begun = await call<{ url: string }>(
        core,
        "memory",
        "apps",
        "oauth_begin",
        { app, name },
      );
      if (!begun.ok) return begun;
      let opened = false;
      if (openLink !== undefined) {
        try {
          opened = (await openLink(begun.value.url)).ok;
        } catch {
          opened = false;
        }
      }
      if (opened) return { ok: true, value: true };
      await call(core, "memory", "apps", "oauth_cancel", { app, name });
      return { ok: false, code: "unavailable" };
    },

    cancelSignIn: (app, name) =>
      stored(call(core, "memory", "apps", "oauth_cancel", { app, name })),

    async activity(app) {
      const [invocations, releases, active] = await Promise.all([
        read<{ invocations: AppInvocation[] }>(core, "apps", "invocations", {
          app,
          mode: "live",
          limit: ACTIVITY_LIMIT,
        }),
        releaseRecords(core, app),
        activeRelease(core, app),
      ]);
      if (!invocations.ok) return invocations;
      if (!active.ok) return active;
      const numbers = new Map(
        releases.ok
          ? releases.value.map((release) => [release.id, release.number])
          : [],
      );
      const names = lookups(core);
      const rows: ActivityRow[] = await Promise.all(
        invocations.value.invocations.map(async (invocation) => ({
          id: invocation.id,
          at: invocation.finished_at ?? invocation.started_at,
          caller: await callerOf(
            invocation.caller,
            startReason(invocation.operation),
            names,
          ),
          tool:
            invocation.operation.kind === "tool"
              ? invocation.operation.tool
              : null,
          kind: kindOf(invocation.operation),
          effect: invocation.effect,
          state: stateOf(invocation),
          undone: invocation.reverted_by !== null,
          releaseNumber: numbers.get(invocation.release) ?? null,
          earlier: active.value !== null && invocation.release !== active.value,
          inputHash: invocation.input_hash,
          result: resultText(invocation.summary),
        })),
      );
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
      return { ok: true, value: { rows } };
    },

    async rewindPlan(app, from) {
      const result = await read<{ plan: RewindPlan }>(
        core,
        "apps",
        "rewind_plan",
        { app, from_invocation: from },
      );
      if (!result.ok) return result;
      const names = lookups(core);
      const plan = result.value.plan;
      const items: RewindItem[] = await Promise.all(
        plan.items.map(async (item) => ({
          invocation: item.invocation,
          at: item.started_at,
          tool: item.operation.kind === "tool" ? item.operation.tool : null,
          kind: kindOf(item.operation),
          effect: item.effect,
          caller: await callerOf(
            item.caller,
            startReason(item.operation),
            names,
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

    async rewind(app, from) {
      const result = await call<Rewind>(core, "memory", "apps", "rewind", {
        app,
        from_invocation: from,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          status: result.value.status === "cancelled" ? "cancelled" : "applied",
          reason: result.value.reason?.message ?? null,
        },
      };
    },

    async rewindProgress(app, from) {
      const result = await read<{ plan: RewindPlan }>(
        core,
        "apps",
        "rewind_plan",
        { app, from_invocation: from },
      );
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          running: result.value.plan.items
            .filter((item) => item.running)
            .map((item) => ({
              invocation: item.invocation,
              tool: item.operation.kind === "tool" ? item.operation.tool : null,
              at: item.started_at,
            })),
        },
      };
    },

    async stopPreview(app, preview) {
      await read(core, "previews", "stop", {
        app,
        process_nonce: preview.nonce,
      });
    },
  };
}
