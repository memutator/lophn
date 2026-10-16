import {
  createIdSource,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import {
  blueprintCheck,
  packagePublish,
  packageRegisterVersion,
  packagesGuideBody,
} from "../../../../protocol/apps/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { At } from "../../../../protocol/base/values.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import type {
  BlobReadInput,
  PreparedBlob,
} from "../../../../protocol/storage/mod.ts";
import {
  appCredentialIssuer,
  APPS_CONTROL_CONTEXT,
  APPS_CONTROL_PRINCIPAL,
  APPS_SUPERVISOR_KIND,
  appsOperationPolicies,
  appSupervisorSpec,
  createAppsControl,
  PACKAGE_PUBLISH_CONTEXT,
  SUPERVISOR_CREDENTIAL_OPERATIONS,
  withReleasePreparation,
} from "../../../apps/control.ts";
import { createAppCalls } from "../../../apps/calls/mod.ts";
import {
  type ChangesetBlobs,
  closeUnfinishedInvocations,
  createInvocationLedger,
  INVOCATION_BLOB_PURPOSES,
  observeInvocations,
} from "../../../apps/invocations/mod.ts";
import {
  closeInterruptedRewinds,
  createAppRewind,
  createRewindReads,
} from "../../../apps/rewind/mod.ts";
import { loadApp } from "../../../apps/registration/mod.ts";
import { createScreenFileDeps } from "../../../apps/screens/mod.ts";
import type {
  AppViewSignal,
  BundleLocator,
  CallerDirectory,
  InvocationLedger,
  ProjectDirectory,
} from "../../../apps/ports.ts";
import {
  appApiLookupOf,
  appStatesOf,
  bundleLocatorOf,
  callApiHandler,
  mainRead,
  PROJECTS_READ_KEY,
  projectsRead,
  rewindHandler,
  screenFileStream,
  withStartInvocation,
} from "../../../apps/routes.ts";
import { openWriteLink, type WriteLink } from "../../../apps/write-link.ts";
import { checkBlueprint } from "../../../apps/blueprint/check.ts";
import { publishPackage } from "../../../apps/packages/publish.ts";
import { findAppTestVerification } from "../../../problems/tests/app-test-lookup.ts";
import { createReleaseSourceMaps } from "../../../apps/releases/bundle/read.ts";
import { createCopyPreviewBundles } from "../../../apps/releases/activation/desired.ts";
import { observeReleaseActivations } from "../../../apps/releases/activation/recovery.ts";
import {
  PACKAGE_GUIDE_BLOB_FIELD_NAME,
  PACKAGE_GUIDE_BLOB_OWNER_KIND,
  packageGuideOwnerKey,
} from "../../../apps/packages/blobs.ts";
import {
  authorize,
  CONDITION_TARGET_KEYS,
} from "../../../server/identity/mod.ts";
import { blobReadHandler } from "../runtime.ts";
import { approvalLedgerRead } from "./approval-reads.ts";
import {
  type AppsControl,
  createProductRedactor,
  type WiringContext,
  type WiringFactory,
} from "./context.ts";

const notAttached = <T>(): Result<T> =>
  err({ code: "unavailable", message: "this dependency is not attached" });

export const appsWiring: WiringFactory = () => {
  let control: AppsControl | undefined;
  let write: WriteLink | undefined;
  let invocations: InvocationLedger | undefined;
  return {
    name: "apps",
    restartOwners: [observeInvocations, observeReleaseActivations],
    // apps 관측 기록·자식 앱 credential이 닿는 operation.
    operations: () => appsOperationPolicies(),
    // apps 제어(runtime·logs 덮기, activation)가 ledger 사실을 읽고 기록하는 core 내부 자격 기록.
    records: () => [APPS_CONTROL_CONTEXT, PACKAGE_PUBLISH_CONTEXT],
    async build(ctx) {
      const { runtime } = ctx;
      const redactLine = createProductRedactor(ctx.knownSecrets);
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // preview 자식이 loopback으로 core API에 닿지 못하게 막을 port다. API를 연 뒤에 정해진다.
      const apiPorts = () => {
        const port = ctx.peek.server?.port ?? 0;
        return port === 0 ? [] : [port];
      };
      const machine = () => {
        const current = runtime.current(APPS_CONTROL_PRINCIPAL);
        return current.ok ? current.value : undefined;
      };
      const appsControl = await createAppsControl({
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
            runtime.writer.command(context as never, envelope as never),
          machine,
          prepareBlob: (call) => ctx.blobRelay.prepare(call),
          platformPorts: apiPorts,
        },
        previews: {
          dataRoot: ctx.root.path,
          bundles: createCopyPreviewBundles({
            dataRoot: ctx.root.path,
            platformPorts: apiPorts,
          }),
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
      });
      invocations = ledger;

      const callers: CallerDirectory = {
        agentToolCall: (...args) =>
          ctx.peek.callerDirectory?.agentToolCall(...args) ??
            notAttached(),
      };
      const projects: ProjectDirectory = {
        list: () => ctx.peek.projectDirectory?.list() ?? notAttached(),
        get: (id) => ctx.peek.projectDirectory?.get(id) ?? notAttached(),
      };
      const states = appStatesOf(link.sql);
      const { path, intake } = createAppCalls({
        callers,
        projects,
        lookup: appApiLookupOf(link.sql),
        apps: states,
        ledger,
        link: appsControl.link,
        approvals: ctx.approvals,
        clock: ctx.clock,
        ids,
      });
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
      });
      const rewindReads = createRewindReads({ rewind });
      const locator: BundleLocator = {
        dir: (target) =>
          (ctx.peek.bundleLocator ??
            bundleLocatorOf(ctx.root.path, link.sql)).dir(target),
      };
      // activation: 다른 module의 port를 끼우고 Reactor·Approvals에 등록한다. 끼우기 전에는 일하지 않는다.
      const activation = appsControl.activation;
      if (activation !== null) {
        const approvalReads = approvalLedgerRead(ctx.ledgerPath);
        activation.attach({
          approvals: {
            createPending: (intent) => ctx.approvals.createPending(intent),
            cancelPendingFor: (app, release) =>
              ctx.approvals.cancelPendingFor(app, release),
            request: (id) => Promise.resolve(approvalReads.request(id)),
            pending: () => Promise.resolve(approvalReads.pending()),
          },
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
          invocations: {
            pruneChangesets: (app, keepRelease) =>
              ledger.pruneChangesets(
                app as Id<"app">,
                keepRelease as Id<"rel">,
              ),
          },
        });
        ctx.reactor.on("TicketVerified", activation.handlers.ticketVerified);
        ctx.reactor.on("ApprovalDecided", activation.handlers.approvalDecided);
        ctx.approvals.registerApplier(
          "activation",
          activation.handlers.applier,
        );
      }
      // annotation이 읽는 release bundle의 source map이다.
      ctx.provide(
        "releaseSourceMaps",
        createReleaseSourceMaps({
          ledgerPath: ctx.ledgerPath,
          dataRoot: ctx.root.path,
        }),
      );
      ctx.provide("appIntake", intake);
      ctx.provide("invocationLedger", ledger);
      ctx.provide("appRewind", rewind);

      return ok({
        writer: (inner) =>
          withStartInvocation(
            withReleasePreparation(inner, appsControl.commands),
            { ledger, sql: link.sql, clock: ctx.clock, ids },
          ),
        memory: [
          ["apps/call_api", callApiHandler(path)],
          ["apps/rewind", rewindHandler(rewind)],
          [
            `${blueprintCheck.resource}/${blueprintCheck.method}`,
            checkBlueprint({
              dataRoot: ctx.root.path,
              sourceRootOf: (context, app) =>
                appsControl.sourceRootOf(
                  context,
                  blueprintCheck,
                  app,
                  "not_found",
                ),
            }),
          ],
          [
            `${packagePublish.resource}/${packagePublish.method}`,
            publishPackage({
              dataRoot: ctx.root.path,
              sourceRootOf: (app) => sourceRootOfApp(link.sql, app),
              verification: (id) => findAppTestVerification(link.sql, id),
              prepareBlob: (call) => ctx.blobRelay.prepare(call),
              registerVersion: async (input) => {
                const key = `package-publish-${await sha256Hex(
                  `${input.name}\n${input.version}\n${input.bundle_hash}\n${input.guide_hash}`,
                )}`;
                const done = await ctx.runtime.writer.command(
                  PACKAGE_PUBLISH_CONTEXT as never,
                  {
                    command: packageRegisterVersion.name,
                    input,
                    compare: {},
                    idempotency_key: key,
                    prepared: input.guide_blob === undefined
                      ? []
                      : [input.guide_blob.preparation],
                  },
                );
                return done.ok ? ok(done.value.result as never) : done;
              },
            }),
          ],
        ],
        fileStreams: [[
          "apps/screen_file",
          screenFileStream(createScreenFileDeps(locator)),
        ]],
        reads(reads) {
          appsControl.overlayReads(reads);
          reads.set("apps/rewind_plan", mainRead(rewindReads.plan, link.sql));
          reads.set("apps/rewinds", mainRead(rewindReads.list, link.sql));
          reads.set(PROJECTS_READ_KEY, projectsRead(projects, link.sql));
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
      }
      // apps/supervisor. 앱 프로세스 감독이다. machine credential과 서명 검증 공개 key를 hello에
      // 싣고, 자식 앱이 쓸 app credential은 supervisor의 요청마다 발급한다. 띄우지 못해도 core는
      // 계속 선다: supervisor 관측이 없는 상태(unavailable)로 답한다.
      // collector는 요청 credential을 ledger 행으로 다시 읽는다. 메모리 발급만으로는
      // 선언 보고가 unauthorized가 된다.
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
      const recorded = issued.ok && current.ok
        ? await runtime.record(current.value)
        : current;
      if (issued.ok && current.ok && recorded.ok) {
        const started = await ctx.appsSupervision.start(
          appSupervisorSpec({
            dataRoot: ctx.root.path,
            apiPort: ctx.server.port,
          }),
          {
            type: "hello",
            core_epoch: ctx.epoch,
            process_identity: ctx.epoch,
            kind: APPS_SUPERVISOR_KIND,
            task: "apps",
            // 서명 검증 공개 key는 secret이 아니다. 감독이 supervisor를 다시 띄워도 hello가
            // 같은 key를 다시 준다.
            scope: {
              operations: [],
              targets: { task: "apps", verify_key: appsControl.verifyKey },
            },
            credential: issued.value.token,
            api_port: ctx.server.port,
          },
          {
            onMessage: (message) => appsControl.onSupervisorMessage(message),
            // supervisor child가 끝나면 답을 기다리던 질의를 기한(5초·재시작 30초)까지 두지 않고 끝낸다.
            onEnd: () =>
              appsControl.channel.failPending(
                "app supervisor가 끝나 요청이 끝나지 못했다",
              ),
          },
        );
        if (started.ok) {
          appsControl.channel.bind((payload) =>
            ctx.appsSupervision.send(APPS_SUPERVISOR_KIND, payload).then((
              sent,
            ) => sent.ok)
          );
        }
      }
      appsControl.start();
      return ok(undefined);
    },
    // 앱 supervisor가 앱 자식을 정지하기 전에 질의 통로를 닫는다.
    closeChildren() {
      control?.stop();
    },
    // writer가 닫히기 전에 이 wiring의 ledger 연결을 닫는다.
    closeWork() {
      write?.close();
      write = undefined;
    },
  };
};

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
