// 폴더 교환의 조립. 내보내기·읽기·앱 기록과 take-in(core/folder)을 core에 잇고, 언제 돌지(계기)를 정한다:
// - 내보내기와 앱 기록·release·source 쓰기: 앱마다 `AppSyncChanged` 뒤 5초 debounce, 그리고 5분 timer.
// - 읽기(scan → data stream 따라잡기, source 받기): destination의 다른 기계 폴더마다 fs.watch(2초 debounce), 그리고 2분 timer.
// - 흔적 정리: 앱(release)마다 core가 뜬 뒤 처음과 하루에 한 번.
// - 기계 사이로 옮기기(`computers` 폴더): 내보내기 뒤 manifest·명단 file을 쓰고 사람의 폴더에 거울로 둔다. 다른 기계의
//   file은 받는 자리(`folderReplica`)가 route·link·거울에서 받아 그 폴더에 두고, 읽기는 그 폴더를 다른 destination처럼 읽는다.
// - mail: outbox에 줄이 생기면(`MAIL_QUEUED_TOPIC`) 옮기기가 outbox를 자기 mail 폴더에 싣는다. 읽기 scan이 다른 기계의 mail을
//   mail 입구에 넘기고, 그 기계가 받았다고 알린 이 기계의 mail을 받은 것으로 적는다.
// - handoff note: handoff wiring이 자기 notes 폴더에 file을 쓰고 `folderCarry.kick`으로 옮기기를 깨운다. 옮기기는 7일보다 옛 note와
//   지금 private인 project의 note를 지우고 manifest의 `notes` 칸에 싣는다.
// (앱, destination)·(앱, 출처)마다 한 번에 하나만 돈다. 한 앱이 표마다 다른 destination으로 보내면 내보내기는 destination마다
// 따로 돌고 따로 물러난다(한 destination이 막혀도 다른 destination은 나간다). 결과가 `more`면 바로 이어 돌고, 실패한 일은 1분부터 두 배씩 1시간까지
// 물러난다(읽기의 data stream은 import가 stream마다 따로 물러난다). 이 일들은 idle-exit를 막지 않는다.
import { createHash } from "node:crypto";
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
import { hlcAtMs, msOfHlc } from "../../../../protocol/apps/sync/clock.ts";
import {
  appSyncCustodyFile,
  appSyncCustodyPush,
  appSyncPush,
} from "../../../../protocol/apps/app-sync.ts";
import {
  DEFAULT_PERMISSION_RULES_SETTING,
  permissionRulesSettingSchema,
} from "../../../../protocol/approvals/mod.ts";
import {
  appSyncHeld,
  appSyncResume,
  appTakeIn,
  EXPORT_DEBOUNCE_MS,
  EXPORT_TIMER_MS,
  IMPORT_DEBOUNCE_MS,
  IMPORT_TIMER_MS,
  machineEnvironment,
  machineForget,
  parsePackageEntry,
  settingsExportApply,
  settingsExportDismiss,
  settingsExportSend,
  settingsExportStaged,
  takeInInputSchema,
  transfersClear,
  transfersList,
  transfersSend,
  transfersStatus,
} from "../../../../protocol/folder/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import { machineComputers } from "../../../../protocol/machine/mod.ts";
import { resolveMachine } from "../../../../protocol/machine/requester.ts";
import { appUpdateState } from "../../../../protocol/apps/update-state.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  projectCommandSchema,
  projectCommandsStore,
} from "../../../../protocol/projects/project-commands.ts";
import {
  REMOTE_PROTOCOL_MIN_VERSION,
  REMOTE_PROTOCOL_VERSION,
} from "../../../../protocol/remote/mod.ts";
import { rosterView } from "../../../../protocol/remote/roster.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { permissionRulesSetting } from "../../../approvals/permission-rules/settings.ts";
import type { SyncHeld } from "../../../apps/calls/service.ts";
import { PACKAGE_PUBLISH_CONTEXT } from "../../../apps/control.ts";
import { createFolderAppsHost } from "../../../apps/folder-host.ts";
import { registerVersionEnvelope } from "../../../apps/packages/install.ts";
import { readWholeBlob } from "../../../apps/packages/restore.ts";
import { createFollow } from "../../../apps/follow/mod.ts";
import { readUpdateState } from "../../../apps/update-state/mod.ts";
import {
  FOLDER_APPS_CONTEXT,
  loadApp,
  loadApps,
} from "../../../apps/registration/mod.ts";
import {
  loadActiveDeclaration,
  loadRelease,
  loadStoredDeclaration,
} from "../../../apps/releases/store.ts";
import {
  sendsTo,
  sentTables,
  type SyncPlan,
  type SyncPolicyOverride,
  syncPlanOf,
  type TableFilter,
} from "../../../../protocol/apps/declaration/sync-plan.ts";
import {
  heldInData,
  type SyncLog,
  type SyncLogRow,
} from "../../../apps/sync/log.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import {
  DEFAULT_CALL_POLICY,
  isPrivate,
} from "../../../../protocol/lophn-agent/call-policy.ts";
import {
  remoteAddressesSetting,
  remoteEnabledSetting,
  remoteHubSetting,
  remotePortSetting,
  remoteRelaySetting,
  syncAppPoliciesSetting,
} from "../../../config/shell-settings.ts";
import { createFolderApps } from "../../../folder/apps/mod.ts";
import { createCustodyService } from "../../../folder/custody.ts";
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
import { readComputers } from "../../../folder/computers.ts";
import { createFolderExport } from "../../../folder/export/mod.ts";
import {
  ensureStream,
  readStream,
  updateStream,
} from "../../../folder/export/status.ts";
import { peerProjects } from "../../../folder/import/peer-projects.ts";
import {
  createReceiveScheduler,
  type ReceiveOutcome as RunOutcome,
  type ReceiveScheduler,
} from "../../../folder/receive-scheduler.ts";
import {
  createFolderImport,
  latestAppRecords,
} from "../../../folder/import/mod.ts";
import { IMPORT_TMP_DIR } from "../../../folder/import/held.ts";
import {
  markEventSeen,
  readArrivedEvents,
} from "../../../folder/import/events.ts";
import { followAsksPerson } from "../../../folder/import/follow.ts";
import { createRosterFiles } from "../../../folder/import/roster.ts";
import {
  pruneEventFiles,
  writeEventFile,
} from "../../../folder/export/events.ts";
import { publishManifest } from "../../../folder/export/manifest.ts";
import { pruneHandoffNotes } from "../../../projects/handoff/write.ts";
import { writeRosterFile } from "../../../folder/export/roster.ts";
import { carryRoutes } from "../../../folder/carry-routes.ts";
import { carryStatusHandler } from "../../../folder/carry-status.ts";
import { createMirror } from "../../../folder/mirror.ts";
import {
  CARRY_STAGING_DIR,
  createReplica,
  parseManifestText,
} from "../../../folder/replica.ts";
import { createSettingsExportService } from "../../../folder/settings-export.ts";
import { createTransfersService } from "../../../folder/transfers.ts";
import {
  MAIL_FILE_AFTER_MS,
  writeMailFiles,
} from "../../../folder/export/mail.ts";
import {
  applyArrivedMail,
  type MailCarryIn,
  type MailFailures,
  readMailAcks,
  seenArrivedMail,
} from "../../../folder/import/mail.ts";
import {
  createSessionDirectory,
  workspaceDepsOf,
} from "../../../lophn-agent/workspaces/mod.ts";
import { loadProjectCommands } from "../../../projects/commands/store.ts";
import { loadProject, loadProjects } from "../../../projects/registry/mod.ts";
import { projectHoldingIdentity } from "../../../projects/registry/store.ts";
import {
  callsMailRefuse,
  callsMailSent,
  MAIL_QUEUED_TOPIC,
  mailSeen,
  pendingMails,
} from "../../../router/mod.ts";
import { bytesFileStream } from "../../../server/mod.ts";
import { withAfterCommit } from "../../../storage/ledger/mod.ts";
import type { FolderApply, FolderChange } from "../../../folder/ports.ts";
import {
  COMPUTERS_DESTINATION,
  carryStatus,
  COMPUTERS_DIR,
  manifestPath,
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

// 다른 기계가 폴더 길로 받았다고 알린 이 기계의 mail을 받은 것으로 적고, 폴더 길로 와 늘 실패하는 mail을 버리는 core 안 machine 자격.
const FOLDER_MAIL_PRINCIPAL = "machine:folder-mail";
const FOLDER_MAIL_CONTEXT: AuthenticatedContext = {
  principal: FOLDER_MAIL_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [callsMailSent.name, callsMailRefuse.name],
    targets: {},
  },
  conditions: {},
  credential_ref: FOLDER_MAIL_PRINCIPAL,
};
const FOLDER_SETTINGS_PRINCIPAL = "machine:folder-settings";
const FOLDER_SETTINGS_CONTEXT: AuthenticatedContext = {
  principal: FOLDER_SETTINGS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [projectCommandsStore.name],
    targets: {},
  },
  conditions: {},
  credential_ref: FOLDER_SETTINGS_PRINCIPAL,
};

function syncPolicySummary(plan: SyncPlan): "computers" | "local" | "mixed" {
  if (plan.destinations.size === 0) return "local";
  if (
    plan.destinations.size === 1 &&
    plan.destinations.has(COMPUTERS_DESTINATION) &&
    plan.destinations.get(COMPUTERS_DESTINATION) === null &&
    plan.localTables.size === 0
  ) {
    return "computers";
  }
  return "mixed";
}

function appSyncOverride(
  policies: Readonly<Record<string, SyncPolicyOverride>> | undefined,
  appId: string,
  slug: string,
): SyncPolicyOverride {
  return policies?.[appId] ?? policies?.[slug] ?? "default";
}
// 받았다고 알려 온 mail의 결과. 적용 결과(받은 call의 상태)는 받은 기계가 state mail로 따로 알린다.
const ACKED_BY_FOLDER = {
  kind: "acked",
  applied: { delivery: null, reason: null, session: null },
} as const;
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
  // 선언의 `sync`가 table을 보내는 destination(글자 순서)과 그리 가는 표(sent·tables가 null이면 모든 표, 옛 release).
  // 보내지 않으면 비었다.
  destinations: { name: string; sent: TableFilter; tables: string[] | null }[];
  sync_policy: "computers" | "local" | "mixed";
  sync_override: SyncPolicyOverride;
  release: {
    id: Id<"rel">;
    code_commit: string;
    data_schema: number;
    created_at: string;
  } | null;
};

export const folderWiring: WiringFactory = () => {
  let link: WriteLink | undefined;
  let stopped = false;
  let scheduler: ReceiveScheduler | undefined;
  const work = new Set<Promise<void>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
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
  // 다음 scan이 2분 timer가 깨운 것이다. 폴더 길 mail의 버리기 규칙은 이 scan의 실패만 센다(file이 올 때마다 도는 scan은 몇 초
  // 사이로 몰린다).
  let timerScan = false;
  // 받는 자리가 다른 기계의 file을 두거나 지웠고 아직 `carry_files`로 알리지 않았다. 다음 scan이 한 번 알린다.
  let filesArrived = false;
  const mailFailures: MailFailures = new Map();
  const loggedMail = new Set<string>();
  // build가 만들고 start가 건다.
  let startTriggers: (() => Promise<void>) | undefined;

  return {
    name: "folder",
    records: () => [
      FOLDER_APPS_CONTEXT,
      FOLDER_MAIL_CONTEXT,
      FOLDER_SETTINGS_CONTEXT,
    ],
    // 뒤 계획이 자기 build에서 등록할 수 있게 build 앞에 낸다.
    prepare(ctx) {
      ctx.provide("folderEnvironment", { register: sections.register });
    },
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const opened = openWriteLink({
        ledgerPath: ctx.ledgerPath,
        clock: ctx.clock,
        ids,
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
      const wait = (ms: number, fn: () => void) => {
        const timer = setTimeout(fn, ms);
        timer.unref?.();
        return () => clearTimeout(timer);
      };
      const lanes = createReceiveScheduler({
        nowMs: () => ctx.clock.nowMs(),
        wait,
        log,
        track(done) {
          work.add(done);
          void done.finally(() => work.delete(done));
        },
      });
      scheduler = lanes;

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
        filesChanged: () => {
          filesArrived = true;
          scheduleScan();
        },
      });
      ctx.provide("folderReplica", replica);
      ctx.provide("folderCarry", { kick: () => scheduleCarry() });
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
      // 폴더 길의 mail은 `computers` 폴더에서 받는 자리가 지금 key로 검증해 든 file만 읽는다.
      const mailIn = (): MailCarryIn => ({
        me: me(),
        root: computersRoot,
        holds: (machine, path) => replica.holds(machine, path),
        wanted: (machine) => replica.wantedOf(machine),
        logged: loggedMail,
        log: (message) => log("mail_file_skipped", message),
      });
      const seen = (origin: Id<"mch">, id: Id<"mal">) =>
        mailSeen(sql, origin, id);
      const rosterFiles = createRosterFiles({
        me,
        known,
        receive: (statements) =>
          ctx.peek.rosterCarry?.receive(statements) ??
          Promise.resolve(ok(undefined)),
        log: (message) => log("roster_file_skipped", message),
      });
      // 앱이 다른 기계에도 알리겠다고 낸 event를 그 앱이 표를 보내는 destination 폴더마다 event file로 쓴다(받는 기계는 같은 id를
      // 한 번만 낸다). 폴더로 맞추지 않는 앱은 둘 곳이 없다. 한 destination에 쓰지 못해도 다른 destination에는 쓴다.
      ctx.provide("crossEvents", {
        async write(app, release, event) {
          const found = syncApp(app);
          if (found === undefined) return ok(undefined);
          const stored = loadRelease(sql, release);
          if (!stored.ok) return stored;
          if (stored.value === null) {
            return err({ code: "not_found", message: "release not found" });
          }
          let first: Result<void> = ok(undefined);
          for (const { name } of found.destinations) {
            const destination = destinations.resolve(name);
            if (destination === null) continue;
            if (destination.state !== "ok") {
              if (first.ok) {
                first = err({
                  code: "unavailable",
                  message: `the sync folder "${name}" is ${destination.state}`,
                });
              }
              continue;
            }
            const written = await writeEventFile({
              me: me(),
              destination: { name, path: destination.path },
              app,
              code_commit: stored.value.code_commit,
              event,
              transaction: writeLink.transaction,
              clock: ctx.clock,
              random: ctx.random,
            });
            if (!written.ok && first.ok) first = written;
          }
          scheduleCarry();
          return first;
        },
      });

      // 연결로 온 `across_machines` event를 이 기계가 냈다고 적는다(늦은 길과 같은 표). 새 줄이면 true다.
      ctx.provide("crossSeen", (origin, app, id) =>
        writeLink.transaction((tx) =>
          ok(
            markEventSeen(tx, {
              me: me(),
              origin,
              app,
              id,
              at: formatAt(ctx.clock.nowMs()),
            }),
          ),
        ),
      );

      // 활성 release가 있는 보관하지 않은 앱. data가 가는 길은 그 release 선언과 `sync.app_policies` 덮어쓰기다(`syncPlanOf`).
      function localApps(): LocalApp[] {
        const listed = loadApps(sql, "active");
        if (!listed.ok) return [];
        const policies = ctx.settings.get(syncAppPoliciesSetting) ?? {};
        return listed.value.flatMap((app): LocalApp[] => {
          const stored = loadActiveDeclaration(sql, app.id);
          if (!stored.ok || stored.value === null) return [];
          const { release, declaration } = stored.value;
          const override = appSyncOverride(policies, app.id, app.slug);
          const plan = syncPlanOf(declaration, override);
          return [
            {
              app: app.id as Id<"app">,
              slug: app.slug,
              name: app.name,
              description: app.description,
              source_path: app.source_path ?? null,
              destinations: sendsTo(plan).map((name) => {
                const tables = plan.destinations.get(name) ?? null;
                return {
                  name,
                  sent: sentTables(plan, name),
                  tables: tables === null ? null : [...tables].sort(),
                };
              }),
              sync_policy: syncPolicySummary(plan),
              sync_override: override,
              release: {
                id: release.id as Id<"rel">,
                code_commit: release.code_commit,
                data_schema: release.data_schema,
                created_at: release.created_at,
              },
            },
          ];
        });
      }
      const syncApps = (): LocalApp[] =>
        localApps().filter((app) => app.destinations.length > 0);
      const syncApp = (app: Id<"app">) =>
        syncApps().find((each) => each.app === app);
      const namesOf = (app: LocalApp) =>
        app.destinations.map((each) => each.name);
      // source·앱 기록·`@me/*` package를 내보내고 따라가는 앱과 그것을 쓰는 destination: `private`이 아닌 활성 앱은 늘
      // `computers`(다른 컴퓨터에서 바로 들이게 한다)와 표를 보내는 destination 모두, `private`인 앱은 표를 보내는 destination만.
      const shareApps = (): (LocalApp & { writes_to: string[] })[] => {
        const policy =
          ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY;
        return localApps().flatMap((app) => {
          const sends = namesOf(app);
          const shared = !isPrivate(policy, { kind: "app", id: app.app });
          const writes = shared
            ? [...new Set([COMPUTERS_DESTINATION, ...sends])].sort()
            : sends;
          return writes.length === 0 ? [] : [{ ...app, writes_to: writes }];
        });
      };

      const dataKey = (app: Id<"app">, destination: string) => ({
        machine: me(),
        app,
        destination,
        stream: "data" as const,
      });
      // 흔적 정리가 올린 horizon. 흔적은 앱 DB에 하나라 그 앱의 모든 data stream에 같은 값을 둔다. 앱 기록에 실린다.
      function horizonOf(id: Id<"app">): string | null {
        const horizons = sql
          .all(
            `SELECT horizon FROM folder_streams
             WHERE machine = ? AND app = ? AND stream = 'data' AND horizon IS NOT NULL`,
            [me(), id],
          )
          .map((row) => BigInt(row.horizon as string));
        return horizons.length === 0
          ? null
          : horizons
              .reduce((max, each) => (each > max ? each : max))
              .toString();
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
        const hub = remote && ctx.settings.get(remoteHubSetting) === true;
        const relays = remote ? (ctx.peek.remoteRelays?.() ?? []) : [];
        return {
          hub,
          addresses: remote
            ? {
                lan: lanAddresses(),
                port: ctx.settings.get(remotePortSetting) ?? null,
                relay: ctx.settings.get(remoteRelaySetting) || null,
                relays,
              }
            : { lan: [], port: null, relay: null, relays: [] },
          alwaysOn: alwaysOn(ctx),
          projects: ctx.peek.projectMatching?.shared() ?? [],
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
            destinations: app.destinations.map(({ name, sent }) => ({
              name,
              sent,
            })),
            release: app.release,
          })),
        apply: ports.apply,
        exportState(app, destination) {
          const settled = exporter.settledOf(app, destination);
          return {
            settled: settled?.settled ?? null,
            data_head: exporter.status(app, destination)?.head ?? 0,
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
        apps: () =>
          syncApps().map((app) => ({ ...app, destinations: namesOf(app) })),
        log: ports.log,
        releaseKey(release) {
          const found = loadRelease(sql, release);
          return found.ok && found.value !== null
            ? {
                code_commit: found.value.code_commit,
                data_schema: found.value.data_schema,
              }
            : null;
        },
        sentOf(release, destination) {
          // 줄의 release 선언(봉인한 것)과 `sync.app_policies` 덮어쓰기로 그 destination으로 보내는 표를 구한다.
          const stored = loadStoredDeclaration(sql, release);
          if (!stored.ok || stored.value === null) return () => false;
          const appId = stored.value.release.app;
          const loadedApp = loadApp(sql, appId);
          const slug =
            loadedApp.ok && loadedApp.value !== null
              ? loadedApp.value.slug
              : "";
          const policies = ctx.settings.get(syncAppPoliciesSetting) ?? {};
          const override = appSyncOverride(policies, appId, slug);
          return sentTables(
            syncPlanOf(stored.value.declaration, override),
            destination,
          );
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
        async snapshotAt(app, destination, path) {
          const taken = await ports.exclusive(app, async () => {
            const seq = ports.log.head(app);
            const written = await ctx.appsControl.link.snapshot(app, {
              path,
              for: "folder",
              destination,
            });
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
        readsCaughtUp: (app, destination) =>
          importer.readsCaughtUp(app, destination),
        peerHorizons: (app, destination) =>
          importer
            .peerHorizons(app, destination)
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
      // 기계 기록의 git project 목록(architecture `project-identity`). projects가 목록이 바뀌면 기록을 다시 쓰게 하고, 다른
      // 기계의 목록은 서명을 본 `computers` 폴더의 사본에서만 읽는다(peer-projects.ts).
      ctx.provide("machineRecords", {
        publish: () => kick("records", () => publishRecords()),
        projects: () =>
          peerProjects(
            computersRoot,
            me(),
            (machine) => ctx.peek.computerSigningKey?.(machine) != null,
          ),
      });
      const apps = createFolderApps({
        machine: me,
        destinations,
        apps: () =>
          shareApps().map((app) => ({ ...app, sends_to: namesOf(app) })),
        records: () =>
          importer.records().apps.map((row) => ({
            origin: row.machine,
            destination: row.destination,
            record: row.record,
          })),
        progress(app, destination) {
          const read: Record<Id<"mch">, { n: number; at: string }> = {};
          for (const row of importer.status(app, destination)) {
            if (row.imported_at !== null) {
              read[row.machine] = { n: row.cursor, at: row.imported_at };
            }
          }
          return {
            read,
            settled: exporter.settledOf(app, destination)?.settled ?? null,
            horizon: horizonOf(app),
          };
        },
        host: createFolderAppsHost({
          sql,
          random: ctx.random,
          dataRoot,
          readBlob: (hash) =>
            readWholeBlob(
              (blob, offset, length) =>
                ctx.blobRelay.readBytes(blob, offset, length),
              hash,
            ),
          prepareBlob: (call) => ctx.blobRelay.prepare(call),
          registerVersion: async (input) => {
            const done = await ctx.writer.command(
              PACKAGE_PUBLISH_CONTEXT as never,
              (await registerVersionEnvelope(input)) as never,
            );
            return done.ok ? ok(done.value.result) : done;
          },
          prepareCommit: (input) => ctx.appsControl.prepareCommit(input),
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
          shareApps().flatMap((app) =>
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
        // 기계마다 가장 새 앱 기록 하나(`update_state`와 같다): 표를 옮긴 뒤 더는 쓰지 않는 destination에 남은 옛 기록이 옛
        // release를 내놓지 않게 한다.
        offered: (app) =>
          latestAppRecords(
            importer
              .records()
              .apps.filter(
                (row) => row.record.app === app && row.machine !== me(),
              ),
          ).flatMap((row) =>
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
                    row.record.active_release?.code_commit ===
                      stored.value!.code_commit
                      ? [{ machine: row.machine, destination: row.destination }]
                      : [],
                  );
          const ask = followAsksPerson(
            offers,
            (machine) => ctx.peek.computerGranted?.(machine) ?? false,
          );
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
      ctx.provide("folderAppStarted", (app) => appReady(app));
      importer.exchange.onChange(() => updateChanged(null));
      const followUp = (app?: Id<"app">) => {
        if (stopped) return;
        follow.sweep(app).catch((thrown) => log("follow_threw", thrown));
      };

      // --- 한 번 돌기(lane) ---
      function kick(name: string, job: () => Promise<RunOutcome>): void {
        lanes.kick(name, job);
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
        lanes.debounce(name, ms, fn);
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

      // 앱이 그 destination에서 떨어져 있기 시작한 때. 떨어져 있는 stream이 없으면 null.
      function awaySince(app: LocalApp): string | null {
        const since = app.destinations
          .map(({ name }) => exporter.settledOf(app.app, name)?.away_since)
          .filter((at): at is string => typeof at === "string")
          .sort();
        return since[0] ?? null;
      }

      async function exportStream(
        id: Id<"app">,
        destination: string,
      ): Promise<RunOutcome> {
        const app = syncApp(id);
        if (app === undefined || !namesOf(app).includes(destination)) {
          return { ok: true, more: false };
        }
        const wasAway = awaySince(app);
        const ran = await exporter.runStream(id, destination);
        if (!ran.ok) {
          log("export_failed", ran.error.message);
          return { ok: false, more: false };
        }
        await noticeAway(app, wasAway, ran.value.held);
        await cleanup(app);
        writeAppRecords(id);
        return {
          ok: ran.value.error === null,
          more: ran.value.more,
          appDown: ran.value.error?.code === "app_not_running",
        };
      }

      // 앱이 쓰는 destination마다 lane 하나: 한 destination이 없거나 쓰지 못해 물러나도 다른 destination의 앱 기록과 manifest는
      // 바로 나간다.
      function writeAppRecords(id: Id<"app">) {
        const app = shareApps().find((each) => each.app === id);
        for (const name of app?.writes_to ?? []) {
          kick(`app:${id}:${name}`, () => writeAppRecord(id, name));
        }
      }

      async function writeAppRecord(
        id: Id<"app">,
        destination: string,
      ): Promise<RunOutcome> {
        const written = await apps.runApp(id, destination);
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
        const mail = await writeMailFiles({
          me: me(),
          root: computersRoot,
          pending: pendingMails(sql),
          acks: await seenArrivedMail({ ...mailIn(), seen }),
          nowMs: ctx.clock.nowMs(),
          random: ctx.random,
          log: (message) => log("mail_file_not_written", message),
        });
        if (!mail.ok) log("mail_files_not_written", mail.error.message);
        const notes = await pruneHandoffNotes({
          me: me(),
          root: computersRoot,
          sql,
          policy: ctx.settings.get(callPolicySetting) ?? DEFAULT_CALL_POLICY,
          nowMs: ctx.clock.nowMs(),
          random: ctx.random,
        });
        if (!notes.ok) log("notes_not_pruned", notes.error.message);
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
              : app.destinations.map(({ name }) => ({
                  app: app.app,
                  destination: name,
                  code_commit: app.release!.code_commit,
                })),
          ),
          destinations,
          transaction: writeLink.transaction,
          clock: ctx.clock,
          arrived,
        });
        if (!read.ok) log("events_not_read", read.error.message);
      }

      // 다른 기계가 폴더 길로 보낸 mail을 mail 입구에 넘기고, 받았다고 알려 온 이 기계의 mail을 받은 것으로 적는다. 입구(mail)가
      // 아직 없으면 읽지 않는다. 받은 mail의 id와 지울 file은 옮기기가 맞춘다.
      async function readMail(byTimer: boolean): Promise<void> {
        const inbox = ctx.peek.mailInbox;
        if (inbox === undefined) return;
        const command = async (route: { name: string }, input: unknown) => {
          const done = await ctx.writer.command(FOLDER_MAIL_CONTEXT, {
            command: route.name,
            input,
            idempotency_key: `folder-mail-${ids.newId("key")}`,
            compare: {},
            prepared: [],
          });
          return done.ok ? ok(undefined) : done;
        };
        const applied = await applyArrivedMail({
          ...mailIn(),
          seen,
          apply: (input) => inbox.apply(input),
          // link drain이 버린 call mail과 같이 expired로 닫힌다.
          refuse({ mail, origin }) {
            const computer = ctx.peek.machineLinks
              ?.computers()
              .find((each) => each.machine === origin && !each.self);
            if (computer === undefined) {
              return Promise.resolve(
                err({
                  code: "forbidden" as const,
                  message: "mail comes only from a computer in the roster",
                }),
              );
            }
            return command(callsMailRefuse, {
              mail,
              origin: { machine: origin, computer: computer.name },
              reason: "expired",
            });
          },
          failures: mailFailures,
          byTimer,
        });
        const acked = await readMailAcks({
          ...mailIn(),
          pending: (peer) => pendingMails(sql, peer),
          acked: (mail) =>
            command(callsMailSent, { mail, result: ACKED_BY_FOLDER }),
        });
        if (applied > 0 || acked > 0) scheduleCarry();
      }

      // 다른 기계의 `packages/`에 있는 `@me/*` file 목록이 바뀌면 `dependency_missing`으로 멈춘 따라가기를 다시 본다.
      let lastPeerPackages = "";
      function peerPackagesFingerprint(): string {
        const found: string[] = [];
        for (const destination of destinations.list()) {
          if (destination.state === "missing") continue;
          const machines = join(destination.path, "machines");
          let machineDirs: string[];
          try {
            machineDirs = readdirSync(machines);
          } catch {
            continue;
          }
          for (const machine of machineDirs) {
            if (machine === me()) continue;
            let entries: string[];
            try {
              entries = readdirSync(join(machines, machine, "packages"));
            } catch {
              continue;
            }
            for (const name of entries) {
              if (parsePackageEntry(name) !== null) {
                found.push(`${destination.name}/${machine}/${name}`);
              }
            }
          }
        }
        return found.sort().join("\n");
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
        // 든 file이 바뀌었다(link·폰·거울로 온 file, 지운 앞 판). 받은 묶음마다 한 번 알린다: 화면(다른 기계의 handoff note,
        // Settings › Sync)이 다시 읽고, 연결의 상대와 폰은 이 기계가 새로 든 file을 다시 본다. manifest를 받아 들인 때는 그
        // file이 아직 오기 전이라 그 알림만으로는 화면이 새 file을 보지 못한다.
        if (filesArrived) {
          filesArrived = false;
          carryChanged();
        }
        const byTimer = timerScan;
        timerScan = false;
        // 돌기 시작할 때 가져간다: 도는 중에 destination이 바뀌면 다음 run이 새 destination을 읽은 뒤 내보낸다.
        const exportAfter = exportAfterScan;
        exportAfterScan = false;
        const scanned = await importer.scan();
        if (!scanned.ok) {
          if (exportAfter) exportAfterScan = true;
          log("scan_failed", scanned.error.message);
          return { ok: false, more: false };
        }
        // 다른 기계의 활성 release와 git project 목록이 바뀌었을 수 있다.
        if (scanned.value.updated.length > 0) {
          updateChanged(null);
          ctx.peek.projectMatching?.peersChanged();
        }
        // 새로 생긴 다른 기계·앱 폴더도 감시한다.
        rewatch();
        if (exportAfter) exportAll();
        for (const app of syncApps()) {
          kick(`import:${app.app}`, () => importApp(app.app));
        }
        for (const app of shareApps()) {
          kick(`source:${app.app}`, () => importSource(app.app));
        }
        const packagesNow = peerPackagesFingerprint();
        if (packagesNow !== lastPeerPackages) {
          lastPeerPackages = packagesNow;
          follow.retryDependencies();
        }
        followUp();
        await readEvents();
        await readMail(byTimer);
        await transfers.processIncoming();
        await transfers.processAcksAndGc();
        await custody.processIncoming();
        await custody.processAcks();
        await settingsExport.processIncoming();
        await settingsExport.processAcks();
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
      // 흔적은 앱 DB에 하나라 모든 destination의 자기 stream과 상대를 함께 본다.
      async function cleanup(app: LocalApp): Promise<void> {
        if (app.release === null) return;
        const mark = `${app.app}:${app.release.id}`;
        const last = cleaned.get(mark);
        if (last !== undefined && ctx.clock.nowMs() - last < DAY_MS) return;
        const before = cleanupBefore({
          own: app.destinations.map(
            ({ name }) => exporter.settledOf(app.app, name)?.settled ?? null,
          ),
          // 그 앱의 data를 주고받는 destination의 기록만이다. `computers`에 source와 기록만 쓰는 기계의 기록은 settled가 없다.
          peers: app.destinations.flatMap(({ name }) =>
            importer.peerHorizons(app.app, name),
          ),
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
          for (const { name } of app.destinations) {
            ensureStream(tx.sql, dataKey(app.app, name));
            tx.sql.run(
              `UPDATE folder_streams SET horizon = ? WHERE machine = ? AND app = ? AND destination = ? AND stream = 'data'`,
              [horizon, me(), app.app, name],
            );
          }
          return ok(undefined);
        });
        if (!saved.ok) log("horizon_not_saved", saved.error.message);
      }

      // horizon 밖이 되었거나 held가 늘면 사람에게 알린다. 같은 앱은 한 줄(key)이다. 돌아온 기계는 받을 것을 다 받으면 그 run에서
      // 바로 settled가 horizon을 넘어 떨어져 있음이 끝날 수 있다: 그래도 이번 run이 held로 둔 변경이 있으면 알린다(사람이 풀 일이
      // 남았다). 떨어져 있음이 끝났거나 사람이 held를 풀어 줄었으면 같은 줄을 "따라잡았다"와 남은 held 수로 바꾼다(program 행은
      // 지우지 않는다). 마지막으로 알린 수(away_notified)와 run 앞뒤의 away_since는 ledger에 있어 core가 다시 떠도 같다. 알림은
      // 앱마다 하나라 그 앱의 모든 destination stream을 합쳐 보고, 알린 수는 모든 data stream에 같이 둔다.
      async function noticeAway(
        app: LocalApp,
        wasAway: string | null,
        newlyHeld: number,
      ): Promise<void> {
        const away = awaySince(app);
        const held = ports.log.heldList(app.app).length;
        const notifiedRows = app.destinations
          .map(
            ({ name }) =>
              readStream(sql, dataKey(app.app, name))?.away_notified ?? null,
          )
          .filter((count): count is number => count !== null);
        const last =
          notifiedRows.length === 0 ? null : Math.max(...notifiedRows);
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
          for (const { name } of app.destinations) {
            updateStream(tx.sql, dataKey(app.app, name), {
              away_notified: notified,
            });
          }
          return ok(undefined);
        });
        if (!saved.ok) log("away_notice_failed", saved.error.message);
      }

      // 사람이 막힘을 풀었다(held를 풀거나 남의 writer를 보고 다시 켬): 물러남을 지우고 바로 내보낸다. 물러남은 1시간까지
      // 자라 그대로 두면 사람이 푼 뒤에도 그만큼 기다린다.
      // 그 앱이 표를 보내는 destination마다 lane 하나.
      function exportLanes(id: Id<"app">) {
        const app = syncApp(id);
        if (app === undefined) return;
        for (const name of namesOf(app)) {
          kick(`export:${id}:${name}`, () => exportStream(id, name));
        }
      }

      // 앱 process가 떴다(core를 다시 켠 뒤, 앱이 다시 뜬 뒤). 앱이 없어서 물러난 그 앱의 내보내기와 읽기를 바로 다시 한다:
      // 그대로 두면 앱이 뜨기 전의 첫 시도가 물러나 data가 몇 분 늦는다. 다른 까닭으로 물러난 것은 그대로다.
      function appReady(id: Id<"app">) {
        lanes.appReady([`export:${id}:`]);
        const cleared = importer.appReady(id);
        if (!cleared.ok) log("import_not_woken", cleared.error.message);
        if (syncApp(id) !== undefined) {
          kick(`import:${id}`, () => importApp(id));
        }
      }

      function exportNow(id: Id<"app">) {
        lanes.clear(`export:${id}:`);
        exportLanes(id);
      }

      function scheduleExport(id: Id<"app">) {
        debounce(`export:${id}`, EXPORT_DEBOUNCE_MS, () => exportLanes(id));
      }
      function scheduleScan() {
        debounce("scan", IMPORT_DEBOUNCE_MS, () => kick("scan", scan));
      }

      function exportAll() {
        kick("records", () => publishRecords());
        for (const app of shareApps()) {
          if (app.destinations.length > 0) exportLanes(app.app);
          else writeAppRecords(app.app);
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
            dirs.push(
              join(machines, machine),
              join(machines, machine, "packages"),
              join(machines, machine, "transfers"),
              join(machines, machine, "custody"),
              join(machines, machine, "staged-settings"),
              apps,
            );
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
          timerScan = true;
          kick("scan", scan);
          everyImport();
        }, IMPORT_TIMER_MS);
      }

      // --- route ---
      // 떨어져 있음이 끝나도 풀리지 않은 held 줄이 남으면 싣는다: 그동안 그 변경은 다른 기계에 가지 않고 snapshot도 막힌다.
      async function away(id: Id<"app">) {
        const app = syncApp(id);
        const since = app === undefined ? null : awaySince(app);
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
        syncApps: () =>
          syncApps().map((app) => ({ ...app, destinations: namesOf(app) })),
        follow,
        exchange: importer.exchange,
        records: () => importer.records(),
        sql,
      };

      // --- transfers, phone custody, settings_export ---
      const resolveTargetMachine = (ref: string) => {
        const linked = ctx.peek.machineLinks?.resolve(ref);
        if (linked !== undefined) {
          return linked.ok
            ? ok({
                machine: linked.value.machine as Id<"mch">,
                name: linked.value.name,
                self: linked.value.self,
              })
            : linked;
        }
        const candidates = [
          {
            device: me(),
            machine: me(),
            name: ctx.machine.status().name,
            self: true,
          },
          ...importer.records().machines.map((row) => ({
            device: row.machine,
            machine: row.machine,
            name: row.record.name,
            self: row.machine === me(),
          })),
        ];
        const resolved = resolveMachine(ref, candidates);
        return resolved.ok
          ? ok({
              machine: resolved.value.machine as Id<"mch">,
              name: resolved.value.name,
              self: resolved.value.self,
            })
          : resolved;
      };

      const onlineMachines = () => {
        const list = ctx.peek.machineLinks?.list() ?? [];
        const recordHubs = new Set(
          importer
            .records()
            .machines.filter((row) => row.record.hub === true)
            .map((row) => row.machine),
        );
        return list.map((row) => ({
          machine: row.machine,
          status: row.status,
          hub:
            (row as { hub?: boolean }).hub === true ||
            recordHubs.has(row.machine),
        }));
      };

      const phoneSigningKey = (device: Id<"dev">): string | null => {
        const statements = ctx.peek.rosterCarry?.statements();
        const selfKey = ctx.peek.computerSigningKey?.(me());
        if (!statements || !selfKey) return null;
        const view = rosterView(statements, [selfKey], selfKey);
        const found = view.devices.filter(
          (each) => each.body.kind === "phone" && each.body.id === device,
        );
        return found.length === 1 ? found[0]!.body.signing_key : null;
      };

      const transfers = createTransfersService({
        dataRoot,
        computersRoot,
        me: () => ({ id: me(), name: ctx.machine.status().name }),
        resolveMachine: resolveTargetMachine,
        onlineMachines,
        isHub: () => facts().hub,
        holds: (machine, path) => replica.holds(machine, path),
        async listedTransferFiles() {
          const listed = await replica.manifests();
          if (!listed.ok) return [];
          const out: { machine: Id<"mch">; paths: string[] }[] = [];
          for (const each of listed.value) {
            if (each.machine === me()) continue;
            const text = await replica.read(
              each.machine,
              manifestPath(each.machine),
              0,
              each.size,
            );
            const body = text.ok
              ? parseManifestText(new TextDecoder().decode(text.value))
              : null;
            const paths = (body?.transfers ?? []).map((file) => file.path);
            if (paths.length > 0) out.push({ machine: each.machine, paths });
          }
          return out;
        },
        async workspaceRoots(auth) {
          if (parseActor(auth.actor)?.kind !== "agent") return null;
          const sessionId = auth.conditions.session as Id<"ses"> | undefined;
          if (sessionId !== undefined) {
            const workspaces = workspaceDepsOf(sql);
            const found = createSessionDirectory({
              ...workspaces,
              publish: () => {},
              sql: () => sql,
            }).find(sessionId);
            if (found !== null) {
              const ws = found.agent.workspace;
              if (ws === null) {
                return [
                  join(dataRoot, "workspaces", "home"),
                  join(dataRoot, "inbox"),
                ];
              }
              if (ws.kind === "project") {
                const proj = loadProject(sql, ws.id);
                return proj.ok && proj.value !== null
                  ? proj.value.folders.map((f) => f.path)
                  : [];
              }
              if (ws.kind === "app") {
                const app = loadApp(sql, ws.id);
                return app.ok && app.value?.source_path
                  ? [app.value.source_path]
                  : [];
              }
            }
          }
          if (auth.conditions.app !== undefined) {
            const app = loadApp(sql, auth.conditions.app);
            return app.ok && app.value?.source_path
              ? [app.value.source_path]
              : [];
          }
          return [];
        },
        clock: ctx.clock,
        random: ctx.random,
        newTransferId: () => ids.newId("trf") as Id<"trf">,
        carryKick: () => scheduleCarry(),
        log,
      });

      const custody = createCustodyService({
        dataRoot,
        computersRoot,
        me,
        knownComputer: known,
        phoneSigningKey,
        deviceKind: (principal) => ctx.peek.deviceKind?.(principal) ?? null,
        deviceMachine: (principal) => {
          if (!principal.startsWith("device:")) return null;
          const dev = principal.slice("device:".length);
          const found = ctx.peek.machineLinks
            ?.computers()
            .find((c) => c.device === dev);
          return found ? (found.machine as Id<"mch">) : null;
        },
        async forwardToTarget(target, envelope) {
          const links = ctx.peek.machineLinks;
          if (links === undefined) return null;
          const isOnline = links
            .list()
            .some(
              (each) => each.machine === target && each.status === "connected",
            );
          if (!isOnline) return null;
          const targetComp = links
            .computers()
            .find((c) => c.machine === target && !c.self);
          if (targetComp === undefined) return null;
          const res = await links.call(
            targetComp.device,
            {
              resource: appSyncCustodyPush.resource,
              method: appSyncCustodyPush.method,
              body: envelope,
            },
            { kind: "screen" },
          );
          if (!res.ok) return null;
          const state = (res.value as { state?: unknown })?.state;
          return state === "held" ||
            state === "duplicate" ||
            state === "applied"
            ? ok({ state })
            : null;
        },
        async applyLocal(input) {
          const active = loadActiveDeclaration(sql, input.app);
          if (!active.ok) return active;
          if (active.value === null) {
            return err({ code: "not_found", message: "app not found" });
          }
          let releaseId = active.value.release.id as Id<"rel">;
          let changes: FolderChange[];
          try {
            const raw = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(input.payload),
            );
            const push = appSyncPush.input.safeParse(raw);
            if (push.success) {
              if (push.data.app !== input.app) {
                return err({
                  code: "invalid_input",
                  message: "custody payload app does not match envelope",
                });
              }
              releaseId = push.data.release as Id<"rel">;
              changes = push.data.changes.map((c) => ({
                id: c.id,
                hlc: c.hlc,
                operation: c.operation,
                started_at: c.started_at,
                changeset: new Uint8Array(Buffer.from(c.changeset, "base64")),
              }));
            } else {
              const parsed = raw as {
                changes?: {
                  id: string;
                  operation: string;
                  started_at: string;
                  hlc: string;
                  changeset: string;
                }[];
              };
              if (Array.isArray(parsed?.changes) && parsed.changes.length > 0) {
                changes = parsed.changes.map((c) => ({
                  id: String(c.id),
                  hlc: String(c.hlc),
                  operation: String(c.operation),
                  started_at: String(c.started_at),
                  changeset: new Uint8Array(Buffer.from(c.changeset, "base64")),
                }));
              } else {
                changes = [
                  {
                    id: input.custody,
                    hlc: hlcAtMs(Date.parse(input.written_at)).toString(),
                    operation: "custody.sync",
                    started_at: input.written_at,
                    changeset: input.payload,
                  },
                ];
              }
            }
          } catch {
            changes = [
              {
                id: input.custody,
                hlc: hlcAtMs(Date.parse(input.written_at)).toString(),
                operation: "custody.sync",
                started_at: input.written_at,
                changeset: input.payload,
              },
            ];
          }
          const applied = await ports.apply.applyChanges({
            app: input.app,
            release: releaseId,
            origin: input.origin,
            destination: COMPUTERS_DESTINATION,
            changes,
          });
          return applied.ok ? ok(undefined) : applied;
        },
        holds: (machine, path) => replica.holds(machine, path),
        clock: ctx.clock,
        random: ctx.random,
        carryKick: () => scheduleCarry(),
        log,
      });

      const resolveProjectRef = (ref: string) => {
        let projectId: string | null = null;
        if (ref.startsWith("pri_")) {
          projectId = projectHoldingIdentity(sql, ref);
        } else if (ref.startsWith("prj_")) {
          projectId = ref;
        } else {
          const all = loadProjects(sql);
          if (all.ok) {
            const match = all.value.find((p) => p.name === ref);
            if (match) projectId = match.id;
          }
        }
        if (projectId === null) return null;
        const loaded = loadProject(sql, projectId);
        if (!loaded.ok || loaded.value === null) return null;
        return {
          id: loaded.value.id as Id<"prj">,
          identity: loaded.value.identity as Id<"pri">,
          folder: loaded.value.folders[0]?.path ?? null,
        };
      };

      const settingsExport = createSettingsExportService({
        dataRoot,
        computersRoot,
        me: () => ({ id: me(), name: ctx.machine.status().name }),
        resolveMachine: resolveTargetMachine,
        onlineMachines,
        holds: (machine, path) => replica.holds(machine, path),
        resolveProject: resolveProjectRef,
        readPermissionRules: () =>
          ctx.settings.get(permissionRulesSetting) ??
          DEFAULT_PERMISSION_RULES_SETTING,
        async applyPermissionRules(value, overwrite) {
          const parsed = permissionRulesSettingSchema.safeParse(value);
          if (!parsed.success) {
            return err({
              code: "invalid_input",
              message: parsed.error.message,
            });
          }
          const current =
            ctx.settings.get(permissionRulesSetting) ??
            DEFAULT_PERMISSION_RULES_SETTING;
          const next = overwrite
            ? parsed.data
            : {
                global: [...current.global, ...parsed.data.global],
                projects: { ...current.projects, ...parsed.data.projects },
              };
          const updated = ctx.settingsUpdate([
            { key: permissionRulesSetting.key, action: "set", value: next },
          ]);
          if (!updated.ok) return updated;
          if (updated.value.rejected.length > 0) {
            return err({
              code: "invalid_input",
              message:
                updated.value.rejected[0]!.message ??
                "permission rules rejected",
            });
          }
          return ok("applied");
        },
        readProjectCommand(project, id) {
          const loaded = loadProjectCommands(sql, project);
          if (!loaded.ok) return loaded;
          const found = loaded.value.commands.find(
            (cmd) => cmd.id === id || cmd.name === id,
          );
          if (found === undefined) {
            return err({
              code: "not_found",
              message: `project command not found: ${id}`,
            });
          }
          const content = `${JSON.stringify(found, null, 2)}\n`;
          return ok({
            kind: "project_command",
            id: found.id,
            title: found.name,
            files: [
              {
                rel_path: `${found.id}.json`,
                content,
                sha256: createHash("sha256")
                  .update(content, "utf8")
                  .digest("hex"),
              },
            ],
          });
        },
        async applyProjectCommand(project, item, overwrite) {
          const primary = item.files[0];
          if (primary === undefined) {
            return err({
              code: "invalid_input",
              message: "project_command item has no file",
            });
          }
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(primary.content);
          } catch {
            return err({
              code: "invalid_input",
              message: "project_command content is not valid JSON",
            });
          }
          const parsed = projectCommandSchema.safeParse(parsedJson);
          if (!parsed.success) {
            return err({
              code: "invalid_input",
              message: parsed.error.message,
            });
          }
          const loaded = loadProjectCommands(sql, project);
          if (!loaded.ok) return loaded;
          const exists = loaded.value.commands.some(
            (c) => c.id === parsed.data.id || c.name === parsed.data.name,
          );
          if (exists && !overwrite) return ok("skipped_conflict");
          const commands = exists
            ? loaded.value.commands.map((c) =>
                c.id === parsed.data.id || c.name === parsed.data.name
                  ? parsed.data
                  : c,
              )
            : [...loaded.value.commands, parsed.data];
          const saved = await ctx.writer.command(FOLDER_SETTINGS_CONTEXT, {
            command: projectCommandsStore.name,
            input: { project, commands },
            idempotency_key: `settings-export-${ids.newId("key")}`,
            compare: {},
            prepared: [],
          });
          return saved.ok ? ok("applied") : saved;
        },
        clock: ctx.clock,
        random: ctx.random,
        newBatchId: () => ids.newId("stg") as Id<"stg">,
        carryKick: () => scheduleCarry(),
        log,
      });

      async function environment() {
        const peerHubMap = new Map(
          onlineMachines().map((m) => [m.machine, m.hub]),
        );
        return ok(
          await readEnvironment({
            machine: () => ({ id: me(), name: ctx.machine.status().name }),
            alwaysOn: () => alwaysOn(ctx),
            hub: () => facts().hub,
            machineHub: (machine) => peerHubMap.get(machine) === true,
            addresses: () => facts().addresses,
            version: () => version,
            destinations,
            apps: () =>
              localApps().map((app) => ({
                app: app.app,
                name: app.name,
                destinations: app.destinations.map(({ name, tables }) => ({
                  name,
                  tables,
                })),
                code_commit: app.release?.code_commit ?? null,
                sync_policy: app.sync_policy,
                sync_override: app.sync_override,
              })),
            exportStatus: (app, destination) =>
              exporter.status(app, destination),
            importStatus: (app, destination) =>
              importer.status(app, destination),
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

      // 명단의 link는 remote wiring이 늦게 낸다. remote가 꺼져 있으면 다른 컴퓨터가 없다.
      function computers() {
        return ok({
          computers: readComputers({
            machine: () => ({ id: me(), name: ctx.machine.status().name }),
            keepsRunning: () => alwaysOn(ctx).keep_running,
            others: () => ctx.peek.machineLinks?.list() ?? [],
            recordedKeepsRunning: (machine) =>
              importer.records().machines.find((row) => row.machine === machine)
                ?.record.always_on?.keep_running ?? null,
          }),
        });
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
                destination: row.destination,
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
        const stopped = app.destinations.filter(
          ({ name }) =>
            (readStream(sql, dataKey(app.app, name))?.error ?? null) !== null,
        );
        if (stopped.length === 0) {
          return Promise.resolve(ok({ resumed: false }));
        }
        const cleared = writeLink.transaction((tx) => {
          for (const { name } of stopped) {
            updateStream(tx.sql, dataKey(app.app, name), { error: null });
          }
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
        // 들인 앱의 source와(활성화 뒤) data를 바로 받는다. slug 입력도 풀린 `app_` id로 깨운다.
        const app = taken.value.app as Id<"app">;
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
                        change.id === remoteEnabledSetting.key ||
                        change.id === remotePortSetting.key ||
                        change.id === remoteRelaySetting.key ||
                        change.id === remoteHubSetting.key ||
                        change.id === remoteAddressesSetting.key),
                  )
                ) {
                  kick("records", () => publishRecords());
                }
                if (
                  changes.some(
                    (change) =>
                      change.name === "settings" &&
                      (change.id === null ||
                        change.id === DESTINATIONS_KEY ||
                        change.id === SHARED_FOLDER_KEY ||
                        change.id === callPolicySetting.key ||
                        change.id === syncAppPoliciesSetting.key),
                  )
                ) {
                  rewatch();
                  exportAfterScan = true;
                  kick("scan", scan);
                  scheduleCarry();
                } else if (
                  changes.some((change) => change.name === "packages")
                ) {
                  follow.retryDependencies();
                  followUp();
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
          [key(machineComputers), computers],
          [key(appSyncHeld), syncHeld],
          [key(appSyncResume), syncResume],
          [key(appUpdateState), updateState],
          [
            key(appSyncCustodyPush),
            (auth, input) => custody.push(auth, input as never),
          ],
          [
            key(transfersSend),
            (auth, input) => transfers.send(auth, input as never),
          ],
          [
            key(transfersList),
            (auth, input) => transfers.list(auth, input as never),
          ],
          [
            key(transfersStatus),
            (auth, input) => transfers.status(auth, input as never),
          ],
          [
            key(transfersClear),
            (auth, input) => transfers.clear(auth, input as never),
          ],
          [
            key(settingsExportSend),
            (auth, input) => settingsExport.send(auth, input as never),
          ],
          [
            key(settingsExportStaged),
            (auth, input) => settingsExport.staged(auth, input as never),
          ],
          [
            key(settingsExportApply),
            (auth, input) => settingsExport.apply(auth, input as never),
          ],
          [
            key(settingsExportDismiss),
            (auth, input) => settingsExport.dismiss(auth, input as never),
          ],
          ...carry.memory,
        ],
        fileStreams: [
          ...carry.fileStreams,
          [
            key(appSyncCustodyFile),
            async (auth, input) => {
              const read = await custody.readFile(auth, input as never);
              return read.ok
                ? ok(
                    bytesFileStream(
                      read.value,
                      appSyncCustodyFile.output.contentType,
                    ),
                  )
                : read;
            },
          ],
        ],
        reads: (reads) => {
          reads.set(key(machineEnvironment), environment);
          reads.set(
            key(carryStatus),
            carryStatusHandler({
              replica,
              apps: () =>
                syncApps().map((app) => ({
                  app: app.app,
                  name: app.name,
                  destinations: namesOf(app),
                })),
              shared: sharedFolder,
              importStatus: (app, destination) =>
                importer.status(app, destination),
            }),
          );
          for (const [route, handler] of carry.reads) reads.set(route, handler);
        },
        writer: (inner) => {
          // outbox에 줄이 생기면 그 mail이 file이 될 때(연결이 그 사이 닿지 않았으면) 옮긴다.
          const mailed = withAfterCommit(
            inner,
            (actions) => {
              if (
                actions.some((action) => action.topic === MAIL_QUEUED_TOPIC)
              ) {
                later(scheduleCarry, MAIL_FILE_AFTER_MS + 1000);
              }
            },
            ctx.telemetry.logger,
          );
          return {
            ...mailed,
            async command(auth, envelope) {
              if (envelope.command !== appTakeIn.name) {
                return await mailed.command(auth, envelope);
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
          };
        },
      });
    },
    async start() {
      await startTriggers?.();
      return ok(undefined);
    },
    closeIntake() {
      stopped = true;
      scheduler?.stop();
      unsubscribe?.();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
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
