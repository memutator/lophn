// app-detail의 가짜 통로. core를 부르지 않고 부른 것을 기록한다. Orders 앱의 release r5~r7, 바깥 자원,
// 호출 기록이 들어 있다. 적용 중·적용 실패·거두기 정리 중·rewind 각 단계는 인자로 고른다.
import type {
  AccessView,
  ActivityRow,
  AppDetailSource,
  AppNoticeRow,
  AppToolRow,
  Caller,
  OAuthReason,
  ReleaseCard,
  ReleaseChanges,
  ResourceRow,
  RewindItem,
  RewindPlanView,
  RewindResult,
  RunView,
  SecretInfo,
  SourceResult,
  VersionView,
} from "../source.ts";

const CUSTOMERS = "app_01h455vb4pex5v6nkc6gd5fd02";
const INVENTORY = "app_01h455vb4pex5v6nkc6gd5fd03";

const R7 = "rel_01h455vb4pex5v6nkc6gd5fd07";
const R6 = "rel_01h455vb4pex5v6nkc6gd5fd06";
const R5 = "rel_01h455vb4pex5v6nkc6gd5fd05";
const R8 = "rel_01h455vb4pex5v6nkc6gd5fd08";

const release = (
  id: string,
  number: number,
  commit: string,
  dataSchema: number,
  appliedAt: string,
  replacedAt: string | null,
): ReleaseCard => ({ id, number, commit, dataSchema, appliedAt, replacedAt });

const RELEASES: readonly ReleaseCard[] = [
  release(R7, 7, "3f9a1c2", 4, "2026-10-15T13:58:00", null),
  release(R6, 6, "b81e7d0", 4, "2026-10-12T10:05:00", "2026-10-15T13:58:00"),
  release(R5, 5, "9d04ac1", 3, "2026-10-08T09:40:00", "2026-10-12T10:05:00"),
];

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
  /** 거두기 정리. pending이면 요청 뒤 정리 중으로 남고 finishCleanup()으로 끝낸다. */
  cleanup?: "pending" | "done";
  /** rewind 결과. pending이면 도는 중으로 남고 finishRewind()로 끝낸다. */
  rewind?: RewindFake;
  /** rewind 계획에 결과 모르는 write가 있어 시작할 수 없다. */
  rewindBlocked?: boolean;
  /** 거두기를 이미 요청해 정리 중인 grant. */
  revoking?: readonly string[];
  /** 이 이름의 읽기는 실패한다. */
  failing?: readonly string[];
  /** Access 탭의 secret 줄들. */
  secrets?: SecretsFake;
  /** 실행 상태. 기본은 running. halted는 켜진 채 crash loop로 멈춘 것이다. */
  run?: "running" | "stopped" | "halted";
  /** 다른 앱 이름. */
  names?: Readonly<Record<string, string>>;
}

export const GRANT_HOST = "grt_01h455vb4pex5v6nkc6gd5fd01";
export const GRANT_SECRET = "grt_01h455vb4pex5v6nkc6gd5fd02";
const GRANT_FILE = "grt_01h455vb4pex5v6nkc6gd5fd03";
const GRANT_LOOKUP = "grt_01h455vb4pex5v6nkc6gd5fd04";
export const GRANT_RESERVE = "grt_01h455vb4pex5v6nkc6gd5fd05";

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

const YOU: Caller = { kind: "person" };
const ANALYST: Caller = {
  kind: "agent",
  agent: "agt_01h455vb4pex5v6nkc6gd5fd09",
  name: "Order analyst",
  session: "ses_01h455vb4pex5v6nkc6gd5fd01",
  title: "Weekly order digest",
  turn: "trn_01h455vb4pex5v6nkc6gd5fd03",
  toolCall: "call_7f3a",
};

function row(
  id: string,
  at: string,
  caller: Caller,
  tool: string | null,
  effect: ActivityRow["effect"],
  state: ActivityRow["state"],
  result: string,
  more: Partial<ActivityRow> = {},
): ActivityRow {
  return {
    id,
    at,
    caller,
    tool,
    kind: tool === null ? "start" : "call",
    effect,
    state,
    undone: false,
    releaseNumber: 7,
    earlier: false,
    inputHash: tool === null ? null : "sha256:41c9e07b",
    result,
    ...more,
  };
}

const NOTICES: readonly AppNoticeRow[] = [
  {
    id: "ntc_1",
    kind: "release_failed",
    title: "Release r8 of Orders failed",
    body: "The app is back on release r7.",
    at: "2026-10-15T14:40:00",
    unread: true,
  },
  {
    id: "ntc_2",
    kind: "release_activated",
    title: "Release r7 of Orders is active",
    body: "",
    at: "2026-10-14T09:12:00",
    unread: false,
  },
];

const ACTIVITY: readonly ActivityRow[] = [
  row(
    "inv_41",
    "2026-10-15T14:41:00",
    { kind: "app", app: CUSTOMERS, appName: "Customers", releaseNumber: 12 },
    "orders.attachNote",
    "write",
    "waiting",
    "Waiting behind the running write",
  ),
  row(
    "inv_39",
    "2026-10-15T14:39:00",
    YOU,
    "orders.create",
    "write",
    "done",
    "Created order 1043",
  ),
  row(
    "inv_38",
    "2026-10-15T14:38:00",
    { kind: "program" },
    "orders.exportToSheet",
    "external",
    "done",
    "Sent 31 rows to the Orders digest sheet",
  ),
  row(
    "inv_36",
    "2026-10-15T14:36:00",
    ANALYST,
    "orders.refund",
    "write",
    "unknown",
    "Result unknown. lophn stopped during the call",
  ),
  row(
    "inv_32",
    "2026-10-15T14:32:00",
    YOU,
    "orders.markShipped",
    "write",
    "done",
    "Order 1042 marked shipped",
  ),
  row(
    "inv_22",
    "2026-10-15T14:22:00",
    YOU,
    "orders.markShipped",
    "write",
    "done",
    "Order 1041 marked shipped",
    { undone: true },
  ),
  row(
    "inv_20",
    "2026-10-15T14:20:00",
    ANALYST,
    "orders.cancel",
    "write",
    "done",
    "Order 1040 cancelled",
    { undone: true },
  ),
  row(
    "inv_11",
    "2026-10-15T14:11:00",
    YOU,
    "orders.list",
    "read",
    "failed",
    "Failed: the query timed out",
  ),
  row(
    "inv_05",
    "2026-10-15T13:58:00",
    { kind: "start", reason: "activation" },
    null,
    "write",
    "done",
    "Seeded 3 carriers",
  ),
  row(
    "inv_r6",
    "2026-10-15T13:20:00",
    YOU,
    "orders.markShipped",
    "write",
    "done",
    "Order 1039 marked shipped",
    { releaseNumber: 6, earlier: true },
  ),
];

const REWIND_FROM = "inv_32";

function planItem(
  source: ActivityRow,
  outcome: RewindItem["outcome"],
  running = false,
): RewindItem {
  return {
    invocation: source.id,
    at: source.at ?? "",
    tool: source.tool,
    kind: source.kind,
    effect: source.effect,
    caller: source.caller,
    outcome,
    running,
  };
}

const changesTo = (fromNumber: number): ReleaseChanges => ({
  fromNumber,
  toNumber: fromNumber + 1,
  first: false,
  addedResources: ["api.shipbob.com"],
  addedTools: [
    {
      app: INVENTORY,
      appName: "Inventory",
      tool: "stock.reserve",
    },
  ],
  lossSteps: [
    {
      from: 4,
      to: 5,
      loss: [{ kind: "drop_column", table: "orders", column: "legacy_note" }],
    },
  ],
});

export function fakeDetail(options: FakeOptions = {}) {
  const calls: unknown[][] = [];
  const failing = new Set(options.failing ?? []);
  const nameOf = (app: string, fallback: string) =>
    options.names?.[app] ?? fallback;
  let activeId = R7;
  const revoked = new Set<string>();
  const requested = new Set(options.revoking ?? []);
  let finishRewindWith: ((result: RewindResult) => void) | null = null;
  let rewinding = false;
  // source 밖에 이은 폴더. Add는 늘 같은 경로 하나를 더한다.
  let folders: readonly string[] = ["/home/me/notes/orders"];
  // 올린 icon의 data URL. 없으면 앱이 선언한 icon이 없는 기본 표식이다.
  let uploadedIcon: string | null = null;

  const reply = <T>(name: string, value: T): Promise<SourceResult<T>> => {
    calls.push([name]);
    return Promise.resolve(
      failing.has(name)
        ? { ok: false, code: "unavailable" }
        : { ok: true, value },
    );
  };

  const acted = <T>(name: string, value: T): Promise<SourceResult<T>> =>
    Promise.resolve(
      failing.has(name)
        ? { ok: false, code: "unavailable" }
        : { ok: true, value },
    );

  const versionsView = (): VersionView => {
    const activation = options.activation ?? "applied";
    const active = RELEASES.find((item) => item.id === activeId) ?? null;
    return {
      active: active === null ? null : { ...active, replacedAt: null },
      sdks: [
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
      ],
      applying:
        activation === "applying"
          ? {
              id: R8,
              number: 8,
              phase: "running",
              steps: [
                { key: "hold", state: "done", count: 2 },
                { key: "drain", state: "now", count: null },
                { key: "stop", state: "wait", count: null },
                { key: "migrate", state: "wait", count: 2 },
                { key: "start", state: "wait", count: null },
              ],
            }
          : null,
      failed:
        activation === "failed"
          ? {
              id: R8,
              number: 8,
              triedAt: "2026-10-15T15:07:00",
              reason:
                "Migration step 2 of 2 failed: NOT NULL constraint failed on orders.carrier. The database was restored from the backup.",
            }
          : null,
      earlier: RELEASES.filter(
        (item) => item.id !== activeId && item.number < 7,
      ),
    };
  };

  const accessView = (): AccessView => {
    const resource = (
      grant: string,
      kind: ResourceRow["kind"],
      name: string,
      grantedAt: string,
      secret?: SecretInfo,
    ): ResourceRow => ({
      grant,
      kind,
      name,
      grantedAt,
      revoking: requested.has(grant) && !revoked.has(grant),
      revoked: revoked.has(grant),
      ...(secret === undefined ? {} : { secret }),
    });
    const secrets =
      options.secrets === undefined
        ? [
            resource(
              GRANT_SECRET,
              "secret",
              "SHIPBOB_API_KEY",
              "2026-10-15T13:58:00",
              plain(true),
            ),
          ]
        : SECRETS[options.secrets].map(([name, info], index) =>
            resource(
              index === 0
                ? GRANT_SECRET
                : `grt_01h455vb4pex5v6nkc6gd5fe${index}`,
              "secret",
              name,
              "2026-10-15T13:58:00",
              info,
            ),
          );
    const appTool = (
      grant: string,
      app: string,
      appName: string,
      tool: string,
      effect: "read" | "write",
    ): AppToolRow => ({
      grant,
      app,
      appName,
      tools: [{ tool, effect }],
      grantedAt: "2026-10-15T13:58:00",
      revoking: requested.has(grant) && !revoked.has(grant),
      revoked: revoked.has(grant),
    });
    return {
      appName: "Orders",
      resources: [
        resource(
          GRANT_HOST,
          "network",
          "api.shipbob.com:443",
          "2026-10-15T13:58:00",
        ),
        ...secrets,
        resource(
          GRANT_FILE,
          "file-write",
          "~/Documents/orders-export",
          "2026-10-12T10:05:00",
        ),
      ],
      appTools: [
        appTool(
          GRANT_LOOKUP,
          CUSTOMERS,
          nameOf(CUSTOMERS, "Customers"),
          "customers.lookup",
          "read",
        ),
        appTool(
          GRANT_RESERVE,
          INVENTORY,
          nameOf(INVENTORY, "Inventory"),
          "stock.reserve",
          "write",
        ),
      ],
    };
  };

  const plan = (): RewindPlanView => {
    const byId = new Map(ACTIVITY.map((item) => [item.id, item]));
    const get = (id: string) => byId.get(id)!;
    const items: RewindItem[] = [
      planItem(get("inv_39"), "undone"),
      planItem(get("inv_38"), "stays", rewinding),
      ...(options.rewindBlocked ? [planItem(get("inv_36"), "cannot")] : []),
      planItem(get(REWIND_FROM), "undone"),
    ];
    return {
      from: REWIND_FROM,
      items,
      blocked: options.rewindBlocked ? { invocation: "inv_36" } : null,
    };
  };

  // 끄면 stopped, 켜면 running으로 바로 간다. halted에서 껐다 켜도 같다(실제는 10분 창이 지나야 다시 돈다).
  let run: RunView = {
    enabled: (options.run ?? "running") !== "stopped",
    state: options.run ?? "running",
  };

  const source: AppDetailSource = {
    run: () => reply("run", run),
    setRun: (_app, enabled) => {
      calls.push(["setRun", enabled]);
      if (failing.has("setRun")) {
        return Promise.resolve({ ok: false, code: "conflict" });
      }
      run = { enabled, state: enabled ? "running" : "stopped" };
      return Promise.resolve({ ok: true, value: true });
    },
    icon: () =>
      reply("icon", { src: uploadedIcon, uploaded: uploadedIcon !== null }),
    setIcon: (_app, icon) => {
      calls.push(["setIcon", icon?.type ?? null]);
      if (failing.has("setIcon")) {
        return Promise.resolve({ ok: false, code: "invalid_input" });
      }
      uploadedIcon =
        icon === null
          ? null
          : `data:${icon.type};base64,${btoa(String.fromCharCode(...icon.bytes))}`;
      return Promise.resolve({ ok: true, value: true });
    },
    folders: () => reply("folders", folders),
    addFolder: () => {
      const path = "/home/me/shared/carriers";
      if (folders.includes(path)) return reply("addFolder", null);
      folders = [...folders, path];
      return reply("addFolder", folders);
    },
    removeFolder: (_app, path) => {
      folders = folders.filter((folder) => folder !== path);
      return reply("removeFolder", folders);
    },
    versions: () => reply("versions", versionsView()),
    changes: (id) => {
      calls.push(["changes", id]);
      // 활성 release는 그 release가 적용될 때의 비교다.
      return reply("changes", changesTo(id === R8 ? 7 : 6));
    },
    rollback: (id) => {
      calls.push(["rollback", id]);
      if (failing.has("rollback")) {
        return Promise.resolve({ ok: false, code: "conflict" });
      }
      activeId = id;
      return Promise.resolve({ ok: true, value: true });
    },
    access: () => reply("access", accessView()),
    revoke: (grant) => {
      calls.push(["revoke", grant]);
      if (failing.has("revoke")) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      requested.add(grant);
      if ((options.cleanup ?? "pending") === "done") revoked.add(grant);
      return Promise.resolve({ ok: true, value: true });
    },
    setSecretValue: (name, subject) => {
      calls.push(["setSecretValue", name, subject]);
      return acted("setSecretValue", "stored" as const);
    },
    removeSecretValue: (name) => {
      calls.push(["removeSecretValue", name]);
      return acted("removeSecretValue", true as const);
    },
    setOAuthClientId: (app, name, clientId) => {
      calls.push(["setOAuthClientId", app, name, clientId]);
      return acted("setOAuthClientId", true as const);
    },
    setOAuthClientSecret: (name, subject) => {
      calls.push(["setOAuthClientSecret", name, subject]);
      return acted("setOAuthClientSecret", "stored" as const);
    },
    signIn: (app, name) => {
      calls.push(["signIn", app, name]);
      return acted("signIn", true as const);
    },
    cancelSignIn: (app, name) => {
      calls.push(["cancelSignIn", app, name]);
      return acted("cancelSignIn", true as const);
    },
    signOut: (app, name) => {
      calls.push(["signOut", app, name]);
      return acted("signOut", true as const);
    },
    activity: () =>
      reply("activity", {
        rows: ACTIVITY,
        notices: NOTICES,
      }),
    rewindPlan: (_app, from) => {
      calls.push(["rewindPlan", from]);
      return reply("rewindPlan", plan());
    },
    rewind: (_app, from) => {
      calls.push(["rewind", from]);
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
      return new Promise((resolve) => {
        finishRewindWith = (done) => {
          rewinding = false;
          resolve({ ok: true, value: done });
        };
      });
    },
    rewindProgress: () =>
      reply("rewindProgress", {
        running: rewinding
          ? [
              {
                invocation: "inv_38",
                tool: "orders.exportToSheet",
                at: "2026-10-15T14:38:00",
              },
            ]
          : [],
      }),
    stopPreview: (app, preview) => {
      calls.push(["stopPreview", app, preview.nonce]);
      return Promise.resolve();
    },
  };

  return {
    source,
    calls,
    /** 거두기 요청한 grant의 정리를 끝낸다. */
    finishCleanup: () => {
      for (const grant of requested) revoked.add(grant);
    },
    /** pending으로 둔 rewind를 끝낸다. */
    finishRewind: (
      result: RewindResult = { status: "applied", reason: null },
    ) => finishRewindWith?.(result),
  };
}
