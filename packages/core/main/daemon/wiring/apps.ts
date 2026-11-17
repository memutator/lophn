import {
  canonicalize,
  createIdSource,
  err,
  ok,
  type Result,
} from "../../../../base/mod.ts";
import type { PermissionScope } from "../../../../protocol/apps/declaration/mod.ts";
import { publishStateChanged } from "../../../../protocol/events/changes.ts";
import {
  type AppGrant,
  appGrantsList,
  GRANT_LIST_MAX_COUNT,
} from "../../../../protocol/apps/grants.ts";
import {
  appConnectSource,
  appCreate,
  appLogViewError,
  declarationCheck,
  packagePublish,
  packagesBuiltin,
  packagesGuideBody,
} from "../../../../protocol/apps/mod.ts";
import { appSdkReviewRecord } from "../../../../protocol/apps/sdk-status.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { ToolCallOutput } from "../../../../protocol/apps/mod.ts";
import type { At } from "../../../../protocol/base/values.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import type {
  BlobReadInput,
  PreparedBlob,
} from "../../../../protocol/storage/mod.ts";
import { createAppCalls } from "../../../apps/calls/mod.ts";
import { agentAssignment } from "../../../apps/usage/users.ts";
import {
  APPS_CONTROL_CONTEXT,
  APPS_CONTROL_PRINCIPAL,
  APPS_SUPERVISOR_KIND,
  appCredentialIssuer,
  appSupervisorSpec,
  appsOperationPolicies,
  createAppsControl,
  PACKAGE_PUBLISH_CONTEXT,
  SUPERVISOR_CREDENTIAL_OPERATIONS,
  withReleasePreparation,
} from "../../../apps/control.ts";
import { checkDeclaration } from "../../../apps/declaration/check.ts";
import {
  type ChangesetBlobs,
  closeUnfinishedInvocations,
  createInvocationLedger,
  INVOCATION_BLOB_PURPOSES,
  observeInvocations,
} from "../../../apps/invocations/mod.ts";
import {
  type AppOAuth,
  type AppOAuthDeclared,
  createAppOAuth,
} from "../../../apps/oauth/mod.ts";
import {
  PACKAGE_GUIDE_BLOB_FIELD_NAME,
  PACKAGE_GUIDE_BLOB_OWNER_KIND,
  packageGuideOwnerKey,
} from "../../../apps/packages/blobs.ts";
import { readBuiltinSdk } from "../../../apps/packages/mod.ts";
import { registerVersionEnvelope } from "../../../apps/packages/install.ts";
import { publishPackage } from "../../../apps/packages/publish.ts";
import {
  effectiveScope,
  loadGrants,
  secretValueHandler,
} from "../../../apps/permissions/mod.ts";
import type {
  AppViewSignal,
  BundleLocator,
  CallerDirectory,
  InvocationLedger,
} from "../../../apps/ports.ts";
import {
  loadApp,
  loadAppIcon,
  loadApps,
  SOURCE_FOLDER_CONTEXT,
  withSourceFolder,
} from "../../../apps/registration/mod.ts";
import { ACTIVATION_CONSENT_TOPIC } from "../../../apps/releases/activation/consents.ts";
import { createCopyPreviewBundles } from "../../../apps/releases/activation/desired.ts";
import { observeReleaseActivations } from "../../../apps/releases/activation/recovery.ts";
import { startPhoneChangedWatch } from "../../../apps/phone/changed.ts";
import { releaseFacts } from "../../../apps/releases/mod.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import {
  closeInterruptedRewinds,
  createAppRewind,
  createRewindReads,
} from "../../../apps/rewind/mod.ts";
import {
  appIconRead,
  appSdkStatusRead,
  appSkillsRead,
  appStatesOf,
  appToolLookupOf,
  bundleLocatorOf,
  callToolHandler,
  iconPathOf,
  mainRead,
  phoneScreensRead,
  rewindHandler,
  screenFileStream,
  withStartInvocation,
} from "../../../apps/routes.ts";
import { phoneFileStream } from "../../../apps/phone/files.ts";
import { NOTICE_TOPIC } from "../../../apps/notices/mod.ts";
import {
  readSdkStatus,
  recordSdkUpdates,
  SDK_REVIEW_CONTEXT,
  sdkDecideHandler,
  withSdkDecide,
} from "../../../apps/sdk-status/mod.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-workspaces/skills/root.ts";
import {
  createEventDelivery,
  createEventPublisher,
} from "../../../apps/events/mod.ts";
import { createTray } from "../../../apps/tray/mod.ts";
import { createWidgets } from "../../../apps/widgets/mod.ts";
import { phoneRequestHandler } from "../../../apps/phone-request/mod.ts";
import { appPhoneRequest } from "../../../../protocol/apps/phone-request.ts";
import {
  type AppViews,
  appViewHandlers,
  createAppViews,
} from "../../../apps/views/mod.ts";
import { appEventPublish } from "../../../../protocol/apps/events.ts";
import { appRecordPreview } from "../../../../protocol/apps/previews.ts";
import { appTrayList, appTraySet } from "../../../../protocol/apps/tray.ts";
import {
  appWidgetsList,
  appWidgetSet,
} from "../../../../protocol/apps/widget.ts";
import { APP_RESTART_HALTED_TOPIC } from "../../../apps/runtime/commands.ts";
import {
  appLogWriter,
  viewErrorLogHandler,
} from "../../../apps/runtime/view-errors.ts";
import { createScreenFileDeps } from "../../../apps/screens/mod.ts";
import { createAppSkillsDeps } from "../../../apps/screens/skills.ts";
import { openWriteLink, type WriteLink } from "../../../apps/write-link.ts";
import { createSyncLog, type SyncLog } from "../../../apps/sync/log.ts";
import {
  appSyncRoutes,
  phoneAppOf,
  syncAppOf,
} from "../../../apps/sync/routes.ts";
import { createAppSync } from "../../../apps/sync/service.ts";
import {
  createSnapshots,
  type Snapshots,
} from "../../../apps/sync/snapshots.ts";
import { CRASH_LOCATIONS } from "../../../diagnostics/mod.ts";
import { openCallbackListener } from "../../../lophn-agent/extensions/mcp-auth-control.ts";
import { createCallerDirectory } from "../../../lophn-agent/session/caller-directory.ts";
import {
  authorize,
  CONDITION_TARGET_KEYS,
} from "../../../server/identity/mod.ts";
import {
  openConnection,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import { blobReadHandler } from "../runtime.ts";
import {
  type AppsControl,
  createProductRedactor,
  type WiringContext,
  type WiringFactory,
} from "./context.ts";

export const appsWiring: WiringFactory = () => {
  let control: AppsControl | undefined;
  let write: WriteLink | undefined;
  let invocations: InvocationLedger | undefined;
  let oauth: AppOAuth | undefined;
  let views: AppViews | undefined;
  let unsubscribeViews: (() => void) | undefined;
  let unsubscribePhoneChanged: (() => void) | undefined;
  let syncLog: SyncLog | undefined;
  let snapshots: Snapshots | undefined;
  return {
    name: "apps",
    restartOwners: [observeInvocations, observeReleaseActivations],
    // apps 관측 기록·자식 앱 credential이 닿는 operation.
    operations: () => [
      ...appsOperationPolicies(),
      // 새 앱의 source를 잇는 core 안 machine 자격(registration/source-folder.ts).
      { name: appConnectSource.name, actors: ["machine"], kind: "command" },
      // 다른 기계의 앱을 같은 id로 들이는 폴더 take-in 자격(apps/registration/folder-take-in.ts). handler가 그 자격만 받는다.
      { name: appCreate.name, actors: ["machine"], kind: "command" },
      // SDK 결정을 기록하고 handoff call을 낸다(apps/sdk-status/decide.ts).
      { name: appSdkReviewRecord.name, actors: ["machine"], kind: "command" },
    ],
    // apps 제어(runtime·logs 덮기, activation)가 ledger 사실을 읽고 기록하는 core 내부 자격 기록.
    records: () => [
      APPS_CONTROL_CONTEXT,
      PACKAGE_PUBLISH_CONTEXT,
      SOURCE_FOLDER_CONTEXT,
      SDK_REVIEW_CONTEXT,
    ],
    build(ctx) {
      const { runtime } = ctx;
      const redactLine = createProductRedactor(ctx.knownSecrets);
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const appOAuth = createAppOAuth({
        secrets: ctx.secretStore,
        // issuerRequests는 lophn-agent-provider-login wiring이 이 wiring 뒤에 만든다. 부를 때 읽는다.
        fetch: (url, init) => ctx.issuerRequests.fetch(url, init),
        openListener: openCallbackListener,
        declared: (app) => Promise.resolve(declaredOAuth(ctx, app)),
        nowMs: () => ctx.clock.nowMs(),
        random: ctx.random,
        changed: (name) =>
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "secrets", id: name },
          ]),
      });
      oauth = appOAuth;
      const machine = () => {
        const current = runtime.current(APPS_CONTROL_PRINCIPAL);
        return current.ok ? current.value : undefined;
      };
      // 앱 slug. link가 열린 뒤에 읽는다(선언 검사).
      const slugOf = (app: string): Promise<Result<string>> => {
        if (write === undefined) {
          return Promise.resolve(
            err({ code: "unavailable", message: "ledger is not open" }),
          );
        }
        try {
          const found = loadApp(write.sql, app);
          if (!found.ok) return Promise.resolve(found);
          return Promise.resolve(
            found.value === null
              ? err({ code: "not_found", message: "app not found" })
              : ok(found.value.slug),
          );
        } catch {
          return Promise.resolve(
            err({ code: "unavailable", message: "app cannot be read" }),
          );
        }
      };
      const appsControl = createAppsControl({
        clock: ctx.clock,
        ledgerPath: ctx.ledgerPath,
        readers: runtime.readers,
        redact: (line) =>
          redactLine(
            { concern: "apps/runtime", revision: "1", scope: "app-log" },
            "text/plain",
            line,
          ),
        // 봉인 bundle 사본을 여는 실제 자리다.
        activation: {
          dataRoot: ctx.root.path,
          command: (context, envelope) =>
            ctx.writer.command(context as never, envelope as never),
          machine,
          prepareBlob: (call) => ctx.blobRelay.prepare(call),
        },
        previews: {
          dataRoot: ctx.root.path,
          bundles: createCopyPreviewBundles({
            dataRoot: ctx.root.path,
          }),
          changed: (app) =>
            publishStateChanged(ctx.bus, ctx.clock.now(), [
              { name: "app_runtime", id: app },
            ]),
        },
      });
      control = appsControl;
      ctx.provide("appsControl", appsControl);

      // invocation·rewind 기록은 메인 스레드의 짧은 ledger 연결로 쓴다(apps/write-link.ts).
      const opened = openWriteLink({
        ledgerPath: ctx.ledgerPath,
        clock: ctx.clock,
        ids,
        fields: ctx.assembled.blobFields,
        live: (prepared, nowMs) => ctx.blobRelay.live(prepared, nowMs),
        as: APPS_CONTROL_CONTEXT,
      });
      if (!opened.ok) return opened;
      const link = opened.value;
      write = link;
      const changesetPurpose = INVOCATION_BLOB_PURPOSES[0].purpose;
      const blobs: ChangesetBlobs = {
        async prepare(bytes) {
          const prepared = await ctx.blobRelay.prepare({
            principal: APPS_CONTROL_PRINCIPAL,
            purpose: changesetPurpose,
            bytes,
          });
          return prepared.ok ? ok(prepared.value as PreparedBlob) : prepared;
        },
        read: (hash, offset, length) =>
          ctx.blobRead.deps.read(hash, offset, length),
      };
      const ledger = createInvocationLedger({
        sql: link.sql,
        transaction: link.transaction,
        blobs,
        changed: (app) =>
          publishStateChanged(ctx.bus, ctx.clock.now(), [
            { name: "app_activity", id: app },
          ]),
      });
      invocations = ledger;

      const callers: CallerDirectory = createCallerDirectory(link.sql);
      ctx.provide("callerDirectory", callers);
      const states = appStatesOf(link.sql);
      // sync 앱(runs_on에 phone이나 sync_to)의 sync log. 컴퓨터의 write·rewind·폰과 다른 기계의 변경이 순서대로 남고 폰이 pull한다.
      const isSync = syncAppOf(link.sql);
      const runsOnPhone = phoneAppOf(link.sql);
      const sync = createSyncLog({
        sql: link.sql,
        transaction: link.transaction,
        blobs,
        ledger,
        activeRelease: states.activeRelease,
        isSync,
        now: () => ctx.clock.now(),
        changed: (app, release, seq) =>
          ctx.peek.bus?.publish({
            type: "AppSyncChanged",
            subject: app as Id<"app">,
            at: ctx.clock.now(),
            payload: { release: release as Id<"rel">, seq },
          }),
      });
      syncLog = sync;
      const { path, intake, phone, folder, syncHeld } = createAppCalls({
        callers,
        lookup: appToolLookupOf(link.sql, appsControl.previews),
        apps: states,
        ledger,
        link: appsControl.link,
        assignmentOf: (agent) => agentAssignment(link.sql, agent),
        async appGrantsOf(app) {
          const listed = await ctx.runtime.readers.read(
            appGrantsList,
            APPS_CONTROL_CONTEXT,
            { app, status: "active", limit: GRANT_LIST_MAX_COUNT },
          );
          if (!listed.ok) return listed;
          return ok((listed.value as { grants: AppGrant[] }).grants);
        },
        clock: ctx.clock,
        ids,
        sync,
      });
      ctx.provide("appCallPath", path);
      ctx.provide("folderPorts", {
        apply: folder,
        held: syncHeld,
        exclusive: phone.exclusive,
        log: sync,
      });
      // 앱 화면의 view 표(`app_views/*`). 메모리에만 있다. 앱 event와 다시 묶음은 `AppViewEvent`로 owner의 Gateway에 간다.
      views = createAppViews({
        // remote wiring이 뒤에 채우는 `deviceKind`는 부를 때 읽는다.
        deviceKind: (owner) => ctx.deviceKind(owner),
        appStatus(app) {
          const loaded = loadApp(link.sql, app);
          if (!loaded.ok) return loaded;
          if (loaded.value === null) return ok(null);
          return ok(loaded.value.status === "archived" ? "archived" : "active");
        },
        async live(app) {
          const observed = await appsControl.client.observe(app);
          if (!observed.ok) return observed;
          const value = observed.value;
          return ok(
            value !== null &&
              value.mode === "live" &&
              value.ready &&
              value.release !== null &&
              value.process_nonce !== ""
              ? {
                  release: value.release as Id<"rel">,
                  process_nonce: value.process_nonce,
                }
              : null,
          );
        },
        preview: (app) => readyPreview(appsControl, app),
        release(app, release) {
          const loaded = loadActiveDeclaration(link.sql, app, release);
          if (!loaded.ok) return loaded;
          if (loaded.value === null) return ok(null);
          return ok({
            bundle_hash: loaded.value.release.bundle_hash,
            screens: loaded.value.declaration.screens,
            subscriptions: loaded.value.declaration.subscriptions ?? [],
          });
        },
        lookup: appToolLookupOf(link.sql, appsControl.previews),
        path,
        log: appLogWriter({
          request: (op, payload) => appsControl.channel.request(op, payload),
        }),
        publish(app, payload) {
          ctx.peek.bus?.publish({
            type: "AppViewEvent",
            subject: app,
            at: ctx.clock.now(),
            payload,
          } as BusEvent);
        },
      });
      ctx.provide("appViews", views);
      const snapshotStore = createSnapshots({
        dataRoot: ctx.root.path,
        log: sync,
        exclusive: phone.exclusive,
        link: appsControl.link,
        activeRelease: states.activeRelease,
        runsOnPhone,
        clock: ctx.clock,
        ids,
      });
      snapshots = snapshotStore;
      const syncRoutes = appSyncRoutes(
        createAppSync({
          log: sync,
          phone,
          activeRelease: states.activeRelease,
          runsOnPhone,
        }),
        snapshotStore,
      );
      // 앱 rewind가 끝나면 열린 앱 view가 다시 그리게 알린다. 칸이 비어 있으면 Bus로 낸다.
      const signal: AppViewSignal = {
        changed(app, reason) {
          const given = ctx.peek.appViewSignal;
          if (given !== undefined) return given.changed(app, reason);
          ctx.peek.bus?.publish({
            type: "AppViewChanged",
            subject: app,
            at: ctx.clock.now(),
            payload: { reason },
          });
        },
      };
      const rewind = createAppRewind({
        ledger,
        link: appsControl.link,
        intake,
        signal,
        sql: link.sql,
        activeRelease: states.activeRelease,
        now: () => ctx.clock.now() as At,
        newId: () => ids.newId("rwd") as Id<"rwd">,
        sync,
      });
      const rewindReads = createRewindReads({ rewind });
      // tray 값은 메모리에만 있다. 바뀐 것은 `app_tray.set`의 `changes`가 알린다.
      const tray = createTray({
        clock: ctx.clock,
        appStatus(app) {
          const loaded = loadApp(link.sql, app);
          return loaded.ok && loaded.value !== null
            ? loaded.value.status
            : null;
        },
      });
      // 위젯 값도 메모리에만 있다. 목록은 active release가 선언한 위젯이 정한다.
      const widgets = createWidgets({
        clock: ctx.clock,
        appStatus(app) {
          const loaded = loadApp(link.sql, app);
          return loaded.ok && loaded.value !== null
            ? loaded.value.status
            : null;
        },
        declaredWidgets(app) {
          const loaded = loadApp(link.sql, app);
          if (!loaded.ok) return loaded;
          const stored = loadActiveDeclaration(link.sql, app);
          if (!stored.ok) return stored;
          return ok(
            loaded.value === null || stored.value === null
              ? null
              : {
                  name: loaded.value.name,
                  widgets: stored.value.declaration.widgets ?? [],
                },
          );
        },
        appsWithWidgets() {
          const apps = loadApps(link.sql, "active");
          if (!apps.ok) return apps;
          const found = [];
          for (const app of apps.value) {
            const stored = loadActiveDeclaration(link.sql, app.id);
            if (!stored.ok) return stored;
            if (stored.value !== null) {
              found.push({
                app: app.id,
                name: app.name,
                widgets: stored.value.declaration.widgets ?? [],
              });
            }
          }
          return ok(found);
        },
      });
      // 앱 event: 전달(구독 앱의 handler를 앱 호출 경로로 부른다)과 앱의 발행. 발행 기록은 invocation과 같이 짧은 연결로 쓴다.
      const eventDelivery = createEventDelivery({
        clock: ctx.clock,
        ids,
        random: ctx.random,
        activeTraceId: () => ctx.telemetry.tracer.context.active()?.traceId,
        sql: link.sql,
        transaction: link.transaction,
        async running(app, release, handler) {
          const observed = await appsControl.client.observe(app);
          if (
            observed.ok &&
            observed.value !== null &&
            observed.value.mode === "live" &&
            observed.value.release === release &&
            observed.value.ready &&
            observed.value.accepting
          ) {
            // 등록한 handler 이름은 ready probe가 알린 것이다. 화면만 구독하는 앱은 등록하지 않아 process 전달 대상이 아니다.
            return observed.value.tools.includes(handler) ? "running" : "none";
          }
          return "down";
        },
        deliver: path.call,
        announce({ publisher, source, event, payload, audience, at }) {
          ctx.peek.bus?.publish({
            type: "AppEventPublished",
            subject: publisher === "lophn" ? null : publisher,
            at,
            payload: { source, event, payload, audience },
          } as BusEvent);
        },
        failed(app, event, message) {
          ctx.telemetry.logger.warn({
            component: "apps/events",
            event: "delivery_failed",
            fields: { app, name: event, message },
          });
        },
      });
      ctx.provide("eventDelivery", eventDelivery);
      const publishEvent = createEventPublisher({
        delivery: eventDelivery,
        app(app) {
          const loaded = loadApp(link.sql, app);
          if (!loaded.ok) return loaded;
          return ok(
            loaded.value === null
              ? null
              : {
                  slug: loaded.value.slug,
                  archived: loaded.value.status !== "active",
                },
          );
        },
        activeDeclaration(app) {
          const loaded = loadActiveDeclaration(link.sql, app);
          if (!loaded.ok) return loaded;
          return ok(
            loaded.value === null
              ? null
              : {
                  release: loaded.value.release.id as Id<"rel">,
                  declaration: loaded.value.declaration,
                },
          );
        },
        flight: intake.flight,
        // 지금 도는 호출의 사슬(살아 있는 호출)과, 그 호출이 event로 불린 것이면 그 event가 싣고 온 chain(기록에서 읽는다).
        ancestry(parent, publisher) {
          if (parent === null) return [];
          // 이 앱의 호출만 본다(다른 앱의 invocation id로 그 앱의 chain을 읽거나 조작하지 못한다).
          const recorded = ledger.get(parent);
          const own =
            recorded.ok && recorded.value !== null
              ? recorded.value.app === publisher
              : intake.flight(parent)?.app === publisher;
          if (!own) return [];
          const apps = intake.chainApps(parent).reverse();
          const caller = recorded.ok ? recorded.value?.caller : null;
          return [
            ...(caller?.kind === "event" ? caller.chain : []),
            ...apps,
          ] as Id<"app">[];
        },
      });
      const locator: BundleLocator = {
        dir: (target) =>
          (
            ctx.peek.bundleLocator ??
            bundleLocatorOf(ctx.root.path, link.sql, appsControl.previews)
          ).dir(target),
      };
      // activation: 다른 module의 port를 끼운다. 끼우기 전에는 일하지 않는다.
      const activation = appsControl.activation;
      if (activation !== null) {
        activation.attach({
          bus: ctx.bus,
          intake: {
            close: (app) => intake.close(app as Id<"app">, "activation"),
            async whenIdle(app, graceMs) {
              const idle = await intake.whenIdle(app as Id<"app">, graceMs);
              return { idle: idle.idle };
            },
            abandon: (app) => intake.abandon(app as Id<"app">),
            open: (app) => intake.open(app as Id<"app">),
          },
          heldCalls: (app) => intake.heldCount(app as Id<"app">),
          invocations: {
            async pruneChangesets(app, keepRelease) {
              await sync.prune(app as Id<"app">, keepRelease as Id<"rel">);
              await sync.backfill(app as Id<"app">);
              return await ledger.pruneChangesets(
                app as Id<"app">,
                keepRelease as Id<"rel">,
              );
            },
          },
        });
      }
      // SDK 상태: 고정 판은 ledger, 지금 판은 설치 사본, 메모는 내장 skill 폴더에서 읽는다(파일을 읽어 메인 스레드 read다).
      const sdkDeps = {
        dataRoot: ctx.root.path,
        notesRoot: `${BUNDLED_SKILLS_ROOT}/migrate-sdk`,
        sql: link.sql,
      };
      // lophn이 새 판으로 켜질 때나 설치된 SDK 판이 바뀌었을 때마다 SDK 갱신이 있는 앱이 하나라도 있으면 앱 없는 줄 하나를 남긴다(`architecture/app-notice.md`).
      ctx.productStartListeners.push(async (start) => {
        if (!start.changed && !start.sdksChanged) return;
        const statuses = await readSdkStatus(sdkDeps);
        if (!statuses.ok) throw new Error(statuses.error.message);
        const failed = await recordSdkUpdates(
          statuses.value,
          ctx.noticeRecorder,
        );
        if (failed !== null && !failed.ok)
          throw new Error(failed.error.message);
      });
      ctx.provide("appIntake", intake);
      ctx.provide("invocationLedger", ledger);
      ctx.provide("appRewind", rewind);

      // 값이나 sign-in이 없어 secret을 못 받은 호출의 빈 자리다(invocation → 자리). 호출이 실패로 끝날 때 한 번 꺼내 싣는다.
      // 앱이 오류를 삼켜 성공으로 끝난 호출의 항목이 쌓이지 않게 가장 오래된 것부터 버린다.
      const missingSlots = new Map<
        string,
        { app: Id<"app">; secret: string }[]
      >();
      const MISSING_LIMIT = 256;
      const callTool = callToolHandler(path);

      return ok({
        writer: (inner) =>
          withSourceFolder(
            withAfterCommit(
              withStartInvocation(
                withSdkDecide(
                  withReleasePreparation(inner, appsControl.commands),
                  sdkDecideHandler({
                    ...sdkDeps,
                    writer: () => ctx.writer,
                    ids,
                  }),
                ),
                { ledger, sql: link.sql, clock: ctx.clock, ids, sync },
              ),
              // 다른 topic은 router·coding wiring의 applier가 따로 본다.
              (actions) => {
                for (const action of actions) {
                  if (
                    action.topic === APP_RESTART_HALTED_TOPIC ||
                    action.topic === ACTIVATION_CONSENT_TOPIC ||
                    action.topic === NOTICE_TOPIC
                  ) {
                    ctx.peek.bus?.publish(action.data as BusEvent);
                  }
                }
              },
              ctx.telemetry.logger,
            ),
            {
              dataRoot: ctx.root.path,
              logger: ctx.telemetry.logger,
              writer: () => ctx.writer,
            },
          ),
        memory: [
          ...appOAuth.handlers,
          ...appViewHandlers(views),
          [
            "apps/call_tool",
            async (who, body) => {
              const called = await callTool(who, body);
              if (!called.ok) return called;
              const output = called.value as ToolCallOutput;
              if (output.invocation === null) return called;
              const missing = missingSlots.get(output.invocation);
              missingSlots.delete(output.invocation);
              return missing === undefined || output.outcome.status !== "failed"
                ? called
                : ok({ ...output, outcome: { ...output.outcome, missing } });
            },
          ],
          ["apps/rewind", rewindHandler(rewind, link.sql)],
          ...syncRoutes.memory,
          // 변경(app_runtime)은 dispatch가 route의 `changes`로 낸다. 지난 preview의 알림은 recorded false다.
          [
            `${appRecordPreview.resource}/${appRecordPreview.method}`,
            (_who, body) => {
              const input = body as { app: string; process_nonce: string };
              return Promise.resolve(
                ok({
                  recorded:
                    appsControl.previews.bundleHashOf(
                      input.app,
                      input.process_nonce,
                    ) !== null,
                }),
              );
            },
          ],
          [`${appTraySet.resource}/${appTraySet.method}`, tray.set],
          [`${appTrayList.resource}/${appTrayList.method}`, tray.list],
          [`${appWidgetSet.resource}/${appWidgetSet.method}`, widgets.set],
          [`${appWidgetsList.resource}/${appWidgetsList.method}`, widgets.list],
          // remote wiring이 뒤에 채우는 `phoneLink`는 부를 때 읽는다.
          [
            `${appPhoneRequest.resource}/${appPhoneRequest.method}`,
            phoneRequestHandler({
              appStatus(app) {
                const loaded = loadApp(link.sql, app);
                return loaded.ok && loaded.value !== null
                  ? loaded.value.status
                  : null;
              },
              phone: () => ctx.phoneLink,
            }),
          ],
          [
            `${appEventPublish.resource}/${appEventPublish.method}`,
            publishEvent,
          ],
          [
            `${appLogViewError.resource}/${appLogViewError.method}`,
            viewErrorLogHandler({
              request: (op, payload) =>
                appsControl.channel.request(op, payload),
            }),
          ],
          // supervisor(machine)가 앱 요청에 붙일 secret 값을 받는다. 현재 grant 판정은 secretAttach가 한다.
          [
            "apps/secret_value",
            secretValueHandler({
              attach: ctx.secretAttach,
              known: () => ctx.knownSecrets,
              observe: async (app) => {
                const observed = await appsControl.client.observe(app);
                return observed.ok ? ok(observed.value) : observed;
              },
              prepare: (input) => appOAuth.prepare(input),
              missing: (input) => {
                const held = missingSlots.get(input.invocation) ?? [];
                if (!held.some((one) => one.secret === input.name)) {
                  held.push({
                    app: input.app as Id<"app">,
                    secret: input.name,
                  });
                }
                missingSlots.delete(input.invocation);
                missingSlots.set(input.invocation, held);
                const oldest = missingSlots.keys().next().value;
                if (missingSlots.size > MISSING_LIMIT && oldest !== undefined) {
                  missingSlots.delete(oldest);
                }
              },
            }),
          ],
          [
            `${declarationCheck.resource}/${declarationCheck.method}`,
            checkDeclaration({
              slugOf,
              sourceRootOf: (context, app) =>
                appsControl.sourceRootOf(
                  context,
                  declarationCheck,
                  app,
                  "not_found",
                ),
            }),
          ],
          [
            `${packagesBuiltin.resource}/${packagesBuiltin.method}`,
            readBuiltinSdk({ dataRoot: ctx.root.path }),
          ],
          [
            `${packagePublish.resource}/${packagePublish.method}`,
            publishPackage({
              dataRoot: ctx.root.path,
              sourceRootOf: (app) => sourceRootOfApp(link.sql, app),
              prepareBlob: (call) => ctx.blobRelay.prepare(call),
              catalog: link.sql,
              registerVersion: async (input) => {
                const done = await ctx.writer.command(
                  PACKAGE_PUBLISH_CONTEXT as never,
                  (await registerVersionEnvelope(input)) as never,
                );
                return done.ok ? ok(done.value.result as never) : done;
              },
            }),
          ],
        ],
        fileStreams: [
          ["apps/screen_file", screenFileStream(createScreenFileDeps(locator))],
          [
            "apps/phone_file",
            phoneFileStream(createScreenFileDeps(locator), link.sql),
          ],
          ...syncRoutes.files,
        ],
        reads(reads) {
          appsControl.overlayReads(reads);
          reads.set("apps/rewind_plan", mainRead(rewindReads.plan, link.sql));
          reads.set("apps/rewinds", mainRead(rewindReads.list, link.sql));
          for (const [route, handler] of syncRoutes.reads) {
            reads.set(route, handler);
          }
          reads.set(
            "apps/icon",
            appIconRead({
              ...createScreenFileDeps(locator),
              iconPath: iconPathOf(link.sql),
              uploaded: (app) => ok(loadAppIcon(link.sql, app)),
            }),
          );
          reads.set("apps/sdk_status", appSdkStatusRead(sdkDeps));
          reads.set(
            "apps/skills",
            appSkillsRead(createAppSkillsDeps(locator), link.sql),
          );
          reads.set(
            "apps/phone_screens",
            phoneScreensRead(
              {
                ...createScreenFileDeps(locator),
                warn: (message) =>
                  ctx.telemetry.logger.warn({
                    component: "apps/phone",
                    event: "backend_manifest_unreadable",
                    fields: { message },
                  }),
                async running(app, release) {
                  const observed = await appsControl.client.observe(app);
                  return (
                    observed.ok &&
                    observed.value !== null &&
                    observed.value.mode === "live" &&
                    observed.value.release === release &&
                    observed.value.ready &&
                    observed.value.accepting
                  );
                },
                async preview(app) {
                  const ready = await readyPreview(appsControl, app);
                  return ready.ok ? ready.value : null;
                },
              },
              link.sql,
            ),
          );
          // 안내 원문만 읽는 좁은 route다. apps 등록이 route를 선언하고(handler 없음) blob 바이트 통로를 가진 이
          // 조립이 handler를 붙인다. coding credential에 일반 blobs/read를 열지 않는다.
          reads.set(
            `${packagesGuideBody.resource}/${packagesGuideBody.method}`,
            (context, body) => packageGuideBodyHandler(ctx, context, body),
          );
        },
      });
    },
    async start(ctx) {
      const { runtime, registry, appsControl } = ctx;
      // 이전 core가 끝내지 못한 호출과 rewind는 결과를 모르는 채 닫는다.
      const now = () => ctx.clock.now() as At;
      if (invocations !== undefined) {
        await closeUnfinishedInvocations(invocations, now());
      }
      if (write !== undefined) {
        closeInterruptedRewinds({ sql: write.sql, now });
        // 앞선 core가 앱의 commit과 sync log 줄 사이에서 끝났으면 그 변경을 폰이 받지 못한다. 그 자리를 '다시 snapshot'으로 채운다.
        const apps = loadApps(write.sql, undefined);
        for (const app of apps.ok ? apps.value : []) {
          await syncLog?.backfill(app.id as Id<"app">);
        }
      }
      await snapshots?.clean();
      // apps/supervisor. 앱 프로세스 감독이다. machine credential과 서명 검증 공개 key를 hello에
      // 싣고, 자식 앱이 쓸 app credential은 supervisor의 요청마다 발급한다. 띄우지 못해도 core는
      // 계속 선다: supervisor 관측이 없는 상태(unavailable)로 답한다.
      // 앱 자식의 app.call_tool이 writer를 지난다. writer는 ledger 행으로 기록되지 않은
      // 자격의 command를 거절하므로 메모리 발급만으로는 unauthorized가 된다.
      const childIssuer = appCredentialIssuer(registry);
      appsControl.useIssuer({
        ...childIssuer,
        async request(message) {
          const issued = await childIssuer.request(message);
          if (!issued.ok) return issued;
          const current = registry.revalidate({
            credential_ref: issued.value.credential_ref,
          });
          if (!current.ok) {
            childIssuer.end(issued.value.credential_ref);
            return current;
          }
          const recorded = await runtime.record(current.value);
          if (!recorded.ok) {
            childIssuer.end(issued.value.credential_ref);
            return err(recorded.error);
          }
          return issued;
        },
      });
      const issued = await registry.issue({
        actor: "machine",
        principal: "machine:apps-supervisor",
        scope: {
          operations: [...SUPERVISOR_CREDENTIAL_OPERATIONS],
          targets: { task: "apps" },
        },
        conditions: { task: "apps", process: APPS_SUPERVISOR_KIND },
      });
      const current = issued.ok
        ? registry.revalidate({
            credential_ref: issued.value.credential_ref,
          })
        : issued;
      const recorded =
        issued.ok && current.ok ? await runtime.record(current.value) : current;
      if (issued.ok && current.ok && recorded.ok) {
        const started = await ctx.appsSupervision.start(
          appSupervisorSpec(),
          {
            type: "hello",
            core_epoch: ctx.epoch,
            process_identity: ctx.epoch,
            kind: APPS_SUPERVISOR_KIND,
            task: "apps",
            scope: {
              operations: [],
              targets: { task: "apps" },
            },
            credential: issued.value.token,
            api_port: ctx.server.port,
          },
          {
            onMessage: (message) => {
              if (
                message.type === "diagnostic" &&
                message.kind === "lophn_internal"
              ) {
                // 보내는 쪽 값을 믿지 않고 core가 component·location을 정한다.
                void ctx
                  .diagnosticsWrite({
                    ...message,
                    payload: {
                      ...message.payload,
                      component: "platform/app-supervisor",
                      location: CRASH_LOCATIONS.appSupervisor,
                    },
                  })
                  .catch(() => {});
                return;
              }
              appsControl.onSupervisorMessage(message);
            },
            // 화면 operation의 큰 응답은 bytes frame과 end로 온다(`supervisor-link.ts`의 stream).
            onFrame: (frame) => appsControl.channel.onFrame(frame),
            // supervisor child가 끝나면 답을 기다리던 질의를 기한(5초·재시작 30초)까지 두지 않고 끝낸다.
            onEnd: () =>
              appsControl.channel.failPending(
                "app supervisor가 끝나 요청이 끝나지 못했다",
              ),
          },
        );
        if (started.ok) {
          const supervision = ctx.appsSupervision;
          appsControl.channel.bind({
            send: (payload) =>
              supervision
                .send(APPS_SUPERVISOR_KIND, payload)
                .then((sent) => sent.ok),
            sendBytes: (channel, chunk) =>
              supervision
                .sendBytes(APPS_SUPERVISOR_KIND, channel, chunk)
                .then((sent) => sent.ok),
            sendEnd: (channel) =>
              supervision
                .sendEnd(APPS_SUPERVISOR_KIND, channel)
                .then((sent) => sent.ok),
            sendAbort: (channel) =>
              supervision
                .sendAbort(APPS_SUPERVISOR_KIND, channel)
                .then((sent) => sent.ok),
          });
        }
      }
      appsControl.start();
      if (write !== undefined) {
        unsubscribePhoneChanged = startPhoneChangedWatch({
          bus: ctx.bus,
          sql: write.sql,
          record: ctx.noticeRecorder,
          warn: (message) =>
            ctx.telemetry.logger.warn({
              component: "apps/phone",
              event: "phone_changed_notice_failed",
              fields: { message },
            }),
        });
      }
      const table = views;
      if (table !== undefined) {
        unsubscribeViews = ctx.bus.subscribe(
          [{ types: ["AppViewChanged", "AppEventPublished"] }],
          {
            send(event) {
              if (event.type === "AppViewChanged") {
                // 다시 묶기가 실패해도 core가 죽지 않게 남기기만 한다. view는 다음 변경이나 다시 열기로 맞춘다.
                void table.changed(event.subject).catch((error: unknown) =>
                  ctx.telemetry.logger.warn({
                    component: "apps/views",
                    event: "rebind_failed",
                    fields: { app: event.subject, message: String(error) },
                  }),
                );
              } else if (event.type === "AppEventPublished") {
                table.published(event.payload);
              }
            },
            close() {},
          },
        );
      }
      return ok(undefined);
    },
    closeIntake() {
      unsubscribeViews?.();
      unsubscribeViews = undefined;
      unsubscribePhoneChanged?.();
      unsubscribePhoneChanged = undefined;
    },
    // 앱 supervisor가 앱 자식을 정지하기 전에 질의 통로를 닫는다.
    closeChildren() {
      control?.stop();
    },
    // writer가 닫히기 전에 이 wiring의 ledger 연결을 닫는다.
    async closeWork() {
      // 기다리는 sign-in의 listener가 남지 않게 한다.
      await oauth?.endAll();
      write?.close();
      write = undefined;
    },
  };
};

// 그 앱의 지금 ready인 preview process(view의 preview port와 `apps/phone_screens`가 같이 쓴다).
// preview service는 release를 쥐지 않는다. release는 그 process의 관측이 싣는다.
async function readyPreview(
  appsControl: Pick<WiringContext["appsControl"], "previews" | "client">,
  app: string,
) {
  const current = await appsControl.previews.current(app);
  if (!current.ok) return current;
  if (current.value === null || !current.value.ready) return ok(null);
  const nonce = current.value.process_nonce;
  const observed = await appsControl.client.previewObserve(app, nonce);
  if (!observed.ok) return observed;
  if (observed.value === null || !observed.value.ready) return ok(null);
  return ok({
    release: observed.value.release as Id<"rel"> | null,
    bundle_hash: current.value.bundle_hash,
    process_nonce: nonce,
  });
}

// 앱의 현재 선언 가운데 oauth를 가진 secret.use마다, 현재 선언 ∩ active grant에 들었는지(secretsWiring의 allowance와 같은 판정)를 낸다.
function declaredOAuth(
  ctx: WiringContext,
  app: string,
): Result<readonly AppOAuthDeclared[]> {
  const opened = openConnection(ctx.ledgerPath);
  if (!opened.ok) return opened;
  const { sql } = opened.value;
  try {
    const facts = releaseFacts.get(sql, app);
    if (!facts.ok) return facts;
    if (facts.value === null) return ok([]);
    const grants = loadGrants(sql, { app, status: "active" });
    if (!grants.ok) return grants;
    const { access } = effectiveScope({
      app,
      facts: facts.value,
      grants: grants.value,
      targetCommands: () => undefined,
    });
    const result: AppOAuthDeclared[] = [];
    for (const requirement of facts.value.permissions) {
      const scope = requirement.scope as PermissionScope;
      if (requirement.kind !== "secret.use" || !("oauth" in scope)) continue;
      if (scope.oauth === undefined) continue;
      const wanted = canonicalize(scope);
      result.push({
        name: scope.name,
        oauth: scope.oauth,
        granted: access.some(
          (entry) =>
            entry.kind === "secret.use" && canonicalize(entry.scope) === wanted,
        ),
      });
    }
    return ok(result);
  } finally {
    opened.value.close();
  }
}

// /packages/guide_body. owner_kind·field가 `package_version`·`guide`로 고정이라 입력으로 다른 blob을
// 가리킬 수 없다. 자격은 이 route의 operation(`packages.guide_body`)이고 일반 `blobs/read`는 필요 없다.
// 앱 범위 연결의 고정 조건 target만 함께 검사한다(packages는 공개 catalog라 앱 안의 대상이 아니다).
function packageGuideBodyHandler(
  ctx: WiringContext,
  context: RequestContext,
  body: unknown,
): Promise<Result<unknown>> {
  const parsed = packagesGuideBody.input.safeParse(body);
  if (!parsed.success) {
    return Promise.resolve(
      err({ code: "invalid_input", message: "안내 읽기 입력이 올바르지 않다" }),
    );
  }
  const input: BlobReadInput = {
    owner_kind: PACKAGE_GUIDE_BLOB_OWNER_KIND,
    owner_key: packageGuideOwnerKey(parsed.data.name, parsed.data.version),
    field: PACKAGE_GUIDE_BLOB_FIELD_NAME,
    offset_bytes: parsed.data.offset_bytes,
    length_bytes: parsed.data.length_bytes,
  };
  return blobReadHandler(
    ctx.ledgerPath,
    ctx.blobRead.deps,
    context,
    input,
    (current) => {
      const target: NonNullable<Parameters<typeof authorize>[2]> = {};
      for (const key of CONDITION_TARGET_KEYS) {
        const value = current.conditions[key];
        if (value !== undefined && Object.hasOwn(current.scope.targets, key)) {
          target[key] = value;
        }
      }
      return authorize(current, packagesGuideBody.name, target, {
        domain: "skip",
      });
    },
  );
}

// 앱에 연결된 source 폴더. package.publish가 호출자(그 앱의 agent)를 따로 확인한 뒤 읽는다.
function sourceRootOfApp(
  sql: Parameters<typeof loadApp>[0],
  app: string,
): Result<string> {
  const found = loadApp(sql, app);
  if (!found.ok) return found;
  return found.value?.source_path == null
    ? err({ code: "invalid_input", message: "the app has no connected source" })
    : ok(found.value.source_path);
}
