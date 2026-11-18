// 폴더 교환의 조립. 내보내기·읽기·앱 기록과 take-in(core/folder)을 core에 잇고, 언제 돌지(계기)를 정한다:
// - 내보내기와 앱 기록·release·source 쓰기: 앱마다 `AppSyncChanged` 뒤 5초 debounce, 그리고 5분 timer.
// - 읽기(scan → data stream 따라잡기, source 받기): destination의 다른 기계 폴더마다 fs.watch(2초 debounce), 그리고 2분 timer.
// - 흔적 정리: 앱(release)마다 core가 뜬 뒤 처음과 하루에 한 번.
// - 기계 사이로 옮기기(`computers` 폴더): 내보내기 뒤 manifest·명단 file을 쓰고 사람의 폴더에 거울로 둔다. 다른 기계의
//   file은 받는 자리(`folderReplica`)가 route·link·거울에서 받아 그 폴더에 두고, 읽기는 그 폴더를 다른 destination처럼 읽는다.
// (앱, destination)·(앱, 출처)마다 한 번에 하나만 돈다. 결과가 `more`면 바로 이어 돌고, 실패한 일은 1분부터 두 배씩 1시간까지
// 물러난다(읽기의 data stream은 import가 stream마다 따로 물러난다). 이 일들은 idle-exit를 막지 않는다.
import { type FSWatcher, readdirSync, watch } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import {
  createIdSource,
  err,
  errorCode,
  formatAt,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import { readChangeset } from "../../../../base/changeset-invert.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { encodePk } from "../../../../protocol/apps/sync/changeset.ts";
import { msOfHlc } from "../../../../protocol/apps/sync/clock.ts";
import {
  appSyncHeld,
  appSyncResume,
  appTakeIn,
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
  EXPORT_DEBOUNCE_MS,
  EXPORT_TIMER_MS,
  IMPORT_DEBOUNCE_MS,
  IMPORT_TIMER_MS,
  machineEnvironment,
  machineForget,
  takeInInputSchema,
} from "../../../../protocol/folder/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import { appUpdateState } from "../../../../protocol/apps/update-state.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  REMOTE_PROTOCOL_MIN_VERSION,
  REMOTE_PROTOCOL_VERSION,
} from "../../../../protocol/remote/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { SyncHeld } from "../../../apps/calls/service.ts";
import { createFolderAppsHost } from "../../../apps/folder-host.ts";
import { createFollow } from "../../../apps/follow/mod.ts";
import { readUpdateState } from "../../../apps/update-state/mod.ts";
import {
  FOLDER_APPS_CONTEXT,
  loadApps,
} from "../../../apps/registration/mod.ts";
import {
  loadActiveDeclaration,
  loadRelease,
} from "../../../apps/releases/store.ts";
import {
  heldInData,
  type SyncLog,
  type SyncLogRow,
} from "../../../apps/sync/log.ts";
import {
  remoteEnabledSetting,
  remotePortSetting,
  remoteRelaySetting,
} from "../../../config/shell-settings.ts";
import { createFolderApps } from "../../../folder/apps/mod.ts";
import {
  createDestinations,
  DESTINATIONS_KEY,
  sharedFolderPath,
} from "../../../folder/destinations.ts";
import {
  cleanupBefore,
  createFolderSections,
  type FolderEnvironment,
  readEnvironment,
} from "../../../folder/environment.ts";
import { createFolderExport } from "../../../folder/export/mod.ts";
import {
  ensureStream,
  readStream,
  updateStream,
} from "../../../folder/export/status.ts";
import { createFolderImport } from "../../../folder/import/mod.ts";
import { IMPORT_TMP_DIR } from "../../../folder/import/held.ts";
import { readArrivedEvents } from "../../../folder/import/events.ts";
import { followAsksPerson } from "../../../folder/import/follow.ts";
import { createRosterFiles } from "../../../folder/import/roster.ts";
import {
  pruneEventFiles,
  writeEventFile,
} from "../../../folder/export/events.ts";
import { publishManifest } from "../../../folder/export/manifest.ts";
import { writeRosterFile } from "../../../folder/export/roster.ts";
import { carryRoutes } from "../../../folder/carry-routes.ts";
import { carryStatusHandler } from "../../../folder/carry-status.ts";
import { createMirror } from "../../../folder/mirror.ts";
import { CARRY_STAGING_DIR, createReplica } from "../../../folder/replica.ts";
import type { FolderApply } from "../../../folder/ports.ts";
import {
  COMPUTERS_DESTINATION,
  carryStatus,
  COMPUTERS_DIR,
  SHARED_FOLDER_KEY,
} from "../../../../protocol/remote/carry.ts";
import { openWriteLink, type WriteLink } from "../../../apps/write-link.ts";
import type { WiringContext, WiringFactory } from "./context.ts";
import { lanAddresses } from "./remote.ts";

export type { FolderEnvironment };

/** apps가 낸다(`ctx.folderPorts`): 폴더 교환이 앱 DB와 sync log에 닿는 길. */
export type FolderPorts = {
  apply: FolderApply;
  held: SyncHeld;
  /** 접수가 열리기를 기다린 뒤 그 앱의 write 줄을 쥔 채 돈다. 줄이 정리되면 null. */
  exclusive<T>(app: Id<"app">, work: () => Promise<T>): Promise<T | null>;
  log: SyncLog;
};

type AlwaysOn = {
  keep_running: boolean;
  starts_at_login: boolean;
  keep_awake: boolean;
};

// 이 기계 기록과 환경의 `always_on`(always-on 계약 3): 켜 둠 표시, 로그인 때 시작이 OS에 등록됨, 깨워 둠을 실제로 쥠.
const alwaysOn = (ctx: WiringContext): AlwaysOn => {
  const status = ctx.alwaysOn.status();
  return {
    keep_running: status.keep_running,
    starts_at_login: status.start_at_login === "registered",
    keep_awake: status.keep_awake && status.awake === "held",
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
// 환경의 `away.changes`에 싣는 held 변경 수의 한도.
const AWAY_CHANGES_MAX = 100;

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

type LocalApp = {
  app: Id<"app">;
  slug: string;
  name: string;
  description: string;
  source_path: string | null;
  sync_to: string | null;
  release: {
    id: Id<"rel">;
    bundle_hash: string;
    code_commit: string;
    data_schema: number;
    data_changes: readonly Record<string, unknown>[];
    created_at: string;
  } | null;
};

type SyncApp = LocalApp & { sync_to: string };

// 한 번 돈 결과. ok가 아니면 물러난다.
type RunOutcome = { ok: boolean; more: boolean };

type Lane = {
  running: boolean;
  again: boolean;
  attempts: number;
  notBefore: number;
};

export const folderWiring: WiringFactory = () => {
  let link: WriteLink | undefined;
  let stopped = false;
  const work = new Set<Promise<void>>();
  const lanes = new Map<string, Lane>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const debounces = new Map<string, ReturnType<typeof setTimeout>>();
  const watchers = new Map<string, FSWatcher>();
  const sections = createFolderSections();
  let unsubscribe: (() => void) | undefined;
  // 시작 listener가 알려 준 제품 판. 모르면 기계 기록을 쓰지 않는다.
  let version: string | null = null;
  // 앱 release마다 마지막으로 흔적을 정리한 때(core 메모리).
  const cleaned = new Map<string, number>();
  // core 시작과 destination이 바뀐 뒤에는 scan이 다른 기계의 기록 사본(horizon)을 먼저 읽고 내보낸다: 사본 없이 내보내면
  // hold 규칙이 다른 기계의 horizon을 몰라 떨어져 있던 변경이 그대로 나간다.
  let exportAfterScan = false;
  // build가 만들고 start가 건다.
  let startTriggers: (() => Promise<void>) | undefined;

  return {
    name: "folder",
    records: () => [FOLDER_APPS_CONTEXT],
    // 뒤 계획이 자기 build에서 등록할 수 있게 build 앞에 낸다.
    prepare(ctx) {
      ctx.provide("folderEnvironment", { register: sections.register });
    },
    build(ctx) {
      const opened = openWriteLink({
        ledgerPath: ctx.ledgerPath,
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
        fields: [],
        live: () => false,
        as: FOLDER_APPS_CONTEXT,
      });
      if (!opened.ok) return opened;
      const writeLink = opened.value;
      link = writeLink;
      const { sql } = writeLink;
      const dataRoot = ctx.root.path;
      const ports = ctx.folderPorts;
      const me = () => ctx.machine.id;
      const log = (event: string, message: unknown) =>
        ctx.telemetry.logger.error({
          component: "folder",
          event,
          fields: {
            message:
              message instanceof Error ? message.message : String(message),
          },
        });

      ctx.productStartListeners.push((start) => {
        version = start.version;
        kick("records", () => publishRecords());
      });

      const destinations = createDestinations({
        dataRoot,
        settings: ctx.settings,
      });
      const sharedFolder = () =>
        sharedFolderPath({ dataRoot, settings: ctx.settings });
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });

      // --- 기계 사이로 옮기기 ---
      const computersRoot = join(dataRoot, COMPUTERS_DIR);
      const carryChanged = () =>
        publishStateChanged(ctx.bus, ctx.clock.now(), [
          { name: "carry_files", id: null },
        ]);
      // 명단(remote)은 이 wiring 뒤에 만들어진다. 부를 때 읽는다.
      const replica = createReplica({
        dataRoot,
        machine: me,
        signingKey: (machine) => ctx.peek.computerSigningKey?.(machine) ?? null,
        removed: (machine) => ctx.peek.computerRemoved?.(machine) ?? false,
        sql,
        transaction: writeLink.transaction,
        clock: ctx.clock,
        random: ctx.random,
        manifestsChanged: carryChanged,
        filesChanged: () => scheduleScan(),
      });
      ctx.provide("folderReplica", replica);
      // 명단 view에 그 기계의 하나뿐인 컴퓨터 항목이 있다.
      const known = (machine: Id<"mch">) =>
        (ctx.peek.computerSigningKey?.(machine) ?? null) !== null;
      const mirror = createMirror({
        me,
        known,
        computers: computersRoot,
        replica,
        random: ctx.random,
      });
      const rosterFiles = createRosterFiles({
        me,
        known,
        receive: (statements) =>
          ctx.peek.rosterCarry?.receive(statements) ??
          Promise.resolve(ok(undefined)),
        log: (message) => log("roster_file_skipped", message),
      });
      // 앱이 다른 기계에도 알리겠다고 낸 event를 그 앱의 `sync_to` 폴더에 event file로 쓴다. 폴더로 맞추지 않는 앱은 둘 곳이
      // 없다.
      ctx.provide("crossEvents", {
        async write(app, release, event) {
          const found = syncApp(app);
          const destination =
            found === undefined ? null : destinations.resolve(found.sync_to);
          if (found === undefined || destination === null) return ok(undefined);
          if (destination.state !== "ok") {
            return err({
              code: "unavailable",
              message: `the sync folder "${found.sync_to}" is ${destination.state}`,
            });
          }
          const stored = loadRelease(sql, release);
          if (!stored.ok) return stored;
          if (stored.value === null) {
            return err({ code: "not_found", message: "release not found" });
          }
          const written = await writeEventFile({
            me: me(),
            destination: { name: found.sync_to, path: destination.path },
            app,
            bundle_hash: stored.value.bundle_hash,
            event,
            ids,
            transaction: writeLink.transaction,
            clock: ctx.clock,
            random: ctx.random,
          });
          if (written.ok) scheduleCarry();
          return written;
        },
      });

      // 활성 release가 있는 보관하지 않은 앱. sync_to는 그 release 선언의 것이다.
      function localApps(): LocalApp[] {
        const listed = loadApps(sql, "active");
        if (!listed.ok) return [];
        return listed.value.flatMap((app): LocalApp[] => {
          const stored = loadActiveDeclaration(sql, app.id);
          if (!stored.ok || stored.value === null) return [];
          const { release, declaration } = stored.value;
          return [
            {
              app: app.id as Id<"app">,
              slug: app.slug,
              name: app.name,
              description: app.description,
              source_path: app.source_path ?? null,
              sync_to: declaration.sync_to ?? null,
              release: {
                id: release.id as Id<"rel">,
                bundle_hash: release.bundle_hash,
                code_commit: release.code_commit,
                data_schema: release.data_schema,
                data_changes: release.data_changes as readonly Record<
                  string,
                  unknown
                >[],
                created_at: release.created_at,
              },
            },
          ];
        });
      }
      const syncApps = (): SyncApp[] =>
        localApps().filter((app): app is SyncApp => app.sync_to !== null);
      const syncApp = (app: Id<"app">) =>
        syncApps().find((each) => each.app === app);

      const dataKey = (app: SyncApp) => ({
        machine: me(),
        app: app.app,
        destination: app.sync_to,
        stream: "data" as const,
      });
      // 흔적 정리가 올린 horizon. 앱 기록에 실린다.
      function horizonOf(id: Id<"app">): string | null {
        const app = syncApp(id);
        if (app === undefined) return null;
        const row = sql.get(
          `SELECT horizon FROM folder_streams WHERE machine = ? AND app = ? AND destination = ? AND stream = 'data'`,
          [me(), id, app.sync_to],
        );
        return (row?.horizon as string | null | undefined) ?? null;
      }

      // held 줄이 건드리는 row(표, 종류, 때, pk hex). 읽지 못한 줄은 빈 목록이다.
      async function heldChanges(row: SyncLogRow) {
        if (row.changeset === null || row.hlc === null) return [];
        const bytes = await ports.log.readChangeset(
          row.changeset.hash,
          row.changeset.size,
        );
        if (!bytes.ok) return [];
        const changes = readChangeset(bytes.value);
        if (!changes.ok) return [];
        const at = formatAt(msOfHlc(BigInt(row.hlc)));
        return changes.value.map((change) => ({
          table: change.table,
          op: change.op,
          at,
          pk: Buffer.from(
            encodePk((change.old ?? change.new)!, change.primaryKey),
          ).toString("hex"),
        }));
      }
      // import의 `heldRows`는 동기라 앱마다 읽기 앞에 채워 둔다.
      const heldRowCache = new Map<
        Id<"app">,
        { table: string; pk: string }[]
      >();
      async function refreshHeldRows(app: Id<"app">): Promise<void> {
        const rows = ports.log.heldList(app);
        const touched = (await Promise.all(rows.map(heldChanges))).flat();
        heldRowCache.set(
          app,
          touched.map(({ table, pk }) => ({ table, pk })),
        );
      }

      const facts = () => {
        const remote = ctx.settings.get(remoteEnabledSetting) === true;
        return {
          addresses: remote
            ? {
                lan: lanAddresses(),
                port: ctx.settings.get(remotePortSetting) ?? null,
                relay: ctx.settings.get(remoteRelaySetting) || null,
              }
            : { lan: [], port: null, relay: null },
          alwaysOn: alwaysOn(ctx),
          lophn: {
            version: version ?? "unknown",
            protocol: {
              version: REMOTE_PROTOCOL_VERSION,
              min_version: REMOTE_PROTOCOL_MIN_VERSION,
            },
          },
        };
      };

      // import와 export는 서로의 상태를 읽는다. 부를 때 읽으므로 뒤에 만든 쪽을 앞에서 가리켜도 된다.
      const importer = createFolderImport({
        machine: me,
        self: () => ({
          name: ctx.machine.status().name,
          lophn_version: version,
        }),
        destinations,
        apps: () =>
          syncApps().map((app) => ({
            app: app.app,
            sync_to: app.sync_to,
            release: app.release,
          })),
        apply: ports.apply,
        exportState(app) {
          const settled = exporter.settledOf(app);
          return {
            settled: settled?.settled ?? null,
            data_head: exporter.status(app)?.head ?? 0,
            away_since: settled?.away_since ?? null,
          };
        },
        heldRows: (app) => heldRowCache.get(app) ?? [],
        sql,
        transaction: writeLink.transaction,
        clock: ctx.clock,
        random: ctx.random,
        root: dataRoot,
      });
      const exporter = createFolderExport({
        machine: () => ({ id: me(), name: ctx.machine.status().name }),
        destinations,
        apps: () => syncApps(),
        log: ports.log,
        releaseKey(release) {
          const found = loadRelease(sql, release);
          return found.ok && found.value !== null
            ? {
                bundle_hash: found.value.bundle_hash,
                data_schema: found.value.data_schema,
              }
            : null;
        },
        operationOf(invocation) {
          const found = ctx.invocationLedger.get(invocation as Id<"inv">);
          if (!found.ok || found.value === null) return null;
          const { operation, started_at } = found.value;
          if (started_at === null) return null;
          return {
            name: "name" in operation ? operation.name : operation.kind,
            started_at,
          };
        },
        async snapshotAt(app, path) {
          const taken = await ports.exclusive(app, async () => {
            const seq = ports.log.head(app);
            const written = await ctx.appsControl.link.snapshot(app, { path });
            if (!written.ok) return written;
            if (written.value.status === "not_sync") {
              return err({
                code: "unavailable" as const,
                message: "the app has no sync data",
              });
            }
            return ok({
              seq,
              size: written.value.size,
              sha256: written.value.sha256,
            });
          });
          return (
            taken ?? err({ code: "unavailable", message: "the app stopped" })
          );
        },
        facts,
        readsCaughtUp: (app) => importer.readsCaughtUp(app),
        peerHorizons: (app) =>
          importer
            .peerHorizons(app)
            .flatMap((peer) =>
              peer.horizon === null
                ? []
                : [{ machine: peer.machine, horizon: peer.horizon }],
            ),
        sql,
        transaction: writeLink.transaction,
        clock: ctx.clock,
        random: ctx.random,
        dataRoot,
      });
      const apps = createFolderApps({
        machine: me,
        destinations,
        apps: () => syncApps(),
        records: () =>
          importer.records().apps.map((row) => ({
            origin: row.machine,
            destination: row.destination,
            record: row.record,
          })),
        progress(app) {
          const read: Record<Id<"mch">, { n: number; at: string }> = {};
          for (const row of importer.status(app)) {
            if (row.imported_at !== null) {
              read[row.machine] = { n: row.cursor, at: row.imported_at };
            }
          }
          return {
            read,
            settled: exporter.settledOf(app)?.settled ?? null,
            horizon: horizonOf(app),
          };
        },
        host: createFolderAppsHost({
          sql,
          dataRoot,
          random: ctx.random,
          command: async (envelope) => {
            const done = await ctx.writer.command(FOLDER_APPS_CONTEXT, {
              ...envelope,
              prepared: [],
            } as never);
            return done.ok ? ok(done.value.result) : done;
          },
        }),
        sql,
        clock: ctx.clock,
        random: ctx.random,
        dataRoot,
      });

      // 다른 기계가 낸 새 release 따라가기. 계기는 start, scan·source 받기 뒤, release 상태 바뀜, 동의 닫힘이다.
      const follow = createFollow({
        sql,
        apps: () =>
          syncApps().flatMap((app) =>
            app.release === null
              ? []
              : [
                  {
                    app: app.app,
                    source_path: app.source_path,
                    release: app.release,
                  },
                ],
          ),
        offered: (app) =>
          importer
            .records()
            .apps.flatMap((row) =>
              row.record.app === app &&
              row.machine !== me() &&
              row.record.active_release !== null
                ? [{ machine: row.machine, ...row.record.active_release }]
                : [],
            ),
        takeIn: (input) => apps.takeIn(input),
        // 사람에게 물을지는 그 release를 낸 기계와 길로 정한다(`import/follow.ts`).
        activate(release) {
          const stored = loadRelease(sql, release);
          const offers =
            !stored.ok || stored.value === null
              ? []
              : importer
                  .records()
                  .apps.flatMap((row) =>
                    row.record.app === stored.value!.app &&
                    row.machine !== me() &&
                    row.record.active_release?.bundle_hash ===
                      stored.value!.bundle_hash
                      ? [{ machine: row.machine, destination: row.destination }]
                      : [],
                  );
          const ask = followAsksPerson(offers);
          return (
            ctx.appsControl.activation?.activate(release, { ask }) ??
            Promise.resolve(
              err({
                code: "unavailable",
                message: "activation is unavailable",
              }),
            )
          );
        },
      });
      // App details의 Machines(`apps/update_state`)가 다시 읽는다. held·기계 범위는 앱을 가리지 않고 알린다.
      const updateChanged = (app: Id<"app"> | null) =>
        publishStateChanged(ctx.bus, ctx.clock.now(), [
          { name: "app_runtime", id: app },
        ]);
      follow.onChange((app) => updateChanged(app));
      importer.exchange.onChange(() => updateChanged(null));
      const followUp = (app?: Id<"app">) => {
        if (stopped) return;
        follow.sweep(app).catch((thrown) => log("follow_threw", thrown));
      };

      // --- 한 번 돌기(lane) ---
      function kick(name: string, job: () => Promise<RunOutcome>): void {
        if (stopped) return;
        let lane = lanes.get(name);
        if (lane === undefined) {
          lane = { running: false, again: false, attempts: 0, notBefore: 0 };
          lanes.set(name, lane);
        }
        const one = lane;
        if (one.running) {
          one.again = true;
          return;
        }
        if (ctx.clock.nowMs() < one.notBefore) return;
        one.running = true;
        const done = (async () => {
          try {
            for (;;) {
              one.again = false;
              let outcome: RunOutcome;
              try {
                outcome = await job();
              } catch (thrown) {
                log("run_threw", thrown);
                outcome = { ok: false, more: false };
              }
              if (!outcome.ok) {
                one.notBefore =
                  ctx.clock.nowMs() +
                  Math.min(
                    BACKOFF_FIRST_MS * 2 ** Math.min(one.attempts, 20),
                    BACKOFF_MAX_MS,
                  );
                one.attempts += 1;
                return;
              }
              one.attempts = 0;
              one.notBefore = 0;
              if (stopped || !(outcome.more || one.again)) return;
            }
          } finally {
            one.running = false;
          }
        })();
        work.add(done);
        void done.finally(() => work.delete(done));
      }

      function later(fn: () => void, ms: number) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          fn();
        }, ms);
        timer.unref?.();
        timers.add(timer);
      }
      function debounce(name: string, ms: number, fn: () => void) {
        const was = debounces.get(name);
        if (was !== undefined) clearTimeout(was);
        const timer = setTimeout(() => {
          debounces.delete(name);
          fn();
        }, ms);
        timer.unref?.();
        debounces.set(name, timer);
      }

      async function publishRecords(): Promise<RunOutcome> {
        if (version === null) return { ok: true, more: false };
        const published = await exporter.publishRecords();
        if (!published.ok) log("record_not_written", published.error.message);
        // 처음 쓴 기록이 `machines/`를 만든다. 그때부터 감시할 수 있다.
        rewatch();
        scheduleCarry();
        return { ok: published.ok, more: false };
      }

      async function exportApp(id: Id<"app">): Promise<RunOutcome> {
        const app = syncApp(id);
        if (app === undefined) return { ok: true, more: false };
        const wasAway = exporter.settledOf(id)?.away_since ?? null;
        const ran = await exporter.runApp(id);
        if (!ran.ok) {
          log("export_failed", ran.error.message);
          return { ok: false, more: false };
        }
        await noticeAway(app, wasAway, ran.value.held);
        await cleanup(app);
        kick(`app:${id}`, () => writeAppRecord(id));
        return { ok: ran.value.error === null, more: ran.value.more };
      }

      async function writeAppRecord(id: Id<"app">): Promise<RunOutcome> {
        const written = await apps.runApp(id);
        if (!written.ok) log("app_record_failed", written.error.message);
        // 앱 기록·release·source와 그 앞의 data file을 manifest에 싣는다.
        scheduleCarry();
        return { ok: written.ok, more: false };
      }

      // `computers` 폴더의 자기 하위 폴더: 옛 event file 지우기, 명단 file, 앱 목록과 manifest, 그리고 사람의 폴더에 거울.
      async function carryOut(): Promise<RunOutcome> {
        const pruned = await pruneEventFiles({
          me: me(),
          destinations,
          sql,
          transaction: writeLink.transaction,
          clock: ctx.clock,
          random: ctx.random,
        });
        if (!pruned.ok) log("events_not_pruned", pruned.error.message);
        const roster = await writeRosterFile({
          root: computersRoot,
          me: me(),
          statements: ctx.peek.rosterCarry?.statements() ?? null,
          clock: ctx.clock,
          random: ctx.random,
        });
        if (!roster.ok) log("roster_file_not_written", roster.error.message);
        const published = await publishManifest({
          me: me(),
          root: computersRoot,
          sql,
          transaction: writeLink.transaction,
          clock: ctx.clock,
          random: ctx.random,
          sign: (body) => ctx.peek.manifestSign?.(body) ?? null,
        });
        if (!published.ok) {
          log("manifest_not_written", published.error.message);
          return { ok: false, more: false };
        }
        if (published.value) carryChanged();
        const shared = sharedFolder();
        if (shared !== null) {
          const copied = await mirror.copyOut(shared);
          if (!copied.ok)
            log("shared_folder_not_written", copied.error.message);
        }
        return { ok: true, more: false };
      }
      function scheduleCarry() {
        kick("carry", carryOut);
      }

      // 다른 기계의 event file을 이 기계에서 한 번 낸다. 내는 쪽(apps)이 아직 없으면 읽지 않는다(본 것으로 적지 않는다).
      async function readEvents(): Promise<void> {
        const arrived = ctx.peek.eventArrived;
        if (arrived === undefined) return;
        const read = await readArrivedEvents({
          me: me(),
          apps: syncApps().flatMap((app) =>
            app.release === null
              ? []
              : [
                  {
                    app: app.app,
                    sync_to: app.sync_to,
                    bundle_hash: app.release.bundle_hash,
                  },
                ],
          ),
          destinations,
          transaction: writeLink.transaction,
          clock: ctx.clock,
          arrived,
        });
        if (!read.ok) log("events_not_read", read.error.message);
      }

      async function scan(): Promise<RunOutcome> {
        // 사람의 폴더에 있는 다른 기계의 file을 받는 자리로 들이고, 폴더의 명단 file을 명단에 넘긴다. 읽기는 그 뒤
        // `computers` 폴더를 다른 destination처럼 읽는다.
        // 들이지 못해도 읽기는 막지 않는다(다음 scan에 다시 본다).
        try {
          const shared = sharedFolder();
          if (shared !== null) {
            await mirror.takeIn(shared);
            await rosterFiles.readUnknown(shared);
          }
          await rosterFiles.readKnown(computersRoot);
        } catch (thrown) {
          log("carry_in_threw", thrown);
        }
        // 돌기 시작할 때 가져간다: 도는 중에 destination이 바뀌면 다음 run이 새 destination을 읽은 뒤 내보낸다.
        const exportAfter = exportAfterScan;
        exportAfterScan = false;
        const scanned = await importer.scan();
        if (!scanned.ok) {
          if (exportAfter) exportAfterScan = true;
          log("scan_failed", scanned.error.message);
          return { ok: false, more: false };
        }
        // 다른 기계의 활성 release가 바뀌었을 수 있다.
        if (scanned.value.updated.length > 0) updateChanged(null);
        // 새로 생긴 다른 기계·앱 폴더도 감시한다.
        rewatch();
        if (exportAfter) exportAll();
        for (const app of syncApps()) {
          kick(`import:${app.app}`, () => importApp(app.app));
          kick(`source:${app.app}`, () => importSource(app.app));
        }
        followUp();
        await readEvents();
        return { ok: true, more: false };
      }

      async function importApp(id: Id<"app">): Promise<RunOutcome> {
        await refreshHeldRows(id);
        const ran = await importer.runApp(id);
        if (!ran.ok) {
          log("import_failed", ran.error.message);
          return { ok: false, more: false };
        }
        // 받은 것이 앱 기록의 `read`와 `settled`를 바꾼다.
        if (ran.value.streams.some((each) => each.applied_files > 0)) {
          scheduleExport(id);
        }
        return {
          ok: true,
          more: ran.value.busy || ran.value.streams.some((each) => each.more),
        };
      }

      async function importSource(id: Id<"app">): Promise<RunOutcome> {
        const fetched = await apps.importSource(id);
        if (!fetched.ok) log("source_failed", fetched.error.message);
        else followUp(id);
        return { ok: fetched.ok, more: false };
      }

      // 흔적 정리(README 계약 10). 앱 release마다 core가 뜬 뒤 처음과 하루에 한 번. 앱이 떠 있지 않으면 다음 run에 다시 본다.
      async function cleanup(app: SyncApp): Promise<void> {
        if (app.release === null) return;
        const mark = `${app.app}:${app.release.id}`;
        const last = cleaned.get(mark);
        if (last !== undefined && ctx.clock.nowMs() - last < DAY_MS) return;
        const before = cleanupBefore({
          own: exporter.settledOf(app.app)?.settled ?? null,
          peers: importer.peerHorizons(app.app),
          nowMs: ctx.clock.nowMs(),
        });
        const done = await ctx.appsControl.link.syncCleanup(app.app, {
          before: before.toString(),
        });
        if (!done.ok) return;
        cleaned.set(mark, ctx.clock.nowMs());
        if (done.value.status !== "cleaned" || done.value.horizon === null) {
          return;
        }
        const horizon = done.value.horizon;
        const saved = writeLink.transaction((tx) => {
          ensureStream(tx.sql, dataKey(app));
          tx.sql.run(
            `UPDATE folder_streams SET horizon = ? WHERE machine = ? AND app = ? AND destination = ? AND stream = 'data'`,
            [horizon, me(), app.app, app.sync_to],
          );
          return ok(undefined);
        });
        if (!saved.ok) log("horizon_not_saved", saved.error.message);
      }

      // horizon 밖이 되었거나 held가 늘면 사람에게 알린다. 같은 앱은 한 줄(key)이다. 돌아온 기계는 받을 것을 다 받으면 그 run에서
      // 바로 settled가 horizon을 넘어 떨어져 있음이 끝날 수 있다: 그래도 이번 run이 held로 둔 변경이 있으면 알린다(사람이 풀 일이
      // 남았다). 떨어져 있음이 끝났거나 사람이 held를 풀어 줄었으면 같은 줄을 "따라잡았다"와 남은 held 수로 바꾼다(program 행은
      // 지우지 않는다). 마지막으로 알린 수(away_notified)와 run 앞뒤의 away_since는 ledger에 있어 core가 다시 떠도 같다.
      async function noticeAway(
        app: SyncApp,
        wasAway: string | null,
        newlyHeld: number,
      ): Promise<void> {
        const away = exporter.settledOf(app.app)?.away_since ?? null;
        const held = ports.log.heldList(app.app).length;
        const last = readStream(sql, dataKey(app))?.away_notified ?? null;
        let params: { held: number; back?: boolean };
        let notified: number | null;
        if (away !== null || newlyHeld > 0) {
          if (newlyHeld === 0 && last !== null && held <= last) return;
          notified = held;
          params = { held };
        } else {
          // 사람이 held를 풀어 줄었을 때도 같은 줄을 지금 수로 바꾼다.
          if (wasAway === null && (last === null || held >= last)) return;
          notified = held > 0 ? held : null;
          params = { held, back: true };
        }
        const recorded = await ctx.noticeRecorder({
          kind: "app_sync_away",
          app: app.app,
          key: "app_sync_away",
          params,
        });
        if (!recorded.ok) {
          log("away_notice_failed", recorded.error.message);
          return;
        }
        const saved = writeLink.transaction((tx) => {
          updateStream(tx.sql, dataKey(app), { away_notified: notified });
          return ok(undefined);
        });
        if (!saved.ok) log("away_notice_failed", saved.error.message);
      }

      // 사람이 막힘을 풀었다(held를 풀거나 남의 writer를 보고 다시 켬): 물러남을 지우고 바로 내보낸다. 물러남은 1시간까지
      // 자라 그대로 두면 사람이 푼 뒤에도 그만큼 기다린다.
      function exportNow(id: Id<"app">) {
        const lane = lanes.get(`export:${id}`);
        if (lane !== undefined) {
          lane.attempts = 0;
          lane.notBefore = 0;
        }
        kick(`export:${id}`, () => exportApp(id));
      }

      function scheduleExport(id: Id<"app">) {
        debounce(`export:${id}`, EXPORT_DEBOUNCE_MS, () =>
          kick(`export:${id}`, () => exportApp(id)),
        );
      }
      function scheduleScan() {
        debounce("scan", IMPORT_DEBOUNCE_MS, () => kick("scan", scan));
      }

      function exportAll() {
        kick("records", () => publishRecords());
        for (const app of syncApps()) {
          kick(`export:${app.app}`, () => exportApp(app.app));
        }
      }

      // 다른 기계가 쓰는 폴더를 감시한다: destination마다 `machines/`, 다른 기계의 하위 폴더, 그 `apps/`, 앱 폴더와 그 `data/`·`source/`.
      // recursive watch는 core process 안에서 event가 오지 않아(Linux, Electron Node 24) 폴더마다 따로 건다. 새 폴더는 다음
      // scan이나 timer가 다시 볼 때 더한다. 이 기계 자신의 하위 폴더는 보지 않는다.
      function watchedDirs(): string[] {
        const dirs: string[] = [];
        const children = (dir: string) => {
          try {
            return readdirSync(dir, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => entry.name);
          } catch {
            return [];
          }
        };
        for (const destination of destinations.list()) {
          if (destination.state === "missing") continue;
          const machines = join(destination.path, "machines");
          dirs.push(machines);
          for (const machine of children(machines)) {
            if (machine === me()) continue;
            const apps = join(machines, machine, "apps");
            dirs.push(join(machines, machine), apps);
            for (const app of children(apps)) {
              dirs.push(
                join(apps, app),
                join(apps, app, "data"),
                join(apps, app, "source"),
                join(apps, app, "events"),
              );
            }
          }
        }
        // 사람의 폴더는 읽기가 바로 읽지 않는다. 다른 기계의 하위 폴더가 바뀌면 scan이 받는 자리로 들인다.
        const shared = sharedFolder();
        if (shared !== null) {
          const machines = join(shared, "machines");
          dirs.push(machines);
          for (const machine of children(machines)) {
            if (machine !== me()) dirs.push(join(machines, machine));
          }
        }
        return dirs;
      }

      function rewatch() {
        const wanted = new Set(watchedDirs());
        for (const [path, watcher] of watchers) {
          if (!wanted.has(path)) {
            watcher.close();
            watchers.delete(path);
          }
        }
        for (const path of wanted) {
          if (watchers.has(path)) continue;
          try {
            const watcher = watch(path, { persistent: false }, scheduleScan);
            watcher.on("error", () => {
              watcher.close();
              watchers.delete(path);
            });
            watchers.set(path, watcher);
          } catch (thrown) {
            // 아직 없는 폴더는 다음에 다시 본다.
            if (errorCode(thrown) !== "ENOENT")
              log("watch_unavailable", thrown);
          }
        }
      }

      function everyExport() {
        later(() => {
          exportAll();
          everyExport();
        }, EXPORT_TIMER_MS);
      }
      function everyImport() {
        later(() => {
          rewatch();
          kick("scan", scan);
          everyImport();
        }, IMPORT_TIMER_MS);
      }

      // --- route ---
      // 떨어져 있음이 끝나도 풀리지 않은 held 줄이 남으면 싣는다: 그동안 그 변경은 다른 기계에 가지 않고 snapshot도 막힌다.
      async function away(id: Id<"app">) {
        const since = exporter.settledOf(id)?.away_since ?? null;
        const rows = ports.log.heldList(id);
        if (since === null && rows.length === 0) return null;
        const changes = (await Promise.all(rows.map(heldChanges)))
          .flat()
          .slice(0, AWAY_CHANGES_MAX)
          .map(({ table, op, at }) => ({ table, op, at }));
        return { since, held: rows.length, changes };
      }

      const updateDeps = {
        machine: me,
        syncApps,
        follow,
        exchange: importer.exchange,
        records: () => importer.records(),
        sql,
      };

      async function environment() {
        return ok(
          await readEnvironment({
            machine: () => ({ id: me(), name: ctx.machine.status().name }),
            alwaysOn: () => alwaysOn(ctx),
            addresses: () => facts().addresses,
            version: () => version,
            destinations,
            apps: () =>
              localApps().map((app) => ({
                app: app.app,
                name: app.name,
                sync_to: app.sync_to,
                bundle_hash: app.release?.bundle_hash ?? null,
              })),
            exportStatus: (app) => exporter.status(app),
            importStatus: (app) => importer.status(app),
            away,
            exchange: () => importer.exchange.machines(),
            update(app) {
              const read = readUpdateState(updateDeps, app);
              return read.ok ? read.value : null;
            },
            records: () => importer.records(),
            available: () => apps.available(),
            sections,
          }),
        );
      }

      function updateState(
        auth: AuthenticatedContext,
        input: unknown,
      ): Promise<Result<unknown>> {
        const { app } = input as { app: Id<"app"> };
        // 앱 workspace의 agent는 자기 앱만 본다.
        if (auth.conditions.app !== undefined && auth.conditions.app !== app) {
          return Promise.resolve(
            err({ code: "not_found", message: "app not found" }),
          );
        }
        return Promise.resolve(readUpdateState(updateDeps, app));
      }

      function forgetMachine(
        _auth: AuthenticatedContext,
        input: unknown,
      ): Promise<Result<unknown>> {
        const { machine } = input as { machine: Id<"mch"> };
        if (machine === me()) {
          return Promise.resolve(
            err({
              code: "invalid_input",
              message: "this is this machine; it cannot forget itself",
            }),
          );
        }
        const forgotten = importer.forgetMachine(machine);
        if (!forgotten.ok) return Promise.resolve(forgotten);
        exportAll();
        return Promise.resolve(ok({ machine }));
      }

      async function syncHeld(
        auth: AuthenticatedContext,
        input: unknown,
      ): Promise<Result<unknown>> {
        const { app, action, seq, tool_call } = input as {
          app: Id<"app">;
          action: "list" | "apply" | "discard";
          seq?: number;
          tool_call?: string;
        };
        // 앱 workspace의 agent는 자기 앱만 본다.
        if (auth.conditions.app !== undefined && auth.conditions.app !== app) {
          return err({ code: "not_found", message: "app not found" });
        }
        if (action === "list") {
          const rows = ports.held.list(app);
          if (!rows.ok) return rows;
          return ok({
            held: await Promise.all(
              rows.value.map(async (row) => ({
                seq: row.seq,
                origin: row.origin,
                machine: row.machine,
                device: row.device,
                hlc: row.hlc,
                made_here: heldInData(row),
                changes: (await heldChanges(row)).map(({ table, op, at }) => ({
                  table,
                  op,
                  at,
                })),
              })),
            ),
          });
        }
        if (seq === undefined) {
          return err({ code: "invalid_input", message: `${action} needs seq` });
        }
        if (action === "discard") {
          const discarded = ports.held.discard(app, seq);
          if (!discarded.ok) return discarded;
          // 알림의 held 수와 snapshot을 막던 held가 바뀌었다.
          exportNow(app);
          return ok({ note: discarded.value.note });
        }
        const actor = parseActor(auth.actor);
        let caller;
        if (actor?.kind === "agent") {
          const { session, turn } = auth.conditions;
          if (session === undefined || turn === undefined || !tool_call) {
            return err({
              code: "invalid_input",
              message: "an agent applies a held change from a tool call",
            });
          }
          caller = { kind: "agent", session, turn, tool_call } as const;
        } else {
          caller = { kind: "person", view_session: `held:${seq}` } as const;
        }
        const applied = await ports.held.apply(app, seq, caller as never);
        if (!applied.ok) return applied;
        exportNow(app);
        return ok({ invocation: applied.value.invocation });
      }

      function syncResume(
        _auth: AuthenticatedContext,
        input: unknown,
      ): Promise<Result<unknown>> {
        const app = syncApp((input as { app: Id<"app"> }).app);
        if (app === undefined) return Promise.resolve(ok({ resumed: false }));
        const stopped = readStream(sql, dataKey(app))?.error ?? null;
        if (stopped === null) return Promise.resolve(ok({ resumed: false }));
        const cleared = writeLink.transaction((tx) => {
          updateStream(tx.sql, dataKey(app), { error: null });
          return ok(undefined);
        });
        if (!cleared.ok) return Promise.resolve(cleared);
        exportNow(app.app);
        return Promise.resolve(ok({ resumed: true }));
      }

      // `app.take_in`은 ledger handler가 없다. 폴더를 읽고 앱·release를 core command로 들이는 일이라 writer 앞에서 한다.
      async function takeIn(input: unknown): Promise<Result<unknown>> {
        const parsed = takeInInputSchema.safeParse(input);
        if (!parsed.success) {
          return err({ code: "invalid_input", message: parsed.error.message });
        }
        const taken = await apps.takeIn(parsed.data);
        if (!taken.ok) return taken;
        // 들인 앱의 source와(활성화 뒤) data를 바로 받는다.
        const app = parsed.data.app as Id<"app">;
        kick(`source:${app}`, () => importSource(app));
        return ok(taken.value);
      }

      // --- 계기 ---
      startTriggers = async () => {
        await rm(join(dataRoot, IMPORT_TMP_DIR), {
          recursive: true,
          force: true,
        });
        // 받다 만 file. 다시 받으면 처음부터다.
        await rm(join(dataRoot, CARRY_STAGING_DIR), {
          recursive: true,
          force: true,
        });
        await replica.recheck();
        unsubscribe = ctx.bus.subscribe(
          [
            {
              types: [
                "AppSyncChanged",
                "AppRemoved",
                "StateChanged",
                "ActivationConsentClosed",
              ],
            },
          ],
          {
            send(event) {
              if (event.type === "AppSyncChanged") {
                scheduleExport(event.subject as Id<"app">);
              } else if (event.type === "AppRemoved") {
                void forget(event.subject as Id<"app">);
              } else if (event.type === "ActivationConsentClosed") {
                const closed = event.payload as {
                  app: Id<"app">;
                  release: string;
                  outcome: "allow" | "reject" | "cancelled";
                };
                follow.consentClosed(
                  closed.app,
                  closed.release,
                  closed.outcome,
                );
                followUp(closed.app);
              } else {
                const changes = (
                  event.payload as {
                    changes: { name: string; id: string | null }[];
                  }
                ).changes;
                // 명단이 바뀌었다: 든 manifest를 지금 key로 다시 보고, 명단 file을 다시 쓴다.
                if (
                  changes.some((change) => change.name === "remote_devices")
                ) {
                  replica
                    .recheck()
                    .catch((thrown) => log("replica_recheck_threw", thrown));
                  scheduleCarry();
                }
                if (
                  changes.some(
                    (change) =>
                      change.name === "settings" &&
                      (change.id === null ||
                        change.id === DESTINATIONS_KEY ||
                        change.id === SHARED_FOLDER_KEY),
                  )
                ) {
                  rewatch();
                  exportAfterScan = true;
                  kick("scan", scan);
                  scheduleCarry();
                } else if (
                  changes.some((change) => change.name === "releases")
                ) {
                  for (const change of changes) {
                    if (change.name === "releases" && change.id !== null) {
                      followUp(change.id as Id<"app">);
                    }
                  }
                  // 활성 release가 바뀌었다(activation, take-in): 첫 snapshot과 앱 기록을 쓰고 읽기를 다시 맞춘다.
                  debounce("releases", EXPORT_DEBOUNCE_MS, () => {
                    exportAll();
                    kick("scan", scan);
                  });
                }
              }
            },
            close: () => undefined,
          },
        );
        rewatch();
        exportAfterScan = true;
        kick("scan", scan);
        scheduleCarry();
        everyExport();
        everyImport();
        // apps의 start(supervisor 붙이기)가 이 wiring보다 앞이다.
        followUp();
      };

      // 앱을 지울 때. local 상태와 held 사본만 지우고 폴더의 file은 그대로 둔다.
      async function forget(app: Id<"app">): Promise<void> {
        heldRowCache.delete(app);
        const exported = exporter.forget(app);
        if (!exported.ok) log("forget_failed", exported.error.message);
        const imported = await importer.forget(app);
        if (!imported.ok) log("forget_failed", imported.error.message);
      }

      const carry = carryRoutes({
        me,
        known,
        replica,
        clock: ctx.clock,
      });
      return ok({
        memory: [
          [key(machineForget), forgetMachine],
          [key(appSyncHeld), syncHeld],
          [key(appSyncResume), syncResume],
          [key(appUpdateState), updateState],
          ...carry.memory,
        ],
        fileStreams: carry.fileStreams,
        reads: (reads) => {
          reads.set(key(machineEnvironment), environment);
          reads.set(
            key(carryStatus),
            carryStatusHandler({
              replica,
              apps: syncApps,
              shared: sharedFolder,
              importStatus: (app) => importer.status(app),
            }),
          );
          for (const [route, handler] of carry.reads) reads.set(route, handler);
        },
        writer: (inner) => ({
          ...inner,
          async command(auth, envelope) {
            if (envelope.command !== appTakeIn.name) {
              return await inner.command(auth, envelope);
            }
            const taken = await takeIn(envelope.input);
            if (!taken.ok) return taken;
            return ok({
              result: taken.value,
              replayed: false,
              first_seq: null,
              last_seq: null,
            });
          },
        }),
      });
    },
    async start() {
      await startTriggers?.();
      return ok(undefined);
    },
    closeIntake() {
      stopped = true;
      unsubscribe?.();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const timer of debounces.values()) clearTimeout(timer);
      debounces.clear();
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
    async closeWork() {
      await Promise.allSettled([...work]);
      link?.close();
      link = undefined;
    },
  };
};
