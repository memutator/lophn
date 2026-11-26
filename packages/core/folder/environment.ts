// 읽기 명령 `machine.environment`의 출력을 모은다(README 계약 7). 경로 말고는 local file 내용을 싣지 않는다.
// 뒤 계획은 명령의 code를 고치지 않고 `register`로 이름 붙은 section을 채운다. section 함수 하나가 던지거나 2초를 넘으면
// 그 section만 `{ error }`다. 흔적 정리의 경계(README 계약 10)도 여기서 센다: 환경이 싣는 horizon이 그 결과다.
import type { Result } from "../../base/mod.ts";
import { hlcAtMs } from "../../protocol/apps/sync/clock.ts";
import type { UpdateState } from "../../protocol/apps/update-state.ts";
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
 * 모두가 지난 것이거나 90일보다 옛 것만 지운다는 뜻이다. 흔적은 앱 DB에 하나라서, `own`은 이 기계의 그 앱 stream마다
 * (destination마다)의 settled이고 `peers`는 모든 destination에서 읽은 알려진(사람이 지우지 않은) 다른 기계의 그 앱
 * 기록이다. 가장 느린 상대가 모든 표의 흔적을 붙든다. 자기 stream이나 알려진 기계 가운데 `settled`가 없는 것이 있으면
 * 90일 쪽만 쓴다.
 */
export function cleanupBefore(input: {
  own: readonly (string | null)[];
  peers: readonly { settled: string | null }[];
  nowMs: number;
}): bigint {
  const floor = hlcAtMs(input.nowMs - TOMBSTONE_HORIZON_MS);
  const all = [...input.own, ...input.peers.map((peer) => peer.settled)];
  if (all.length === 0 || all.some((settled) => settled === null)) return floor;
  const least = all
    .map((settled) => BigInt(settled!))
    .reduce((min, each) => (each < min ? each : min));
  return least > floor ? least : floor;
}

export type EnvironmentApp = {
  app: Id<"app">;
  name: string;
  // 선언의 `sync`가 table을 보내는 destination과 그리 가는 표(null이면 모든 표). 보내지 않으면 비었다.
  destinations: readonly { name: string; tables: string[] | null }[];
  code_commit: string | null;
  sync_policy?: "computers" | "local" | "mixed";
  sync_override?: "default" | "computers" | "local";
};

export type EnvironmentDeps = {
  machine(): { id: Id<"mch">; name: string };
  alwaysOn(): Env["machines"][number]["always_on"];
  hub?(): boolean;
  machineHub?(machine: Id<"mch">): boolean;
  addresses(): Env["machines"][number]["addresses"];
  version(): string | null;
  destinations: DestinationsView;
  /** 이 기계의 활성 release가 있는 앱. */
  apps(): EnvironmentApp[];
  exportStatus(app: Id<"app">, destination: string): ExportStatus | null;
  importStatus(app: Id<"app">, destination: string): ImportStatus[];
  away(app: Id<"app">): Promise<Env["apps"][number]["away"]>;
  /** 기계마다 폴더 꼴 판 범위. 없는 기계는 ok다. */
  exchange(): readonly {
    machine: Id<"mch">;
    exchange: Env["machines"][number]["exchange"];
  }[];
  /** `apps/update_state`와 같은 값. 폴더로 맞추지 않는 앱은 null. */
  update(
    app: Id<"app">,
  ): Pick<UpdateState, "follow" | "held" | "machines"> | null;
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
      hub: deps.hub?.() ?? false,
      addresses: deps.addresses(),
      lophn_version: deps.version(),
      record_at: null,
      destinations: destinations.map((each) => each.name),
    },
    ...records.machines
      .filter((row) => row.machine !== me.id)
      .map(({ machine, record, destinations }) => ({
        id: machine,
        name: record.name,
        always_on: record.always_on,
        hub: record.hub === true || (deps.machineHub?.(machine) ?? false),
        addresses: record.addresses,
        lophn_version: record.lophn.version,
        record_at: record.updated_at,
        destinations,
      })),
  ];
  // 이름이 겹친 기계는 `이름 (id 6자)`. id의 앞쪽은 만든 시각이라 같은 날 만든 두 기계가 같다. 무작위인 끝 6자를 쓴다.
  const exchange = new Map(
    deps.exchange().map((row) => [row.machine, row.exchange]),
  );
  const machines = await Promise.all(
    listed.map(async (each) => ({
      ...each,
      exchange: exchange.get(each.id) ?? ("ok" as const),
      display_name:
        listed.filter((other) => other.name === each.name).length > 1
          ? `${each.name} (${each.id.slice(-6)})`
          : each.name,
      sections: await deps.sections.machine(each.id),
    })),
  );
  const apps = await Promise.all(
    deps.apps().map(async (app) => {
      const update = deps.update(app.app);
      return {
        app: app.app,
        name: app.name,
        destinations: app.destinations.map(({ name, tables }) => {
          const here = deps.destinations.resolve(name) !== null;
          return {
            name,
            tables,
            state: here ? ("set" as const) : ("not_set_here" as const),
            // 이 기계에 없는 destination으로는 내보내지 않는다. log head를 밀린 줄로 보이지 않게 비운다.
            export: here ? deps.exportStatus(app.app, name) : null,
            imports: deps.importStatus(app.app, name).map((row) => ({
              machine: row.machine,
              imported_at: row.imported_at,
              cursor: row.cursor,
              waiting_for: row.waiting_for,
              held: row.held,
              owes_absent_pass: row.owes_absent_pass,
              error: row.error,
            })),
          };
        }),
        release: app.code_commit,
        ...(app.sync_policy !== undefined
          ? { sync_policy: app.sync_policy }
          : {}),
        ...(app.sync_override !== undefined
          ? { sync_override: app.sync_override }
          : {}),
        follow: update?.follow ?? null,
        held: update?.held ?? [],
        machines: update?.machines ?? [],
        away: await deps.away(app.app),
        sections: await deps.sections.app(app.app),
      };
    }),
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
        (row) => row.machine !== me.id && row.destinations.includes(each.name),
      ).length,
    })),
    apps,
    available: available.ok ? available.value : [],
    sections: await deps.sections.top(),
  };
}
