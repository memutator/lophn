// Settings › Sync의 가짜 통로. core를 부르지 않고 메모리에 둔다. 거절은 `refuse`로 고정한다.
import type { MachineItem } from "../../../machines/source.ts";
import type {
  SaveOutcome,
  SyncAppRow,
  SyncFolder,
  SyncReceived,
  SyncSettingsSource,
} from "../source.ts";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export interface FakeSyncOptions {
  /** 처음 같이 보는 폴더. 없으면 Google Drive 폴더다. null이면 정하지 않았다. */
  shared?: string | null;
  /** 처음 이름 붙인 폴더. 없으면 둘(`notes-backup`, `photos`)이다. */
  named?: SyncFolder[];
  /** `remote.enabled`. 없으면 켜져 있다. */
  remoteEnabled?: boolean;
  received?: SyncReceived[];
  apps?: SyncAppRow[];
  /** 저장을 거절하는 글. 없으면 저장된다. */
  refuse?: string;
  /** [Choose…]가 돌려주는 path. */
  picked?: string;
}

/** 대표 컴퓨터 넷: 직접 붙음, relay로 붙음, 꺼졌지만 폰이 file을 나름, 꺼짐. */
export function sampleSyncMachines(now = Date.now()): MachineItem[] {
  const machine = (
    id: string,
    name: string,
    fields: Pick<MachineItem, "status" | "path" | "lastSeenAt">,
  ): MachineItem => ({ id, name, update: null, ...fields });
  return [
    machine("mch_homeserver", "Home server", {
      status: "connected",
      path: "direct",
      lastSeenAt: new Date(now).toISOString(),
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
      syncTo: "computers",
      readAt: new Date(now - 4 * MINUTE).toISOString(),
    },
    {
      app: "app_notes",
      name: "Notes",
      syncTo: "notes-backup",
      readAt: new Date(now - 5 * HOUR).toISOString(),
    },
    {
      app: "app_budget",
      name: "Budget",
      syncTo: "computers",
      readAt: null,
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
        received: options.received ?? sampleReceived(),
        apps: options.apps ?? sampleApps(),
      }),
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
    pickFolder: () => ok(options.picked ?? "/home/me/Dropbox/lophn"),
  };
  return { source };
}
