import { err, ok, type Result } from "../../../../base/mod.ts";
import type { RequestContext } from "../../../../protocol/server/mod.ts";
import { reportBody } from "../../../../protocol/problems/mod.ts";
import {
  type ChildBlobPolicy,
  createChildBlobPrepare,
} from "../../../storage/blobs/child-prepare.ts";
import { problemsReportDefinitions } from "../../../problems/register.ts";
import { authorize } from "../../../server/identity/mod.ts";
import {
  COLLECTOR_CREDENTIAL_OPERATIONS,
  COLLECTOR_ROUTES,
  collectorOperationPolicies,
  collectorWorkers,
} from "../../../problems/reporting/collector.ts";
import { withViewBinding } from "../../../problems/reporting/view-binding.ts";
import { snapshotLogsEnvironment } from "../../../problems/snapshots/logs-read.ts";
import type { SnapshotLogsEnvironment } from "../../../problems/snapshots/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import {
  COLLECTOR_KIND,
  reportCollectorSpec,
} from "../../../problems/tests/runner.ts";
import { blobReadHandler, currentCredential } from "../runtime.ts";
import {
  createProductRedactor,
  createWorkerChannel,
  type WiringContext,
  type WiringFactory,
} from "./context.ts";

// collector 자식이 준비할 수 있는 purpose와 상한. 상한은 purpose를 등록한 problems report 정의의 max_size_bytes다.
const REPORT_PURPOSE_CAPS = new Map<string, number>(
  problemsReportDefinitions.blobPurposes.map((
    purpose,
  ) => [purpose.purpose, purpose.max_size_bytes] as const),
);
const COLLECTOR_BLOB_POLICY: ChildBlobPolicy = {
  // registerBlobs 원주체 검사: report.principal과 준비 principal이 같아야 한다.
  principal: "collector",
  purposes: new Map(
    [
      "report_text",
      "report_details",
      "snapshot_stack",
      "snapshot_logs",
      "feedback_state",
      "feedback_screenshot",
    ].flatMap((purpose) => {
      const cap = REPORT_PURPOSE_CAPS.get(purpose);
      return cap === undefined ? [] : [[purpose, cap] as const];
    }),
  ),
};

export const problemsWiring: WiringFactory = () => {
  // problems report collector 요청 통로. 같은 통로 모양을 쓴다.
  const collectorChannel = createWorkerChannel();
  let closeCollectorBlob: (() => void) | undefined;
  let snapshotLogs: SnapshotLogsEnvironment | undefined;
  return {
    name: "problems",
    // problems의 GetSnapshotLogs 읽기 통로. 바이트 통로는 relay가 뜬 뒤 채워진다.
    environment: (ctx) => {
      snapshotLogs = snapshotLogsEnvironment({
        ledgerPath: ctx.ledgerPath,
        read: (hash, offset, length) =>
          ctx.blobRead.deps.read(hash, offset, length),
      });
      return { snapshotLogs };
    },
    // problems report collector(machine)가 보고를 제출한다.
    operations: () => collectorOperationPolicies(),
    build(ctx) {
      return ok({
        // 보고의 사람 글·log·화면 상태만 읽는 좁은 route. 일반 `blobs/read`는 coding 연결에 열지 않는다.
        reads(reads) {
          reads.set(
            `${reportBody.resource}/${reportBody.method}`,
            (context, body) =>
              reportBodyHandler(ctx, snapshotLogs, context, body),
          );
        },
        // 문제 collector route의 view 출처는 binding 검증 뒤에만 worker로 닿는다.
        workers: new Map(withViewBinding(
          collectorWorkers({
            channel: collectorChannel,
            observation: () => ctx.io.observation(COLLECTOR_KIND),
            callerOf: (request) => {
              const slash = request.request_id.lastIndexOf("/");
              const current = slash > 0
                ? ctx.runtime.current(request.request_id.slice(0, slash))
                : undefined;
              return current?.ok
                ? {
                  actor: current.value.actor,
                  conditions: current.value.conditions,
                }
                : undefined;
            },
          }),
          {
            signer: ctx.appsControl.signer,
            nowMs: () => ctx.clock.nowMs(),
          },
        )),
      });
    },
    async start(ctx) {
      await startCollector(ctx, collectorChannel, (close) => {
        closeCollectorBlob = close;
      });
      return ok(undefined);
    },
    closeIntake() {
      closeCollectorBlob?.();
    },
  };
};

// problems/report-collector. 문제 보고 worker route(`/problems/report` 등)를 받는 상시
// worker다. problems를 등록하지 않은 조립은 띄우지 않는다. 띄우지
// 못해도 core는 계속 선다: 그 route는 unavailable이다. 앱 위치 주장은 요청이 싣는다.
async function startCollector(
  ctx: WiringContext,
  channel: ReturnType<typeof createWorkerChannel>,
  onClose: (close: () => void) => void,
): Promise<void> {
  const collectorSpec = reportCollectorSpec({ dataRoot: ctx.root.path });
  if (
    !collectorSpec ||
    !ctx.allRoutes.some((route) => route.name === COLLECTOR_ROUTES[0].name)
  ) return;
  const issued = await ctx.registry.issue({
    actor: "machine",
    // 준비 참조의 주체(child-blob-prepare 정책)와 Report의 원주체가 이 값과 같아야 등록된다.
    principal: "collector",
    scope: {
      operations: [...COLLECTOR_CREDENTIAL_OPERATIONS],
      targets: { task: "problems" },
    },
    conditions: { task: "problems", process: COLLECTOR_KIND },
  });
  const current = issued.ok
    ? ctx.registry.revalidate({
      credential_ref: issued.value.credential_ref,
    })
    : issued;
  const recorded = issued.ok && current.ok
    ? await ctx.runtime.record(current.value)
    : current;
  if (!(issued.ok && recorded.ok)) return;
  // collector의 blob 준비 요청(보고 text·details·stack·log)은 core.prepareBlob으로 간다.
  const handler = createChildBlobPrepare({
    kind: COLLECTOR_KIND,
    gauge: ctx.blobBuffer,
    send: (message) =>
      ctx.io.send(COLLECTOR_KIND, message).then((sent) => sent.ok),
    prepareBlob: (call) => ctx.blobRelay.prepare(call),
    policies: new Map([[COLLECTOR_KIND, COLLECTOR_BLOB_POLICY]]),
  });
  onClose(() => handler.close());
  const started = await ctx.io.start(
    collectorSpec,
    {
      type: "hello",
      core_epoch: ctx.epoch,
      process_identity: ctx.epoch,
      kind: COLLECTOR_KIND,
      task: "problems",
      scope: { operations: [], targets: {} },
      credential: issued.value.token,
      api_port: ctx.server.port,
    },
    {
      onMessage: (message) => {
        if (!handler.onMessage(message)) channel.onMessage(message);
      },
      onFrame: (frame) => handler.onFrame(frame),
    },
  );
  if (started.ok) {
    channel.bind((payload) =>
      ctx.io.send(COLLECTOR_KIND, payload).then((sent) => sent.ok)
    );
  }
}

// /problems/report_body. owner_kind가 `report`로 고정이고 field는 사람 글·log·화면 상태뿐이다.
// 보고는 이 자격으로 `problem.get_occurrence`가 읽을 수 있어야 하고(없는 대상과 범위 밖은 같은 not_found), 바이트를
// 읽기 시작할 때와 반환 직전에 보고의 앱·문제 target을 현재 credential로 다시 검사한다. 글은 core
// 알려진 값 pipe를 지난 것만 내보낸다(끝내지 못하면 unavailable).
async function reportBodyHandler(
  ctx: WiringContext,
  snapshotLogs: SnapshotLogsEnvironment | undefined,
  context: RequestContext,
  body: unknown,
): Promise<Result<unknown>> {
  const parsed = reportBody.input.safeParse(body);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "본문 읽기 입력이 올바르지 않다",
    });
  }
  const notFound: Result<never> = err({
    code: "not_found",
    message: "대상을 찾을 수 없다",
  });
  // 볼 수 있는 발생인지는 problem.get_occurrence의 판정을 그대로 쓴다.
  if (snapshotLogs?.view === undefined) {
    return err({ code: "unavailable", message: "발생 읽기가 붙어 있지 않다" });
  }
  const found = await snapshotLogs.view(context, {
    report: parsed.data.report,
  });
  if (!found.ok) {
    return found.error.code === "unavailable" ? found : notFound;
  }
  const target = reportTarget(ctx.ledgerPath, parsed.data.report);
  if (target === undefined) return notFound;
  const blob = ctx.blobRead.deps;
  const source = {
    ...blob,
    // 이 route만 이 field들을 읽는다. 일반 읽기의 field 정의는 그대로다.
    fields: blob.fields.map((field) =>
      field.owner_kind === "report" && field.field === parsed.data.field
        ? { ...field, general_read: true }
        : field
    ),
  };
  const read = await blobReadHandler(
    ctx.ledgerPath,
    source,
    context,
    {
      owner_kind: "report",
      owner_key: parsed.data.report,
      field: parsed.data.field,
      offset_bytes: parsed.data.offset_bytes,
      length_bytes: parsed.data.length_bytes,
    },
    (current) => {
      const live = currentCredential(ctx.ledgerPath, current.credential_ref);
      return live.ok ? authorize(live.value, reportBody.name, target) : live;
    },
  );
  if (!read.ok) return read.error.code === "unavailable" ? read : notFound;
  const value = read.value as {
    status: string;
    reason?: string;
    bytes?: string;
    truncated?: boolean;
  };
  if (value.status !== "available" || value.bytes === undefined) {
    return ok({ status: "unavailable", reason: value.reason ?? value.status });
  }
  const raw = new TextDecoder().decode(
    Uint8Array.from(atob(value.bytes), (char) => char.charCodeAt(0)),
  );
  const safe = createProductRedactor(ctx.knownSecrets)(
    {
      concern: "coding-agent/repair-context",
      revision: "1",
      scope: "report-body",
    },
    "text/plain",
    raw,
  );
  if (safe === null) {
    return err({ code: "unavailable", message: "redaction을 끝내지 못했다" });
  }
  return ok({
    status: "available",
    text: safe,
    truncated: value.truncated === true,
  });
}

// 보고가 붙은 앱과 문제다. 문제에 붙지 않은 보고는 없다.
function reportTarget(
  ledgerPath: string,
  report: string,
): { app: string; problem: string } | undefined {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return undefined;
  try {
    const row = opened.value.sql.get(
      "select app, problem from reports where id = ?",
      [report],
    );
    return row === undefined || row["problem"] === null
      ? undefined
      : { app: String(row["app"]), problem: String(row["problem"]) };
  } catch {
    return undefined;
  } finally {
    opened.value.close();
  }
}
