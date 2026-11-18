// app-detail의 가짜 core. 쓰기는 AppDetailSource로 받아 상태를 바꾼 뒤 그 route의 `changes`를 알린다.
// 읽기는 같은 상태를 protocol 모양의 route 답(`answers`)으로 준다. Orders 앱의 release r5~r7, 바깥 자원,
// 호출 기록이 들어 있다. 적용 중·적용 실패·rewind 각 단계는 인자로 고른다.
import type { z } from "zod";

import {
  activationsCompare,
  activationsQueue,
  type AppGrant,
  appGet,
  appGrantsList,
  type AppInvocation,
  appInvocations,
  appRewindPlan,
  appRuntime,
  appSdkStatus,
  appsOAuthState,
  type AppToolCaller,
  type Notice,
  noticesList,
  type ReleaseRecord,
  releasesGetRecord,
  releasesListRecords,
  type RewindPlan,
  appUpdateState,
  type UpdateState,
} from "../../../../../protocol/apps/mod.ts";
import type { StateChange } from "../../../../../protocol/events/changes.ts";
import {
  appIcon,
  appTools,
} from "../../../../../protocol/apps/declaration/read.ts";
import { agentRead } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionRead } from "../../../../../protocol/lophn-agent/agent-sessions.ts";
import { machinesList } from "../../../../../protocol/remote/mod.ts";
import { secretStatus } from "../../../../../protocol/secrets/secret-file.ts";
import {
  type FakeAnswer,
  fakeAnswer,
} from "../../../desktop/connection/events/fake-source.ts";
import type {
  AppDetailSource,
  OAuthReason,
  RewindResult,
  SecretInfo,
} from "../source.ts";

const MAIN = "app_01h455vb4pex5v6nkc6gd5fd01";
const CUSTOMERS = "app_01h455vb4pex5v6nkc6gd5fd02";
const INVENTORY = "app_01h455vb4pex5v6nkc6gd5fd03";

const R7 = "rel_01h455vb4pex5v6nkc6gd5fd07";
const R6 = "rel_01h455vb4pex5v6nkc6gd5fd06";
const R5 = "rel_01h455vb4pex5v6nkc6gd5fd05";
const R8 = "rel_01h455vb4pex5v6nkc6gd5fd08";
const CUSTOMERS_R12 = "rel_01h455vb4pex5v6nkc6gd5fd12";

const ANALYST = "agt_01h455vb4pex5v6nkc6gd5fd09";
const ANALYST_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd01";

const COMMON = { as_of_seq: "0", next_cursor: null } as const;
const HASH = "0".repeat(64);

type ActivationFake = "applied" | "applying" | "failed";
/** Access 탭의 secret 줄들. 없으면 plain secret 하나(SHIPBOB_API_KEY, 값 있음)다. */
export type SecretsFake =
  | "plain"
  | "oauth-setup"
  | "oauth-ready"
  | "oauth-waiting"
  | "oauth-signed-in"
  | "oauth-failed";
type RewindFake = "applied" | "conflict" | "pending";

interface FakeOptions {
  /** Version 탭이 보이는 상태. 기본은 applied. */
  activation?: ActivationFake;
  /** rewind 결과. pending이면 도는 중으로 끝나지 않는다. */
  rewind?: RewindFake;
  /** Access 탭의 secret 줄들. */
  secrets?: SecretsFake;
  /** 실행 상태. 기본은 running. halted는 켜진 채 crash loop로 멈춘 것이다. */
  run?: "running" | "stopped" | "halted";
  /** 다른 앱 이름. */
  names?: Readonly<Record<string, string>>;
  /**
   * 폴더로 맞추는 앱의 Machines 절. waiting: 이 기계가 Laptop의 r8을 따라가려고 동의를 기다리고, Laptop이 r8에서 쓴
   * 변경이 여기서 기다리고, Office mini는 옛 lophn이라 주고받지 못한다. 없으면 폴더로 맞추지 않는 앱이다(절이 없다).
   */
  machines?: "waiting";
}

const GRANT_HOST = "grt_01h455vb4pex5v6nkc6gd5fd01";
const GRANT_SECRET = "grt_01h455vb4pex5v6nkc6gd5fd02";
const GRANT_FILE = "grt_01h455vb4pex5v6nkc6gd5fd03";
const GRANT_LOOKUP = "grt_01h455vb4pex5v6nkc6gd5fd04";
const GRANT_RESERVE = "grt_01h455vb4pex5v6nkc6gd5fd05";

const drive = {
  authorizeHost: "accounts.google.com",
  scopes: ["drive.file"],
  clientId: "412907-drive.apps.googleusercontent.com",
  clientSecretSet: true,
  state: "none",
  reason: null,
} as const;

const plain = (configured: boolean): SecretInfo => ({
  configured,
  oauth: null,
});

const oauthRow = (
  oauth: Partial<NonNullable<SecretInfo["oauth"]>>,
): SecretInfo => ({
  configured: false,
  oauth: { ...drive, ...oauth },
});

// 서비스마다 host와 scope가 다른 OAuth secret 여섯이 한 목록에 쌓인다. 실패 이유마다 한 줄이다.
const FAILED_SERVICES: readonly [
  string,
  OAuthReason,
  string,
  readonly string[],
][] = [
  ["GDRIVE_TOKEN", "callback_timeout", "accounts.google.com", ["drive.file"]],
  [
    "GMAIL_TOKEN",
    "state_mismatch",
    "accounts.google.com",
    ["gmail.readonly", "gmail.send"],
  ],
  ["NOTION_TOKEN", "exchange_failed", "api.notion.com", ["read_content"]],
  ["SLACK_TOKEN", "refresh_rejected", "slack.com", ["chat:write"]],
  ["GITHUB_TOKEN", "expired", "github.com", ["repo"]],
  ["DROPBOX_TOKEN", "store_failed", "www.dropbox.com", ["files.content.write"]],
];

const SECRETS: Record<SecretsFake, readonly (readonly [string, SecretInfo])[]> =
  {
    plain: [
      ["SMTP_PASSWORD", plain(false)],
      ["WEBHOOK_KEY", plain(true)],
    ],
    "oauth-setup": [
      ["GDRIVE_TOKEN", oauthRow({ clientId: null, clientSecretSet: false })],
      ["SMTP_PASSWORD", plain(true)],
    ],
    "oauth-ready": [["GDRIVE_TOKEN", oauthRow({})]],
    "oauth-waiting": [["GDRIVE_TOKEN", oauthRow({ state: "in_progress" })]],
    "oauth-signed-in": [
      [
        "GDRIVE_TOKEN",
        { ...oauthRow({ state: "signed_in" }), configured: true },
      ],
    ],
    "oauth-failed": FAILED_SERVICES.map(
      ([name, reason, authorizeHost, scopes]) => [
        name,
        oauthRow({ state: "failed", reason, authorizeHost, scopes }),
      ],
    ),
  };

const YOU: AppToolCaller = { kind: "person", view_session: "view_1" };
const BY_ANALYST: AppToolCaller = {
  kind: "agent",
  session: ANALYST_SESSION,
  turn: "trn_01h455vb4pex5v6nkc6gd5fd03",
  tool_call: "call_7f3a",
};

/** 다른 컴퓨터(Home server)가 부른 호출. 이름은 그 컴퓨터가 알린 값이다. */
const HOME_SERVER = "mch_01h455vb4pex5v6nkc6gd5fm01";
const FROM_HOME_SERVER: AppToolCaller = {
  kind: "remote",
  machine: HOME_SERVER,
  device: "dev_01h455vb4pex5v6nkc6gd5fm01",
  requester: {
    kind: "agent",
    agent: "agt_01h455vb4pex5v6nkc6gd5fm09",
    session: null,
    name: "Meal planner",
  },
};

function call(
  id: string,
  at: string,
  caller: AppToolCaller | null,
  tool: string | null,
  effect: AppInvocation["effect"],
  status: AppInvocation["status"],
  message: string,
  more: Partial<AppInvocation> = {},
): AppInvocation {
  const waiting = status === "running";
  return {
    id,
    app: MAIN,
    release: R7,
    mode: "live",
    operation:
      tool === null
        ? { kind: "start", reason: "activation" }
        : { kind: "operation", name: tool },
    caller,
    effect,
    status,
    started_at: waiting ? null : at,
    finished_at: waiting ? null : at,
    input_hash: tool === null ? null : "sha256:41c9e07b",
    summary: { message },
    detail_hash: null,
    changeset: null,
    reverted_by: null,
    ...more,
  };
}

const UNDONE = { reverted_by: "rwd_01h455vb4pex5v6nkc6gd5fd01" };

const CALLS: readonly AppInvocation[] = [
  call(
    "inv_41",
    "2026-10-15T14:41:00",
    {
      kind: "app",
      app: CUSTOMERS,
      release: CUSTOMERS_R12,
      parent_invocation: null,
    },
    "orders.attachNote",
    "write",
    "running",
    "Waiting behind the running write",
  ),
  call(
    "inv_40",
    "2026-10-15T14:40:00",
    FROM_HOME_SERVER,
    "orders.create",
    "write",
    "succeeded",
    "Created order 1044",
  ),
  call(
    "inv_39",
    "2026-10-15T14:39:00",
    YOU,
    "orders.create",
    "write",
    "succeeded",
    "Created order 1043",
  ),
  call(
    "inv_38",
    "2026-10-15T14:38:00",
    {
      kind: "program",
      job: "job_01h455vb4pex5v6nkc6gd5fd01",
      job_run: "jbr_01h455vb4pex5v6nkc6gd5fd01",
    },
    "orders.exportToSheet",
    "external",
    "succeeded",
    "Sent 31 rows to the Orders digest sheet",
  ),
  call(
    "inv_36",
    "2026-10-15T14:36:00",
    BY_ANALYST,
    "orders.refund",
    "write",
    "unknown",
    "Result unknown. lophn stopped during the call",
  ),
  call(
    "inv_32",
    "2026-10-15T14:32:00",
    YOU,
    "orders.markShipped",
    "write",
    "succeeded",
    "Order 1042 marked shipped",
  ),
  call(
    "inv_22",
    "2026-10-15T14:22:00",
    YOU,
    "orders.markShipped",
    "write",
    "succeeded",
    "Order 1041 marked shipped",
    UNDONE,
  ),
  call(
    "inv_20",
    "2026-10-15T14:20:00",
    BY_ANALYST,
    "orders.cancel",
    "write",
    "succeeded",
    "Order 1040 cancelled",
    UNDONE,
  ),
  call(
    "inv_11",
    "2026-10-15T14:11:00",
    YOU,
    "orders.list",
    "read",
    "failed",
    "Failed: the query timed out",
  ),
  call(
    "inv_05",
    "2026-10-15T13:58:00",
    null,
    null,
    "write",
    "succeeded",
    "Seeded 3 carriers",
  ),
  call(
    "inv_r6",
    "2026-10-15T13:20:00",
    YOU,
    "orders.markShipped",
    "write",
    "succeeded",
    "Order 1039 marked shipped",
    { release: R6 },
  ),
];

const notice = (
  id: string,
  kind: Notice["kind"],
  title: string,
  body: string,
  at: string,
  read: string | null,
): Notice => ({
  id,
  source: "program",
  app: MAIN,
  app_name: "Orders",
  project: null,
  kind,
  key: null,
  title,
  body,
  persistent: true,
  action: null,
  created_at: at,
  read_at: read,
});

const NOTICES: readonly Notice[] = [
  notice(
    "ntc_1",
    "release_failed",
    "Release r8 of Orders failed",
    "The app is back on release r7.",
    "2026-10-15T14:40:00",
    null,
  ),
  notice(
    "ntc_2",
    "release_activated",
    "Release r7 of Orders is active",
    "",
    "2026-10-14T09:12:00",
    "2026-10-14T09:13:00",
  ),
];

const REWIND_FROM = "inv_32";

const SDKS = [
  {
    sdk: "@lophn/declaration",
    pinned: "3.0.0",
    current: "4.0.0",
    level: "required",
  },
  {
    sdk: "@lophn/app-ui",
    pinned: "2.2.0",
    current: "2.6.0",
    level: "available",
  },
  {
    sdk: "@lophn/cap-store",
    pinned: "1.0.0",
    current: "1.0.0",
    level: "current",
  },
] as const;

function release(
  id: string,
  number: number,
  commit: string,
  dataSchema: number,
  activatedAt: string | null,
): ReleaseRecord {
  return {
    id,
    app: id === CUSTOMERS_R12 ? CUSTOMERS : MAIN,
    number,
    code_commit: commit.padEnd(40, "0"),
    bundle_hash: HASH,
    declaration_hash: HASH,
    data_schema: dataSchema,
    data_changes: [],
    created_by: "user",
    created_at: activatedAt ?? "2026-10-15T15:00:00",
    status: "superseded",
    activation: null,
    activated_at: activatedAt,
    failure: null,
  };
}

const RELEASES: readonly ReleaseRecord[] = [
  release(R7, 7, "3f9a1c2", 4, "2026-10-15T13:58:00"),
  release(R6, 6, "b81e7d0", 4, "2026-10-12T10:05:00"),
  release(R5, 5, "9d04ac1", 3, "2026-10-08T09:40:00"),
];

/** 앱 기록의 나머지 칸. */
const appRecord = (
  id: string,
  name: string,
): z.output<typeof appGet.output>["app"] => ({
  id,
  slug: name.toLowerCase(),
  name,
  description: "",
  planning_version: null,
  source_path: null,
  folders: [],
  active_release: null,
  revision: "1",
  run_enabled: true,
  status: "active",
});

const THIS_MACHINE = "mch_01h455vb4pex5v6nkc6gd5fd01";
const LAPTOP = "mch_01h455vb4pex5v6nkc6gd5fd02";
const OFFICE = "mch_01h455vb4pex5v6nkc6gd5fd03";
const R8_BUNDLE = "8".repeat(64);

const UPDATE_WAITING: UpdateState = {
  app: MAIN,
  follow: { state: "waiting_consent", release: R8_BUNDLE, reason: null },
  held: [
    {
      machine: LAPTOP,
      bundle_hash: R8_BUNDLE,
      data_schema: 5,
      changes: 37,
      bytes: 48_213,
      full: false,
      why: "newer_release",
    },
  ],
  machines: [
    {
      machine: THIS_MACHINE,
      name: "Studio",
      this_machine: true,
      lophn_version: "0.23.74",
      exchange: "ok",
      release: {
        bundle_hash: HASH,
        number: 7,
        code_commit: "3f9a1c2".padEnd(40, "0"),
        data_schema: 4,
      },
    },
    {
      machine: LAPTOP,
      name: "Laptop",
      this_machine: false,
      lophn_version: "0.23.74",
      exchange: "ok",
      // 따라가려고 이 기계에 prepared로 들였다.
      release: {
        bundle_hash: R8_BUNDLE,
        number: 8,
        code_commit: "c42d9e1".padEnd(40, "0"),
        data_schema: 5,
      },
    },
    {
      machine: OFFICE,
      name: "Office mini",
      this_machine: false,
      lophn_version: "0.21.4",
      exchange: "update_peer",
      release: null,
    },
  ],
};

/** 이름·제목만 쓰는 읽기의 답. 나머지 칸은 화면이 보지 않는다. */
const partial = <T>(value: unknown) => value as T;

export function fakeDetail(options: FakeOptions = {}) {
  const nameOf = (app: string, fallback: string) =>
    options.names?.[app] ?? fallback;
  const listeners = new Set<(changes: StateChange[]) => void>();
  const changed = (...changes: StateChange[]) => {
    for (const listener of [...listeners]) listener(changes);
  };
  let activeId = R7;
  let rewinding = false;
  // source 밖에 이은 폴더. Add는 늘 같은 경로 하나를 더한다.
  let folders: readonly string[] = ["/home/me/notes/orders"];
  // 올린 icon. 없으면 앱이 선언한 icon이 없는 기본 표식이다.
  let uploadedIcon: { content_type: string; data: string } | null = null;
  // 끄면 stopped, 켜면 running으로 바로 간다. halted에서 껐다 켜도 같다(실제는 10분 창이 지나야 다시 돈다).
  let runEnabled = (options.run ?? "running") !== "stopped";
  let runState: "running" | "stopped" | "halted" = options.run ?? "running";

  const records = (): ReleaseRecord[] => {
    const activation = options.activation ?? "applied";
    const own = RELEASES.map(
      (item): ReleaseRecord => ({
        ...item,
        status: item.id === activeId ? "active" : "superseded",
      }),
    );
    if (activation === "applied") return own;
    const attempt = {
      attempt: "act_01h455vb4pex5v6nkc6gd5fd01",
      previous_release: R7,
      backup_hash: null,
      data_change_invocation: null,
      started_at: "2026-10-15T15:07:00",
    };
    return [
      {
        ...release(R8, 8, "c42d9e1", 5, null),
        status: activation === "applying" ? "activating" : "failed",
        activation: attempt,
        failure:
          activation === "failed"
            ? {
                code: "migration_failed",
                summary:
                  "Migration step 2 of 2 failed: NOT NULL constraint failed on orders.carrier. The database was restored from the backup.",
                restored: true,
              }
            : null,
      },
      ...own,
    ];
  };

  const grants = (): AppGrant[] => {
    const grant = (
      id: string,
      scope: AppGrant["scope"],
      at = "2026-10-15T13:58:00",
    ): AppGrant => ({
      id,
      app: MAIN,
      scope,
      status: "active",
      created_at: at,
      revoked_at: null,
    });
    const secrets =
      options.secrets === undefined
        ? [grant(GRANT_SECRET, { kind: "secret.use", name: "SHIPBOB_API_KEY" })]
        : SECRETS[options.secrets].map(([name, info], index) =>
            grant(
              index === 0
                ? GRANT_SECRET
                : `grt_01h455vb4pex5v6nkc6gd5fe${index}`,
              {
                kind: "secret.use",
                name,
                ...(info.oauth === null
                  ? {}
                  : {
                      oauth: {
                        authorization_endpoint: `https://${info.oauth.authorizeHost}/authorize`,
                        token_endpoint: `https://${info.oauth.authorizeHost}/token`,
                        scopes: [...info.oauth.scopes],
                      },
                    }),
              },
            ),
          );
    return [
      grant(GRANT_HOST, {
        kind: "net.fetch",
        host: "api.shipbob.com",
        port: 443,
      }),
      ...secrets,
      grant(
        GRANT_FILE,
        {
          kind: "fs.write",
          path: "~/Documents/orders-export",
          recursive: true,
        },
        "2026-10-12T10:05:00",
      ),
      grant(GRANT_LOOKUP, {
        kind: "app.call",
        app: CUSTOMERS,
        app_tools: ["customers.lookup"],
      }),
      grant(GRANT_RESERVE, {
        kind: "app.call",
        app: INVENTORY,
        app_tools: ["stock.reserve"],
      }),
    ];
  };

  const secretInfos = (): readonly (readonly [string, SecretInfo])[] =>
    options.secrets === undefined
      ? [["SHIPBOB_API_KEY", plain(true)]]
      : SECRETS[options.secrets];

  const plan = (): RewindPlan => {
    const byId = new Map(CALLS.map((item) => [item.id, item]));
    const item = (
      id: string,
      outcome: "undone" | "stays",
      running = false,
    ): RewindPlan["items"][number] => {
      const source = byId.get(id)!;
      return {
        invocation: source.id,
        started_at: source.started_at ?? "",
        operation: source.operation,
        caller: source.caller,
        effect: source.effect,
        reverts_db: outcome === "undone",
        external: outcome === "stays",
        running,
      };
    };
    return {
      app: MAIN,
      release: activeId,
      from_invocation: REWIND_FROM,
      items: [
        item("inv_39", "undone"),
        item("inv_38", "stays", rewinding),
        item(REWIND_FROM, "undone"),
      ],
      blocked: null,
    };
  };

  const otherApps: Record<string, string> = {
    [CUSTOMERS]: nameOf(CUSTOMERS, "Customers"),
    [INVENTORY]: nameOf(INVENTORY, "Inventory"),
  };

  const answers: readonly FakeAnswer[] = [
    // 폴더로 맞추지 않는 앱은 답이 없어 읽기가 실패하고 절이 서지 않는다.
    ...(options.machines === "waiting"
      ? [fakeAnswer(appUpdateState, UPDATE_WAITING)]
      : []),
    fakeAnswer(appGet, ({ app }) => ({
      ...COMMON,
      app:
        app in otherApps
          ? appRecord(app, otherApps[app]!)
          : {
              ...appRecord(app, "Orders"),
              folders: folders.map((path) => ({ path, description: "" })),
              active_release: activeId,
              run_enabled: runEnabled,
            },
    })),
    fakeAnswer(appRuntime, ({ app }) => ({
      ...COMMON,
      app,
      state:
        runState === "halted"
          ? {
              state: "unavailable" as const,
              termination_pending: false,
              reason: { code: "crash_loop", summary: "The app kept crashing" },
            }
          : { state: runState, termination_pending: false },
      observation: null,
      observed_at: null,
    })),
    fakeAnswer(appIcon, () => ({
      icon: uploadedIcon as z.output<typeof appIcon.output>["icon"],
      uploaded: uploadedIcon !== null,
    })),
    fakeAnswer(releasesListRecords, () => ({
      ...COMMON,
      releases: records(),
    })),
    fakeAnswer(releasesGetRecord, ({ release: id }) => ({
      ...COMMON,
      release:
        id === CUSTOMERS_R12
          ? release(CUSTOMERS_R12, 12, "77aa01c", 2, "2026-10-01T09:00:00")
          : (records().find((item) => item.id === id) ?? null),
    })),
    fakeAnswer(activationsQueue, () => ({
      ...COMMON,
      entries:
        (options.activation ?? "applied") === "applying"
          ? [
              {
                app: MAIN,
                release: R8,
                phase: "running" as const,
                step: "drain" as const,
                held_calls: 2,
                migration_steps: 2,
              },
            ]
          : [],
    })),
    fakeAnswer(activationsCompare, ({ release: id }) => ({
      ...COMMON,
      // 활성 release는 그 release가 적용될 때의 비교다.
      comparison: {
        previous_release: id === R8 ? R7 : R6,
        first: false,
        added_resources: ["api.shipbob.com"],
        added_tools: [{ app: INVENTORY, tool: "stock.reserve" }],
        loss_steps: [
          {
            from: 4,
            to: 5,
            loss: [
              {
                kind: "drop_column" as const,
                table: "orders",
                column: "legacy_note",
              },
            ],
          },
        ],
      },
    })),
    fakeAnswer(appSdkStatus, () => ({
      ...COMMON,
      apps: [
        {
          app: MAIN,
          name: "Orders",
          release: activeId,
          sdks: SDKS.map((sdk) => ({
            ...sdk,
            supported_from: null,
            notes: [],
            unreviewed: [],
          })),
          review: null,
        },
      ],
    })),
    fakeAnswer(appGrantsList, () => ({ ...COMMON, grants: grants() })),
    fakeAnswer(secretStatus, () => ({
      secrets: secretInfos()
        .filter(([, info]) => info.configured)
        .map(([name]) => ({ name, configured: true })),
    })),
    fakeAnswer(appsOAuthState, () => ({
      secrets: secretInfos().flatMap(([name, info]) =>
        info.oauth === null
          ? []
          : [
              {
                name,
                client_id: info.oauth.clientId,
                client_secret_set: info.oauth.clientSecretSet,
                state: info.oauth.state,
                reason: info.oauth.reason,
              },
            ],
      ),
    })),
    fakeAnswer(appTools, ({ app }) =>
      partial({
        tools:
          app === CUSTOMERS
            ? [{ name: "customers.lookup", effect: "read" }]
            : [{ name: "stock.reserve", effect: "write" }],
      }),
    ),
    fakeAnswer(appInvocations, () => ({ ...COMMON, invocations: [...CALLS] })),
    fakeAnswer(noticesList, () => ({ ...COMMON, notices: [...NOTICES] })),
    fakeAnswer(appRewindPlan, () => ({ ...COMMON, plan: plan() })),
    fakeAnswer(workspaceSessionRead, () =>
      partial({
        ...COMMON,
        session: { agent: ANALYST, title: "Weekly order digest" },
      }),
    ),
    fakeAnswer(machinesList, () =>
      partial({
        machines: [
          {
            machine: HOME_SERVER,
            device: "dev_01h455vb4pex5v6nkc6gd5fm01",
            name: "Home server",
            status: "connected",
            update: null,
            path: "relay",
            last_seen_at: null,
          },
        ],
      }),
    ),
    fakeAnswer(agentRead, () =>
      partial({ ...COMMON, effective: { name: { value: "Order analyst" } } }),
    ),
  ];

  const source: AppDetailSource = {
    rename: () => Promise.resolve({ ok: true, value: true }),
    archive: () => Promise.resolve({ ok: true, value: true }),
    setRun: (app, enabled) => {
      runEnabled = enabled;
      runState = enabled ? "running" : "stopped";
      changed({ name: "apps", id: app }, { name: "app_runtime", id: app });
      return Promise.resolve({ ok: true, value: true });
    },
    setIcon: (app, icon) => {
      uploadedIcon =
        icon === null
          ? null
          : {
              content_type: icon.type,
              data: btoa(String.fromCharCode(...icon.bytes)),
            };
      changed({ name: "apps", id: app });
      return Promise.resolve({ ok: true, value: true });
    },
    addFolder: (app) => {
      const path = "/home/me/shared/carriers";
      if (!folders.includes(path)) {
        folders = [...folders, path];
        changed({ name: "apps", id: app });
      }
      return Promise.resolve({ ok: true, value: true });
    },
    removeFolder: (app, path) => {
      folders = folders.filter((folder) => folder !== path);
      changed({ name: "apps", id: app });
      return Promise.resolve({ ok: true, value: true });
    },
    rollback: (id) => {
      activeId = id;
      changed({ name: "releases", id: null }, { name: "apps", id: null });
      return Promise.resolve({ ok: true, value: true });
    },
    // 정리는 끝나지 않아 접수한 grant는 정리 중으로 남는다.
    revoke: () => Promise.resolve({ ok: true, value: true }),
    // 값·sign-in은 보호 창과 browser 몫이라 gallery에서는 받기만 한다.
    setSecretValue: () => Promise.resolve({ ok: true, value: "stored" }),
    removeSecretValue: () => Promise.resolve({ ok: true, value: true }),
    setOAuthClientId: () => Promise.resolve({ ok: true, value: true }),
    setOAuthClientSecret: () => Promise.resolve({ ok: true, value: "stored" }),
    signIn: () => Promise.resolve({ ok: true, value: true }),
    cancelSignIn: () => Promise.resolve({ ok: true, value: true }),
    signOut: () => Promise.resolve({ ok: true, value: true }),
    rewind: (app) => {
      const mode = options.rewind ?? "applied";
      const result: RewindResult =
        mode === "conflict"
          ? {
              status: "cancelled",
              reason:
                "the row orders.1042 was changed after this call by something outside a recorded call.",
            }
          : { status: "applied", reason: null };
      if (mode !== "pending") {
        return Promise.resolve({ ok: true, value: result });
      }
      rewinding = true;
      changed({ name: "app_activity", id: app });
      return new Promise(() => {});
    },
  };

  return {
    source,
    /** 위 상태를 읽는 route 답. */
    answers,
    /** 쓰기가 바꾼 것. gallery가 `StateChanged`로 흘린다. */
    onChanged(listener: (changes: StateChange[]) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
