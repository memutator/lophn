import { err, ok, type Result } from "../../../../base/mod.ts";
import { createApprovalRequest } from "../../../../protocol/approvals/mod.ts";
import { packagesGuideBody } from "../../../../protocol/apps/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import type { BlobReadInput } from "../../../../protocol/storage/mod.ts";
import {
  appCredentialIssuer,
  APPS_CONTROL_CONTEXT,
  APPS_CONTROL_PRINCIPAL,
  APPS_SUPERVISOR_KIND,
  appsOperationPolicies,
  appSupervisorSpec,
  createAppsControl,
  SUPERVISOR_CREDENTIAL_OPERATIONS,
  withReleasePreparation,
} from "../../../apps/control.ts";
import { createConfirmAdapters } from "../../../apps/connections/confirm-adapters.ts";
import {
  interruptedFinish,
  INVOCATION_RECOVERY_CONTEXT,
  observeInvocations,
} from "../../../apps/invocations/restart.ts";
import { createCopyPreviewBundles } from "../../../apps/releases/activation/desired.ts";
import { observeReleaseActivations } from "../../../apps/releases/activation/recovery.ts";
import {
  PACKAGE_GUIDE_BLOB_FIELD_NAME,
  PACKAGE_GUIDE_BLOB_OWNER_KIND,
  packageGuideOwnerKey,
} from "../../../apps/packages/blobs.ts";
import {
  createApprovalTextPreparer,
  withApprovalText,
} from "../../../approvals/text-prepare.ts";
import {
  authorize,
  CONDITION_TARGET_KEYS,
} from "../../../server/identity/mod.ts";
import { blobReadHandler } from "../runtime.ts";
import {
  type AppsControl,
  createProductRedactor,
  type WiringContext,
  type WiringFactory,
} from "./context.ts";

export const appsWiring: WiringFactory = () => {
  let control: AppsControl | undefined;
  return {
    name: "apps",
    restartOwners: [observeInvocations, observeReleaseActivations],
    // apps 관측 기록·제어 connection·자식 앱 credential이 닿는 operation.
    operations: () => appsOperationPolicies(),
    records: () => [
      // 재시작 때 접수·실행 중 invocation을 미확인으로 확정하는 core 내부 자격의 기록이다. 기록이 없으면
      // writer가 확정을 거절해 행이 계속 남으므로 기동을 여기서 멈춘다.
      INVOCATION_RECOVERY_CONTEXT as never,
      // apps 제어(connect 어댑터·runtime·logs 덮기)가 ledger 사실을 읽는 core 내부 자격 기록.
      APPS_CONTROL_CONTEXT,
    ],
    async build(ctx) {
      const { runtime, registry } = ctx;
      const redactLine = createProductRedactor(ctx.knownSecrets);
      // 앱 쌍 confirm의 approval 요청은 approval 글 준비를 지나는 writer로 낸다(사람이 보는 글은 blob이다).
      const confirmWriter = withApprovalText(
        runtime.writer,
        createApprovalTextPreparer({
          relay: () => ctx.bodyPrepare,
          known: () => ctx.knownSecrets,
        }),
      );
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
        confirm: createConfirmAdapters({
          clock: ctx.clock,
          ledgerPath: ctx.ledgerPath,
          command: (context, envelope) =>
            confirmWriter.command(context as never, envelope as never),
          machine,
          // 호출한 앱 자신의 짧은 app credential이다. 요청 하나를 마치면 끝낸다.
          async requester(source) {
            // 앱 자격은 앱·release·process·mode에 고정된다. release가 없는 자식은 confirm을 요청하지 못한다.
            if (source.release === null) {
              return err({
                code: "forbidden",
                message: "app confirm is live only",
              });
            }
            const issued = await registry.issue({
              actor: `app:${source.app}`,
              principal: `app:${source.app}`,
              scope: {
                operations: [createApprovalRequest.name],
                targets: {
                  app: source.app,
                  release: source.release,
                  process: source.processNonce,
                  mode: source.mode,
                },
              },
              conditions: {
                app: source.app,
                release: source.release,
                process: source.processNonce,
                mode: source.mode,
              },
            });
            if (!issued.ok) return issued;
            const ref = issued.value.credential_ref;
            const current = registry.revalidate({ credential_ref: ref });
            if (!current.ok) return current;
            const recorded = await runtime.record(current.value);
            if (!recorded.ok) return recorded;
            const context = runtime.current(ref);
            if (!context.ok) return context;
            return ok({
              context: context.value,
              end: () => void registry.end(ref),
            });
          },
        }),
        // coding credential은 ledger의 connection 상태가 현재 자격이다(회수는 다음 요청부터가 아니라 바로).
        revalidate: (credentialRef) =>
          ctx.coding.current(credentialRef) ??
            registry.revalidate({ credential_ref: credentialRef }),
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
            confirmWriter.command(context as never, envelope as never),
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
      return ok({
        writer: (inner) =>
          withReleasePreparation(
            inner,
            appsControl.commands,
            appsControl.grantChange,
          ),
        memory: appsControl.memory,
        reads(reads) {
          appsControl.overlayReads(reads);
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
      await sweepInterruptedInvocations(ctx);
      // apps/supervisor. 앱 프로세스 감독이다. machine credential과 서명 검증 공개 key를 hello에
      // 싣고, 자식 앱이 쓸 app credential은 supervisor의 요청마다 발급한다. 띄우지 못해도 core는
      // 계속 선다: connect와 runtime은 supervisor 관측이 없는 상태(unavailable)로 답한다.
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
  };
};

// 재시작 점검이 unknown으로 본 접수·실행 중 invocation을 미확인으로 확정한다. 이전 core의 앱 프로세스는
// 이미 없고 새 프로세스는 새 nonce라 옛 접수·시작은 이어지지 않는다. 읽기 목록으로 후보를 읽고
// 기존 machine command `invocation.record_finished`로 확정하며, 같은 key라 여러 번 돌아도 같은 결과다.
// apps를 조립하지 않은 core에는 read가 없어 아무것도 하지 않는다.
async function sweepInterruptedInvocations(ctx: WiringContext): Promise<void> {
  const invocationRecovery =
    INVOCATION_RECOVERY_CONTEXT as unknown as RequestContext;
  const finishedAt = ctx.clock.now();
  for (const status of ["accepted", "running"] as const) {
    let cursor: string | undefined;
    do {
      const found = await ctx.runtime.readers.read(
        { resource: "invocations", method: "list" },
        invocationRecovery,
        { status, limit: 200, ...(cursor ? { cursor } : {}) },
      );
      if (!found.ok) return;
      const page = found.value as {
        invocations?: {
          id: string;
          status: "accepted" | "running";
          started_at: string | null;
        }[];
        next_cursor?: string | null;
      };
      for (const row of page.invocations ?? []) {
        await ctx.runtime.writer.command(invocationRecovery as never, {
          command: "invocation.record_finished",
          input: interruptedFinish(row, finishedAt),
          compare: {},
          idempotency_key: `interrupted:${row.id}`,
          prepared: [],
        });
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
}

// /v1/packages/guide_body. owner_kind·field가 `package_version`·`guide`로 고정이라 입력으로 다른 blob을
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
