import {
  canonicalize,
  createIdSource,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import type { PermissionScope } from "../../../../protocol/apps/declaration/mod.ts";
import {
  type AppGrant,
  appGrantsList,
  GRANT_LIST_MAX_COUNT,
} from "../../../../protocol/apps/grants.ts";
import {
  appConnectSource,
  appLogViewError,
  declarationCheck,
  packagePublish,
  packageRegisterVersion,
  packagesBuiltin,
  packagesGuideBody,
} from "../../../../protocol/apps/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { At } from "../../../../protocol/base/values.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import type {
  BlobReadInput,
  PreparedBlob,
} from "../../../../protocol/storage/mod.ts";
import { loadAssignment } from "../../../approvals/assignment/mod.ts";
import { createAppCalls } from "../../../apps/calls/mod.ts";
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
  SOURCE_FOLDER_CONTEXT,
  withSourceFolder,
} from "../../../apps/registration/mod.ts";
import { ACTIVATION_CONSENT_TOPIC } from "../../../apps/releases/activation/consents.ts";
import { createCopyPreviewBundles } from "../../../apps/releases/activation/desired.ts";
import { observeReleaseActivations } from "../../../apps/releases/activation/recovery.ts";
import { releaseFacts } from "../../../apps/releases/mod.ts";
import {
  closeInterruptedRewinds,
  createAppRewind,
  createRewindReads,
} from "../../../apps/rewind/mod.ts";
import {
  appIconRead,
  appStatesOf,
  appToolLookupOf,
  bundleLocatorOf,
  callToolHandler,
  iconPathOf,
  mainRead,
  rewindHandler,
  screenFileStream,
  withStartInvocation,
} from "../../../apps/routes.ts";
import { APP_RESTART_HALTED_TOPIC } from "../../../apps/runtime/commands.ts";
import { viewErrorLogHandler } from "../../../apps/runtime/view-errors.ts";
import { createScreenFileDeps } from "../../../apps/screens/mod.ts";
import { openWriteLink, type WriteLink } from "../../../apps/write-link.ts";
import { CRASH_LOCATIONS } from "../../../diagnostics/mod.ts";
import { domainsOfOwner } from "../../../domains/mod.ts";
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
import { agentDomainPorts } from "../agent-domains.ts";
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
  return {
    name: "apps",
    restartOwners: [observeInvocations, observeReleaseActivations],
    // apps 관측 기록·자식 앱 credential이 닿는 operation.
    operations: () => [
      ...appsOperationPolicies(),
      // 새 앱의 source를 잇는 core 안 machine 자격(registration/source-folder.ts).
      { name: appConnectSource.name, actors: ["machine"], kind: "command" },
    ],
    // apps 제어(runtime·logs 덮기, activation)가 ledger 사실을 읽고 기록하는 core 내부 자격 기록.
    records: () => [
      APPS_CONTROL_CONTEXT,
      PACKAGE_PUBLISH_CONTEXT,
      SOURCE_FOLDER_CONTEXT,
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
      });
      oauth = appOAuth;
      const machine = () => {
        const current = runtime.current(APPS_CONTROL_PRINCIPAL);
        return current.ok ? current.value : undefined;
      };
      // 앱의 active domain 이름. link가 열린 뒤에 읽는다(선언 검사, 실행을 여는 사본 읽기, preview).
      const domainNamesOf = (app: string): Promise<Result<string[]>> => {
        try {
          return Promise.resolve(
            write === undefined
              ? err({ code: "unavailable", message: "ledger is not open" })
              : ok(
                  domainsOfOwner(
                    write.sql,
                    { kind: "app", id: app },
                    "active",
                  ).map((domain) => domain.name),
                ),
          );
        } catch {
          return Promise.resolve(
            err({ code: "unavailable", message: "app domains cannot be read" }),
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
          domainNamesOf,
        },
        previews: {
          dataRoot: ctx.root.path,
          bundles: createCopyPreviewBundles({
            dataRoot: ctx.root.path,
            domainNamesOf,
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

      const callers: CallerDirectory = createCallerDirectory(link.sql);
      ctx.provide("callerDirectory", callers);
      const states = appStatesOf(link.sql);
      const domains = agentDomainPorts(link.sql);
      // 읽지 못하면 unavailable로 올려 Gate가 막는 쪽으로 실패하게 한다.
      const readDomains = <T>(read: () => T): Result<T> => {
        try {
          return ok(read());
        } catch {
          return err({
            code: "unavailable",
            message: "domains cannot be read",
          });
        }
      };
      const { path, intake } = createAppCalls({
        callers,
        lookup: appToolLookupOf(link.sql, appsControl.previews),
        apps: states,
        ledger,
        link: appsControl.link,
        assignmentOf: (agent) => loadAssignment(link.sql, agent),
        agentDomainsOf: (agent) =>
          readDomains(() => domains.agentDomains(agent)),
        toolDomainOf: (app, name) =>
          readDomains(() => domains.domainOf(app, name)),
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
      });
      ctx.provide("appCallPath", path);
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
          (
            ctx.peek.bundleLocator ?? bundleLocatorOf(ctx.root.path, link.sql)
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
            pruneChangesets: (app, keepRelease) =>
              ledger.pruneChangesets(
                app as Id<"app">,
                keepRelease as Id<"rel">,
              ),
          },
        });
      }
      ctx.provide("appIntake", intake);
      ctx.provide("invocationLedger", ledger);
      ctx.provide("appRewind", rewind);

      return ok({
        writer: (inner) =>
          withSourceFolder(
            withAfterCommit(
              withStartInvocation(
                withReleasePreparation(inner, appsControl.commands),
                { ledger, sql: link.sql, clock: ctx.clock, ids },
              ),
              // 다른 topic은 router·coding wiring의 applier가 따로 본다.
              (actions) => {
                for (const action of actions) {
                  if (
                    action.topic === APP_RESTART_HALTED_TOPIC ||
                    action.topic === ACTIVATION_CONSENT_TOPIC
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
          ["apps/call_tool", callToolHandler(path)],
          ["apps/rewind", rewindHandler(rewind)],
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
            }),
          ],
          [
            `${declarationCheck.resource}/${declarationCheck.method}`,
            checkDeclaration({
              domainNamesOf,
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
              registerVersion: async (input) => {
                const key = `package-publish-${await sha256Hex(
                  `${input.name}\n${input.version}\n${input.bundle_hash}\n${input.guide_hash}`,
                )}`;
                const done = await ctx.writer.command(
                  PACKAGE_PUBLISH_CONTEXT as never,
                  {
                    command: packageRegisterVersion.name,
                    input,
                    compare: {},
                    idempotency_key: key,
                    prepared:
                      input.guide_blob === undefined
                        ? []
                        : [input.guide_blob.preparation],
                  },
                );
                return done.ok ? ok(done.value.result as never) : done;
              },
            }),
          ],
        ],
        fileStreams: [
          ["apps/screen_file", screenFileStream(createScreenFileDeps(locator))],
        ],
        reads(reads) {
          appsControl.overlayReads(reads);
          reads.set("apps/rewind_plan", mainRead(rewindReads.plan, link.sql));
          reads.set("apps/rewinds", mainRead(rewindReads.list, link.sql));
          reads.set(
            "apps/icon",
            appIconRead({
              ...createScreenFileDeps(locator),
              iconPath: iconPathOf(link.sql),
              uploaded: (app) => ok(loadAppIcon(link.sql, app)),
            }),
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
      }
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
      return ok(undefined);
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
