// app-detail의 가짜 통로. core를 부르지 않고 부른 것을 기록한다. Orders 앱의 release r5~r7, 바깥 자원,
// 호출 기록이 들어 있다. 적용 중·적용 실패·거두기 정리 중·rewind 각 단계는 인자로 고른다.
import type {
  AccessView,
  ActivityRow,
  AppApiRow,
  AppDetailSource,
  Caller,
  ReleaseCard,
  ReleaseChanges,
  ResourceRow,
  RewindItem,
  RewindPlanView,
  RewindResult,
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
  /** 다른 앱 이름. */
  names?: Readonly<Record<string, string>>;
}

export const GRANT_HOST = "grt_01h455vb4pex5v6nkc6gd5fd01";
export const GRANT_SECRET = "grt_01h455vb4pex5v6nkc6gd5fd02";
const GRANT_FILE = "grt_01h455vb4pex5v6nkc6gd5fd03";
const GRANT_LOOKUP = "grt_01h455vb4pex5v6nkc6gd5fd04";
export const GRANT_RESERVE = "grt_01h455vb4pex5v6nkc6gd5fd05";

const YOU: Caller = { kind: "person" };
const ANALYST: Caller = {
  kind: "agent",
  role: "operator",
  session: "ses_01h455vb4pex5v6nkc6gd5fd01",
  title: "Weekly order digest",
  turn: "trn_01h455vb4pex5v6nkc6gd5fd03",
  toolCall: "call_7f3a",
};

function row(
  id: string,
  at: string,
  caller: Caller,
  api: string | null,
  project: string | null,
  effect: ActivityRow["effect"],
  state: ActivityRow["state"],
  result: string,
  more: Partial<ActivityRow> = {},
): ActivityRow {
  return {
    id,
    at,
    caller,
    api,
    kind: api === null ? "start" : "api",
    project,
    effect,
    state,
    undone: false,
    releaseNumber: 7,
    earlier: false,
    inputHash: api === null ? null : "sha256:41c9e07b",
    result,
    ...more,
  };
}

const PHRONER = "prj_01h455vb4pex5v6nkc6gd5fd01";
const GROCERY = "prj_01h455vb4pex5v6nkc6gd5fd02";

const ACTIVITY: readonly ActivityRow[] = [
  row(
    "inv_41",
    "2026-10-15T14:41:00",
    { kind: "app", app: CUSTOMERS, appName: "Customers", releaseNumber: 12 },
    "orders.attachNote",
    GROCERY,
    "write",
    "waiting",
    "Waiting behind the running write",
  ),
  row(
    "inv_39",
    "2026-10-15T14:39:00",
    YOU,
    "orders.create",
    PHRONER,
    "write",
    "done",
    "Created order 1043",
  ),
  row(
    "inv_38",
    "2026-10-15T14:38:00",
    ANALYST,
    "orders.exportToSheet",
    PHRONER,
    "external",
    "done",
    "Sent 31 rows to the Orders digest sheet",
  ),
  row(
    "inv_36",
    "2026-10-15T14:36:00",
    ANALYST,
    "orders.refund",
    PHRONER,
    "write",
    "unknown",
    "Result unknown. lophn stopped during the call",
  ),
  row(
    "inv_32",
    "2026-10-15T14:32:00",
    YOU,
    "orders.markShipped",
    PHRONER,
    "write",
    "done",
    "Order 1042 marked shipped",
  ),
  row(
    "inv_22",
    "2026-10-15T14:22:00",
    YOU,
    "orders.markShipped",
    PHRONER,
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
    GROCERY,
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
    PHRONER,
    "read",
    "failed",
    "Failed: the query timed out",
  ),
  row(
    "inv_05",
    "2026-10-15T13:58:00",
    { kind: "start", reason: "activation" },
    null,
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
    PHRONER,
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
    api: source.api,
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
  addedAppApis: [{
    app: INVENTORY,
    appName: "Inventory",
    api: "stock.reserve",
  }],
  lossSteps: [{
    from: 4,
    to: 5,
    loss: [{ kind: "drop_column", table: "orders", column: "legacy_note" }],
  }],
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

  const reply = <T>(name: string, value: T): Promise<SourceResult<T>> => {
    calls.push([name]);
    return Promise.resolve(
      failing.has(name)
        ? { ok: false, code: "unavailable" }
        : { ok: true, value },
    );
  };

  const versionsView = (): VersionView => {
    const activation = options.activation ?? "applied";
    const active = RELEASES.find((item) => item.id === activeId) ?? null;
    return {
      active: active === null ? null : { ...active, replacedAt: null },
      applying: activation === "applying"
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
      failed: activation === "failed"
        ? {
          id: R8,
          number: 8,
          triedAt: "2026-10-15T15:07:00",
          reason:
            "Migration step 2 of 2 failed: NOT NULL constraint failed on orders.carrier. The database was restored from the backup.",
        }
        : null,
      earlier: RELEASES.filter((item) =>
        item.id !== activeId && item.number < 7
      ),
    };
  };

  const accessView = (): AccessView => {
    const resource = (
      grant: string,
      kind: ResourceRow["kind"],
      name: string,
      grantedAt: string,
    ): ResourceRow => ({
      grant,
      kind,
      name,
      grantedAt,
      revoking: requested.has(grant) && !revoked.has(grant),
      revoked: revoked.has(grant),
    });
    const appApi = (
      grant: string,
      app: string,
      appName: string,
      api: string,
      effect: "read" | "write",
    ): AppApiRow => ({
      grant,
      app,
      appName,
      apis: [{ api, effect }],
      grantedAt: "2026-10-15T13:58:00",
      revoking: requested.has(grant) && !revoked.has(grant),
      revoked: revoked.has(grant),
    });
    return {
      resources: [
        resource(
          GRANT_HOST,
          "network",
          "api.shipbob.com:443",
          "2026-10-15T13:58:00",
        ),
        resource(
          GRANT_SECRET,
          "secret",
          "SHIPBOB_API_KEY",
          "2026-10-15T13:58:00",
        ),
        resource(
          GRANT_FILE,
          "file-write",
          "~/Documents/orders-export",
          "2026-10-12T10:05:00",
        ),
      ],
      appApis: [
        appApi(
          GRANT_LOOKUP,
          CUSTOMERS,
          nameOf(CUSTOMERS, "Customers"),
          "customers.lookup",
          "read",
        ),
        appApi(
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

  const source: AppDetailSource = {
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
    activity: () =>
      reply("activity", {
        rows: ACTIVITY,
        projects: [
          { id: PHRONER, name: "phroner" },
          { id: GROCERY, name: "grocery" },
        ],
      }),
    rewindPlan: (_app, from) => {
      calls.push(["rewindPlan", from]);
      return reply("rewindPlan", plan());
    },
    rewind: (_app, from) => {
      calls.push(["rewind", from]);
      const mode = options.rewind ?? "applied";
      const result: RewindResult = mode === "conflict"
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
          ? [{
            invocation: "inv_38",
            api: "orders.exportToSheet",
            at: "2026-10-15T14:38:00",
          }]
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
