// collector → core 전 경로의 통합 테스트(problems/reporting#R1, R2, R16; plan
// problems T3). 실제 core를 시작하고, 감독이 띄우는 것과 같은 argv로 실제
// collector entry(report-collector.ts)를 자식 프로세스로 띄운다. hello frame에
// collector 위치를 넣고 worker_request를 넘긴 뒤, collector가 core
// record-report로 제출해서 Report·Problem ledger 행이 생기는지 HTTP read로
// 본다. harness의 fileLedger나 직접 insert는 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import { encodeFrame, FrameDecoder } from "../../../protocol/server/mod.ts";
import type {
  AuthenticatedContext,
  KindLaunchSpec,
} from "../../../protocol/server/mod.ts";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import { launchArgv } from "../../supervision/security/mod.ts";
import { COLLECTOR_KIND, reportCollectorSpec } from "../tests/runner.ts";
import { startCore } from "../../main/daemon/core.ts";
import { problemsReportDefinitions } from "../register.ts";

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const AT = "2026-10-04T12:00:00.000Z";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";

// collector 접수 scope operation은 route.name인 RecordReport다. 접수 뒤 읽기는 수리 조회
// 권한인 GetReport를 따로 가진 credential만 한다.
function credential(): AuthenticatedContext {
  return {
    principal: "collector-1",
    actor: "machine",
    scope: {
      operations: ["RecordReport", "GetReport"],
      targets: { task: "problems" },
    },
    conditions: { task: "problems", process: "collector-child" },
    credential_ref: "cred-collector-e2e",
  };
}

async function seedCredential(
  core: {
    acceptTestCredential?: (
      context: AuthenticatedContext,
      token: string,
    ) => Promise<{ ok: boolean; error?: { message: string } }>;
    record: (
      context: AuthenticatedContext,
    ) => Promise<{ ok: boolean; error?: { message: string } }>;
  },
  context: AuthenticatedContext,
  token: string,
): Promise<void> {
  assert(core.acceptTestCredential);
  const accepted = await core.acceptTestCredential(context, token);
  assert(accepted.ok, accepted.ok ? "" : accepted.error?.message ?? "");
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error?.message ?? "");
}

// 감독이 넘기는 것과 같은 env다(core.ts의 env callback 모양).
function spawnCollector(
  spec: KindLaunchSpec,
  home: string,
): Deno.ChildProcess {
  const command = new Deno.Command(Deno.execPath(), {
    args: launchArgv(spec),
    env: {
      LOPHN_WORKER_KIND: spec.kind,
      LOPHN_HOME: home,
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  return command.spawn();
}

// hello 뒤 worker_request를 넣고, 응답 frame을 순서대로 모은다.
async function pump(
  child: Deno.ChildProcess,
  frames: unknown[],
): Promise<unknown[]> {
  const writer = child.stdin.getWriter();
  const decoder = new FrameDecoder();
  const responses: unknown[] = [];
  const reader = child.stdout.getReader();
  void readStderr(child);
  const reads = (async () => {
    while (responses.length < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const frame of decoder.push(value)) {
        const record = frame as { kind: string; payload: unknown };
        if (record.kind === "json") responses.push(record.payload);
      }
    }
  })();
  await writer.write(
    encodeFrame({ kind: "json", channel: 0, payload: frames[0] }),
  );
  await writer.write(
    encodeFrame({ kind: "json", channel: 0, payload: frames[1] }),
  );
  await reads;
  reader.releaseLock();
  return responses;
}

async function readStderr(child: Deno.ChildProcess): Promise<void> {
  const reader = child.stderr.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch { /* 끝난 스트림 */ }
  const total = chunks.reduce((sum, value) => sum + value.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  if (total > 0) console.error("STDERR", new TextDecoder().decode(merged));
}

Deno.test("problems/reporting#R1 R2 R16: 실제 collector entry가 실제 core record-report로 Report·Problem ledger 행을 만든다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-collector-e2e-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ problemsReportDefinitions }],
    teamModules: [new URL("../register.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const spec = reportCollectorSpec({ dataRoot: home });
  assert(spec !== undefined);
  await using collector = spawnCollector(spec, home);
  try {
    const token = "d".repeat(43);
    await seedCredential(core, credential(), token);

    // hello frame: 감독이 넘기는 것과 같은 위치다(core_epoch는 시작 core 값).
    // app credential 주장(app·release·process·mode)은 hello scope targets에서 온다.
    const ready = await pump(collector, [
      {
        type: "hello",
        core_epoch: core.epoch,
        process_identity: "collector-e2e",
        kind: COLLECTOR_KIND,
        task: "problems",
        scope: {
          operations: [],
          targets: {
            app: APP,
            release: RELEASE,
            process: "collector-e2e",
            mode: "live",
            bundle_hash: "a".repeat(64),
          },
        },
        credential: token,
        api_port: core.port,
      },
      {
        type: "worker_request",
        request_id: "cred-collector-e2e/1",
        op: "ReportProblem",
        payload: {
          report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
          code: "save_failed",
          observed_at: AT,
        },
      },
    ]);
    assertEquals(ready.length, 2, JSON.stringify(ready));
    const first = ready[0] as { type: string };
    assertEquals(first.type, "ready");
    const acceptance = ready[1] as {
      type: string;
      request_id?: string;
      ok: boolean;
      payload?: {
        report: string;
        snapshot: string;
        problem: string | null;
        diagnostic_scope: string | null;
      };
      error?: { code: string; message: string };
    };
    assertEquals(acceptance.type, "worker_response");
    assert(acceptance.request_id !== undefined);
    assertEquals(acceptance.ok, true, JSON.stringify(acceptance));
    assert(acceptance.payload !== undefined, JSON.stringify(acceptance));
    assert(acceptance.payload.problem !== null);
    assert(acceptance.payload.problem.length > 0);

    // read는 reader Worker 풀의 reporting read로 닿는다(#142).
    const get = await fetch(
      `http://127.0.0.1:${core.port}/v1/problems/get-report`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ report: acceptance.payload.report }),
      },
    );
    assertEquals(get.status, 200, await get.clone().text());
    const row = await get.json();
    assertEquals(row.report.id, acceptance.payload.report);
    assertEquals(row.report.problem, acceptance.payload.problem);
    assertEquals(row.snapshot.id, acceptance.payload.snapshot);
    // bundle_hash 주장은 credential(hello scope targets)에서만 온다(T3).
    assertEquals(row.report.bundle_hash, "a".repeat(64));
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
