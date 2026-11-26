// Settings › Sync의 가짜 통로. core를 부르지 않고 메모리에 둔다. 거절은 `refuse`로 고정한다.
import type { MachineItem } from "../../../machines/source.ts";
import type {
  AvailableApp,
  SaveOutcome,
  StagedSettingsApplyOutcome,
  StagedSettingsBatch,
  SyncAppRow,
  SyncFolder,
  SyncReceived,
  SyncSettingsSource,
  TakeInOutcome,
  TransferRecord,
} from "../source.ts";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

export interface FakeSyncOptions {
  /** 처음 같이 보는 폴더. 없으면 Google Drive 폴더다. null이면 정하지 않았다. */
  shared?: string | null;
  /** 처음 이름 붙인 폴더. 없으면 둘(`notes-backup`, `photos`)이다. */
  named?: SyncFolder[];
  /** `remote.enabled`. 없으면 켜져 있다. */
  remoteEnabled?: boolean;
  received?: SyncReceived[];
  apps?: SyncAppRow[];
  /** 다른 컴퓨터가 내놓은 앱. 없으면 하나(`Recipes`)다. */
  available?: AvailableApp[];
  /** [Install on this computer]의 결과. 없으면 준비된다. */
  takeIn?: TakeInOutcome;
  /** 명단에 같은 machine id가 둘 이상인 컴퓨터. */
  duplicateMachines?: string[];
  /** 같이 보는 폴더의 상태. 없으면 쓸 수 있다. */
  sharedState?: "ok" | "missing" | "not_writable";
  /** 저장을 거절하는 글. 없으면 저장된다. */
  refuse?: string;
  /** [Choose…]가 돌려주는 path. */
  picked?: string;
  /** 송수신 파일 transfer 목록. */
  transfers?: TransferRecord[];
  /** 대기 중인 staged 설정 목록. */
  staged?: StagedSettingsBatch[];
}

/** 대표 컴퓨터 넷: 직접 붙음(Hub), relay로 붙음, 꺼졌지만 폰이 file을 나름, 꺼짐. */
export function sampleSyncMachines(now = Date.now()): MachineItem[] {
  const machine = (
    id: string,
    name: string,
    fields: Pick<MachineItem, "status" | "path" | "lastSeenAt" | "hub">,
  ): MachineItem => ({ id, name, update: null, ...fields });
  return [
    machine("mch_homeserver", "Home server", {
      status: "connected",
      path: "direct",
      lastSeenAt: new Date(now).toISOString(),
      hub: true,
    }),
    machine("mch_office", "Office desktop", {
      status: "connected",
      path: "relay",
      lastSeenAt: new Date(now).toISOString(),
    }),
    machine("mch_laptop", "Work laptop", {
      status: "offline",
      path: null,
      lastSeenAt: new Date(now - 3 * HOUR).toISOString(),
    }),
    machine("mch_netbook", "Old netbook", {
      status: "offline",
      path: null,
      lastSeenAt: new Date(now - 50 * HOUR).toISOString(),
    }),
  ];
}

export function sampleReceived(now = Date.now()): SyncReceived[] {
  return [
    {
      machine: "mch_homeserver",
      receivedAt: new Date(now - 4 * MINUTE).toISOString(),
      via: "link",
    },
    {
      machine: "mch_office",
      receivedAt: new Date(now - 20 * MINUTE).toISOString(),
      via: "link",
    },
    {
      machine: "mch_laptop",
      receivedAt: new Date(now - 3 * HOUR).toISOString(),
      via: "phone",
    },
  ];
}

export function sampleApps(now = Date.now()): SyncAppRow[] {
  return [
    {
      app: "app_orders",
      name: "Orders",
      destinations: ["computers", "notes-backup"],
      readAt: new Date(now - 4 * MINUTE).toISOString(),
      syncPolicy: "computers",
      syncOverride: "default",
    },
    {
      app: "app_notes",
      name: "Notes",
      destinations: ["notes-backup"],
      readAt: new Date(now - 5 * HOUR).toISOString(),
      syncPolicy: "mixed",
      syncOverride: "default",
      heldCount: 2,
    },
    {
      app: "app_budget",
      name: "Budget",
      destinations: [],
      readAt: null,
      syncPolicy: "local",
      syncOverride: "local",
    },
  ];
}

export function sampleTransfers(now = Date.now()): TransferRecord[] {
  return [
    {
      id: "trf_01jd0000000000000000000001",
      from_machine: "mch_01jd0000000000000000000002",
      from_name: "Home server",
      to_machine: "mch_01jd0000000000000000000001",
      to_name: "Studio",
      direction: "incoming",
      note: "Benchmark archive from nightly run",
      files: [
        {
          name: "report.tar.gz",
          rel_path: "report.tar.gz",
          size: 2_450_000,
          sha256: HASH_A,
        },
      ],
      state: "delivered",
      inbox_dir: "/home/me/.lophn/inbox/trf_01jd0000000000000000000001",
      created_at: new Date(now - 15 * MINUTE).toISOString(),
      updated_at: new Date(now - 14 * MINUTE).toISOString(),
      expires_at: new Date(now + 7 * DAY).toISOString(),
    },
    {
      id: "trf_01jd0000000000000000000002",
      from_machine: "mch_01jd0000000000000000000001",
      from_name: "Studio",
      to_machine: "mch_01jd0000000000000000000003",
      to_name: "Work laptop",
      direction: "outgoing",
      note: "Release draft assets",
      files: [
        {
          name: "slides.pdf",
          rel_path: "slides.pdf",
          size: 842_120,
          sha256: HASH_B,
        },
      ],
      state: "held_at_hub",
      held_by: ["mch_01jd0000000000000000000002"],
      inbox_dir: null,
      created_at: new Date(now - 2 * HOUR).toISOString(),
      updated_at: new Date(now - 2 * HOUR).toISOString(),
      expires_at: new Date(now + 7 * DAY).toISOString(),
    },
  ];
}

export function sampleStagedSettings(now = Date.now()): StagedSettingsBatch[] {
  return [
    {
      id: "stg_01jd0000000000000000000001",
      from_machine: "mch_01jd0000000000000000000002",
      from_name: "Home server",
      to_machine: "mch_01jd0000000000000000000001",
      project_identity: null,
      items: [
        {
          kind: "workflow",
          id: "release-check",
          title: "release-check",
          files: [
            {
              rel_path: "workflow.yaml",
              content: "participants:\n  a: { agent: lophn }\n",
              sha256: HASH_A,
            },
          ],
        },
        {
          kind: "permission_rules",
          id: "permission_rules",
          title: "Permission rules",
          files: [
            {
              rel_path: "permission-rules.json",
              content: '{"global":[]}\n',
              sha256: HASH_B,
            },
          ],
          locked_fields: ["permission_rules"],
        },
      ],
      state: "pending",
      delivery_state: "delivered",
      note: "Updated release workflow and rules from Home server",
      created_at: new Date(now - 35 * MINUTE).toISOString(),
      updated_at: new Date(now - 35 * MINUTE).toISOString(),
    },
  ];
}

export function fakeSync(options: FakeSyncOptions = {}) {
  let shared =
    options.shared === undefined
      ? "/home/me/Google Drive/lophn"
      : options.shared;
  let named: readonly SyncFolder[] = options.named ?? [
    { name: "notes-backup", path: "/home/me/Sync/notes", state: "ok" },
    { name: "photos", path: "/mnt/photos/lophn", state: "missing" },
  ];
  let apps: readonly SyncAppRow[] = options.apps ?? sampleApps();
  let transfers: readonly TransferRecord[] =
    options.transfers ?? sampleTransfers();
  let staged: readonly StagedSettingsBatch[] =
    options.staged ?? sampleStagedSettings();
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
  const saved = (): Promise<SaveOutcome> =>
    Promise.resolve(
      options.refuse === undefined
        ? { ok: true }
        : { ok: false, reason: "rejected", message: options.refuse },
    );
  const source: SyncSettingsSource = {
    folders: () =>
      ok({ shared, named, remoteEnabled: options.remoteEnabled ?? true }),
    status: () =>
      ok({
        shared:
          shared === null
            ? null
            : { path: shared, state: options.sharedState ?? "ok" },
        received: options.received ?? sampleReceived(),
        apps,
        duplicateMachines: options.duplicateMachines ?? [],
        available: options.available ?? [
          {
            app: "app_01jd00000000000000000000rc",
            name: "Recipes",
            machine: "mch_homeserver",
          },
        ],
        hubMachines: ["mch_homeserver"],
      }),
    takeIn: (app) =>
      Promise.resolve(
        options.takeIn ?? {
          ok: true,
          app,
          release: "rel_01jd00000000000000000000rc",
        },
      ),
    async saveNamed({ name, path, was }) {
      const done = await saved();
      if (!done.ok) return done;
      const row: SyncFolder = { name, path, state: "ok" };
      named =
        was === null
          ? [...named, row]
          : named.map((one) => (one.name === was ? row : one));
      return done;
    },
    async removeNamed(name) {
      const done = await saved();
      if (done.ok) named = named.filter((one) => one.name !== name);
      return done;
    },
    async setShared(path) {
      const done = await saved();
      if (done.ok) shared = path;
      return done;
    },
    async setAppSyncPolicy(app, policy) {
      const done = await saved();
      if (!done.ok) return done;
      apps = apps.map((row) =>
        row.app === app
          ? {
              ...row,
              syncOverride: policy,
              syncPolicy:
                policy === "default"
                  ? "computers"
                  : policy === "local"
                    ? "local"
                    : "computers",
            }
          : row,
      );
      return done;
    },
    async resolveAppHeld(app) {
      const done = await saved();
      if (!done.ok) return done;
      apps = apps.map((row) =>
        row.app === app ? { ...row, heldCount: 0, awaySince: null } : row,
      );
      return done;
    },
    pickFolder: () => ok(options.picked ?? "/home/me/Dropbox/lophn"),
    transfers: () => ok(transfers),
    clearTransfer(id) {
      transfers = transfers.filter((item) => item.id !== id);
      return ok(null);
    },
    openInbox: () => ok(null),
    stagedSettings: () => ok(staged.filter((b) => b.state === "pending")),
    applyStagedSettings({ batch: batchId, itemIds, confirmPermissions }) {
      const found = staged.find((b) => b.id === batchId);
      if (found === undefined) {
        return Promise.resolve({ ok: false, code: "not_found" });
      }
      const selected =
        itemIds === undefined
          ? found.items
          : found.items.filter((i) => itemIds.includes(i.id));
      let requiresPermissionConfirmation = false;
      const applied: StagedSettingsApplyOutcome["applied"][number][] = [];
      for (const item of selected) {
        const sensitive =
          item.kind === "permission_rules" ||
          (item.locked_fields !== undefined && item.locked_fields.length > 0);
        if (sensitive && confirmPermissions !== true) {
          requiresPermissionConfirmation = true;
          applied.push({
            kind: item.kind,
            id: item.id,
            status: "requires_person_confirmation",
          });
        } else {
          applied.push({ kind: item.kind, id: item.id, status: "applied" });
        }
      }
      if (!requiresPermissionConfirmation) {
        staged = staged.map((b) =>
          b.id === batchId ? { ...b, state: "applied" } : b,
        );
      }
      return ok<StagedSettingsApplyOutcome>({
        applied,
        requiresPermissionConfirmation,
      });
    },
    dismissStagedSettings(batchId) {
      staged = staged.map((b) =>
        b.id === batchId ? { ...b, state: "dismissed" } : b,
      );
      return ok(null);
    },
  };
  return { source };
}
