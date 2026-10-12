// view exception 귀속(problems/reporting#R6, plan problems T16). 실제 core를 temp LOPHN_HOME으로 띄우고,
// 실제 collector entry를 자식 프로세스로 띄워 `/v1/problems/observe-view-error` route 뒤에 잇는다.
// binding은 그 core의 signer가 서명한 AppConnection이다. harness의 직접 insert는 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  encodeFrame,
  FrameDecoder,
} from "../../packages/protocol/server/mod.ts";
import type {
  AuthenticatedContext,
  WorkerRequest,
  WorkerResponse,
} from "../../packages/protocol/server/mod.ts";
import { manualClock, ok, seededRandom } from "../../packages/base/mod.ts";
import { createCoreSigner } from "../../packages/core/apps/runtime/signing.ts";
import { launchArgv } from "../../packages/core/supervision/security/mod.ts";
import type { WorkerRouteTarget } from "../../packages/core/supervision/responsiveness/mod.ts";
import { COLLECTOR_KIND, reportCollectorSpec } from "./problems-runner.ts";
import { startCore } from "./core.ts";
import { problemsReportDefinitions } from "./problems.ts";

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const AT = "2026-10-04T12:00:00.000Z";
const VIEW_APP = "app_01arz3ndektsv4rrffq69g5fav";
const OTHER_APP = "app_01arz3ndektsv4rrffq69g5fb0";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const BUNDLE = "a".repeat(64);

const collectorCredential: AuthenticatedContext = {
  principal: "collector-1",
  actor: "machine",
  scope: {
    operations: ["RecordReport", "GetReport"],
    targets: { task: "problems" },
  },
  conditions: { task: "problems", process: "collector-child" },
  credential_ref: "cred-view-collector",
};

// shell main의 user credential이다. 이 route의 actor는 user다.
const shellCredential: AuthenticatedContext = {
  principal: "user-1",
  actor: "user",
  scope: { operations: ["ObserveViewError"], targets: {} },
  conditions: {},
  credential_ref: "cred-view-shell",
};

function connection(app: string) {
  return {
    app,
    release: RELEASE,
    bundle_hash: BUNDLE,
    mode: "live" as const,
    process_nonce: "nonce-1",
    actor: `app:${app}`,
    credential_ref: "view-connection",
    screens: ["main"],
    screen_sizes: { main: ["full" as const] },
    caller: null,
    commands: [],
    expires_at: new Date(NOW_MS + 60_000).toISOString(),
  };
}

function body(reportId: string, binding: unknown) {
  return {
    view: {
      view_session: "view-1",
      generation: 1,
      app: OTHER_APP, // 페이지 주장. 무시된다.
      release: null,
      mode: "preview",
      bundle_hash: "b".repeat(64),
      binding: JSON.stringify(binding),
    },
    observation: {
      report_id: reportId,
      observed_at: AT,
      observation: "error",
      error: {
        name: "TypeError",
        message: "x is undefined",
        message_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "view_stack_not_collected" },
      },
      error_missing_reason: null,
      invocation: null,
    },
  };
}

// 감독 pipe 대신 child stdin·stdout으로 worker_request를 주고받는 route target이다.
function pipeTarget(child: Deno.ChildProcess, sent: WorkerRequest[]) {
  const writer = child.stdin.getWriter();
  const decoder = new FrameDecoder();
  const reader = child.stdout.getReader();
  const waiting = new Map<string, (response: WorkerResponse) => void>();
  let ready: () => void = () => {};
  const readyOnce = new Promise<void>((resolve) => ready = resolve);
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const frame of decoder.push(value)) {
        const record = frame as { kind: string; payload: WorkerResponse };
        if (record.kind !== "json") continue;
        const message = record.payload as { type: string };
        if (message.type === "ready") ready();
        if (message.type === "worker_response") {
          waiting.get(record.payload.request_id)?.(record.payload);
        }
      }
    }
  })();
  const send = (payload: unknown) =>
    writer.write(encodeFrame({ kind: "json", channel: 0, payload }));
  const target: WorkerRouteTarget = {
    handle: {
      observation: () => ({
        component: "problems/report-collector",
        available: true,
        observed_at: AT,
      }),
      async forward(request) {
        sent.push(request);
        const answer = new Promise<WorkerResponse>((resolve) =>
          waiting.set(request.request_id, resolve)
        );
        await send(request);
        return ok(await answer);
      },
    },
  };
  return { target, send, readyOnce };
}

async function post(port: number, path: string, token: string, value: unknown) {
  return await fetch(`http://127.0.0.1:${port}/v1/problems/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(value),
  });
}

Deno.test("problems/reporting#R6: core signer가 서명한 binding의 앱으로 접수하고 위조 binding은 없는 route처럼 거절하며 아무것도 기록하지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-view-binding-" });
  const spec = reportCollectorSpec({ dataRoot: home });
  assert(spec !== undefined);
  const sent: WorkerRequest[] = [];
  const holder: { target?: WorkerRouteTarget } = {};
  const lazy: WorkerRouteTarget = {
    handle: {
      observation: () => holder.target!.handle.observation(),
      forward: (request) => holder.target!.handle.forward(request),
    },
  };
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ problemsReportDefinitions }],
    teamModules: [new URL("./problems.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
    superviseIo: false,
    workers: new Map([["problems/observe-view-error", lazy]]),
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const collector = new Deno.Command(Deno.execPath(), {
    args: launchArgv(spec),
    env: {
      LOPHN_WORKER_KIND: spec.kind,
      LOPHN_HOME: home,
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  try {
    const collectorToken = "d".repeat(43);
    const shellToken = "e".repeat(43);
    assert(core.acceptTestCredential);
    for (
      const [context, token] of [
        [collectorCredential, collectorToken],
        [shellCredential, shellToken],
      ] as const
    ) {
      assert((await core.acceptTestCredential(context, token)).ok);
      assert((await core.record(context)).ok);
    }
    const piped = pipeTarget(collector, sent);
    holder.target = piped.target;
    await piped.send({
      type: "hello",
      core_epoch: core.epoch,
      process_identity: "view-binding",
      kind: COLLECTOR_KIND,
      task: "problems",
      scope: { operations: [], targets: { app: OTHER_APP, mode: "live" } },
      credential: collectorToken,
      api_port: core.port,
    });
    await piped.readyOnce;

    const signer = core.appsControl!.signer;
    const good = await signer.signConnection(connection(VIEW_APP));
    const goodId = "rpt_01arz3ndektsv4rrffq69g5fav";
    const accepted = await post(
      core.port,
      "observe-view-error",
      shellToken,
      body(goodId, good),
    );
    assertEquals(accepted.status, 200, await accepted.clone().text());
    const acceptance = await accepted.json();
    const get = async (report: string) =>
      await post(core.port, "get-report", collectorToken, { report });
    const row = await (await get(acceptance.report)).json();
    // 본문이 다른 앱·release·mode·bundle을 말해도 binding의 것만 남는다.
    assertEquals(row.report.app, VIEW_APP);
    assertEquals(row.report.mode, "live");
    assertEquals(row.report.release, RELEASE);
    assertEquals(row.report.bundle_hash, BUNDLE);

    // 다른 core의 signer가 서명한 binding은 worker에 닿지 않고 없는 route와 같이 거절된다.
    const forgedId = "rpt_01arz3ndektsv4rrffq69g5fb1";
    const forged = await (await createCoreSigner()).signConnection(
      connection(OTHER_APP),
    );
    const refused = await post(
      core.port,
      "observe-view-error",
      shellToken,
      body(forgedId, forged),
    );
    assertEquals(refused.status, 404);
    assertEquals((await refused.json()).error.code, "not_found");
    assertEquals(sent.length, 1);
    assert((await get(forgedId)).status !== 200);
  } finally {
    collector.kill();
    await collector.status;
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
