// 읽기 명령 `machine.environment`의 출력을 모은다(README 계약 7). 경로 말고는 local file 내용을 싣지 않는다.
// 뒤 계획은 명령의 code를 고치지 않고 `register`로 이름 붙은 section을 채운다. section 함수 하나가 던지거나 2초를 넘으면
// 그 section만 `{ error }`다. 흔적 정리의 경계(README 계약 10)도 여기서 센다: 환경이 싣는 horizon이 그 결과다.
import type { Result } from "../../base/mod.ts";
import { hlcAtMs } from "../../protocol/apps/sync/clock.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type MachineEnvironment,
  SECTION_TIMEOUT_MS,
  TOMBSTONE_HORIZON_MS,
} from "../../protocol/folder/mod.ts";
import type { AvailableApp } from "./apps/mod.ts";
import type { DestinationsView } from "./destinations.ts";
import type { ExportStatus } from "./export/mod.ts";
import type { ImportStatus, KnownRecords } from "./import/mod.ts";

type Env = MachineEnvironment;
type Sections = Record<string, unknown>;

export type FolderSection = {
  name: string;
  top?(): Promise<unknown>;
  machine?(id: Id<"mch">): Promise<unknown>;
  app?(app: Id<"app">): Promise<unknown>;
};

/** 뒤 계획이 `machine.environment`에 section을 꽂는 자리(`ctx.folderEnvironment`). 같은 이름을 두 번 등록하면 던진다. */
export type FolderEnvironment = { register(section: FolderSection): void };

export function createFolderSections(timeoutMs = SECTION_TIMEOUT_MS) {
  const sections: FolderSection[] = [];

  async function one(fn: () => Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no answer within ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
    } catch (thrown) {
      return {
        error: thrown instanceof Error ? thrown.message : String(thrown),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fill(
    pick: (section: FolderSection) => (() => Promise<unknown>) | undefined,
  ): Promise<Sections> {
    const out: Sections = {};
    await Promise.all(
      sections.map(async (section) => {
        const fn = pick(section);
        if (fn !== undefined) out[section.name] = await one(fn);
      }),
    );
    return out;
  }

  return {
    register(section: FolderSection): void {
      if (sections.some((each) => each.name === section.name)) {
        throw new Error(
          `machine.environment section "${section.name}" is registered twice`,
        );
      }
      sections.push(section);
    },
    top: () => fill((s) => s.top && (() => s.top!())),
    machine: (id: Id<"mch">) =>
      fill((s) => s.machine && (() => s.machine!(id))),
    app: (app: Id<"app">) => fill((s) => s.app && (() => s.app!(app))),
  };
}

export type FolderSections = ReturnType<typeof createFolderSections>;

/**
 * 흔적 정리의 경계: clock이 이보다 작은 tombstone만 지운다. `max(min(알려진 기계와 자기의 settled), now − 90일)`.
 * 모두가 지난 것이거나 90일보다 옛 것만 지운다는 뜻이다. `peers`는 알려진(사람이 지우지 않은) 다른 기계의 그 앱
 * 기록이다. 자기나 알려진 기계 가운데 `settled`가 없는 기계가 있으면 90일 쪽만 쓴다.
 */
export function cleanupBefore(input: {
  own: string | null;
  peers: readonly { settled: string | null }[];
  nowMs: number;
}): bigint {
  const floor = hlcAtMs(input.nowMs - TOMBSTONE_HORIZON_MS);
  const all = [input.own, ...input.peers.map((peer) => peer.settled)];
  if (all.some((settled) => settled === null)) return floor;
  const least = all
    .map((settled) => BigInt(settled!))
    .reduce((min, each) => (each < min ? each : min));
  return least > floor ? least : floor;
}

export type EnvironmentApp = {
  app: Id<"app">;
  name: string;
  sync_to: string | null;
  bundle_hash: string | null;
};

export type EnvironmentDeps = {
  machine(): { id: Id<"mch">; name: string };
  alwaysOn(): Env["machines"][number]["always_on"];
  addresses(): Env["machines"][number]["addresses"];
  version(): string | null;
  destinations: DestinationsView;
  /** 이 기계의 활성 release가 있는 앱. */
  apps(): EnvironmentApp[];
  exportStatus(app: Id<"app">): ExportStatus | null;
  importStatus(app: Id<"app">): ImportStatus[];
  away(app: Id<"app">): Promise<Env["apps"][number]["away"]>;
  records(): KnownRecords;
  available(): Result<AvailableApp[]>;
  sections: FolderSections;
};

export async function readEnvironment(deps: EnvironmentDeps): Promise<Env> {
  const me = deps.machine();
  const records = deps.records();
  const destinations = deps.destinations.list();
  const listed = [
    {
      id: me.id,
      name: me.name,
      always_on: deps.alwaysOn(),
      addresses: deps.addresses(),
      lophn_version: deps.version(),
      record_at: null,
      destinations: destinations.map((each) => each.name),
    },
    ...records.machines
      .filter((row) => row.machine !== me.id)
      .map(({ machine, record, destination }) => ({
        id: machine,
        name: record.name,
        always_on: record.always_on,
        addresses: record.addresses,
        lophn_version: record.lophn.version,
        record_at: record.updated_at,
        destinations: [destination],
      })),
  ];
  // 이름이 겹친 기계는 `이름 (id 6자)`. id의 앞쪽은 만든 시각이라 같은 날 만든 두 기계가 같다. 무작위인 끝 6자를 쓴다.
  const machines = await Promise.all(
    listed.map(async (each) => ({
      ...each,
      display_name:
        listed.filter((other) => other.name === each.name).length > 1
          ? `${each.name} (${each.id.slice(-6)})`
          : each.name,
      sections: await deps.sections.machine(each.id),
    })),
  );
  const apps = await Promise.all(
    deps.apps().map(async (app) => ({
      app: app.app,
      name: app.name,
      sync_to: app.sync_to,
      destination:
        app.sync_to === null
          ? null
          : deps.destinations.resolve(app.sync_to) === null
            ? ("not_set_here" as const)
            : ("set" as const),
      release: app.bundle_hash,
      export: deps.exportStatus(app.app),
      imports: deps.importStatus(app.app).map((row) => ({
        machine: row.machine,
        imported_at: row.imported_at,
        cursor: row.cursor,
        waiting_for: row.waiting_for,
        held: row.held,
        error: row.error,
      })),
      away: await deps.away(app.app),
      sections: await deps.sections.app(app.app),
    })),
  );
  const available = deps.available();
  return {
    this_machine: { id: me.id, name: me.name },
    machines,
    destinations: destinations.map((each) => ({
      name: each.name,
      path: each.path,
      state: each.state,
      // 그 destination에서 기록을 읽은 다른 기계 수.
      machines: records.machines.filter(
        (row) => row.machine !== me.id && row.destination === each.name,
      ).length,
    })),
    apps,
    available: available.ok ? available.value : [],
    sections: await deps.sections.top(),
  };
}
