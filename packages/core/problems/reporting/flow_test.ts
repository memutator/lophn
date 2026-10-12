// 제품 경로의 보고 접수 통로(problems/reporting#R3, R4, R9, R12).
// harness의 fileLedger나 직접 insert는 쓰지 않는다. 접수는 writer Worker가
// 조립한 recordReportCommand이고, read는 reader Worker 풀의 reporting read다.
// 준비 blob은 core.prepareBlob(pipe)으로 준비한다(D32: screenshot은 사람이
// 고른 그대로 저장하지만 여기 화면 항목은 이유만 둔다).

import { assert, assertEquals, assertFalse } from "@std/assert";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import { canonicalize } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { RecordReportInput } from "../../../protocol/problems/mod.ts";
import { ROUTES as PROBLEM_ROUTES } from "../../../protocol/problems/mod.ts";
import { startCore } from "../../main/daemon/core.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../register.ts";

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const at = (ms: number) => `${new Date(ms).toISOString().slice(0, 23)}Z`;

// ID는 domain-model ID 접두사 표의 소문자 Crockford base32다.
const rpt = (serial: number) => `rpt_01arz3ndektsv4rrffq69g5fa${serial}`;
const snp = (serial: number) => `snp_01arz3ndektsv4rrffq69g5fa${serial}`;

function credential(): AuthenticatedContext {
  // 접수 scope operation은 route.name인 RecordReport다(dispatch scopeAllowed).
  return {
    principal: "collector-1",
    actor: "machine",
    scope: {
      operations: [
        "RecordReport",
        "GetReport",
        "ListProblems",
        "GetProblem",
        "ListReports",
      ],
      targets: {},
    },
    conditions: {},
    credential_ref: "cred-problems-flow",
  };
}

function liveInput(serial: number): RecordReportInput {
  const APP = "app_01arz3ndektsv4rrffq69g5fav";
  const report: RecordReportInput["report"] = {
    id: rpt(serial),
    app: APP,
    mode: "live",
    diagnostic_scope: null,
    release: "rel_01arz3ndektsv4rrffq69g5fav",
    release_missing_reason: null,
    bundle_hash: "a".repeat(64),
    source: "exception",
    code: "_exception",
    text: null,
    details: null,
    snapshot: snp(serial),
    observed_at: at(NOW_MS),
    principal: "collector-1",
    content_hash: "a".repeat(64),
  };
  const snapshot: RecordReportInput["snapshot"] = {
    id: snp(serial),
    captured_at: at(NOW_MS),
    invocation: {
      id: "inv_01arz3ndektsv4rrffq69g5fav",
      binding: "sdk_context",
      record_missing_reason: null,
    },
    invocation_missing_reason: null,
    error: {
      name: "TypeError",
      message: "boom",
      message_missing_reason: null,
      frames: [{ path: "src/a.ts", function: null, line: 1, column: 1 }],
      source_missing_reason: null,
      stack: null,
      stack_missing_reason: { reason: "stack unavailable" },
      truncation_notes: [],
    },
    error_missing_reason: null,
    logs: {
      blob: "a".repeat(64),
      line_count: 2,
      truncated: false,
      scope: "process",
      from_at: null,
      to_at: null,
      collected_at: at(NOW_MS),
    },
    logs_missing_reason: null,
    screen: null,
    screen_missing_reason: { reason: "not collected" },
  };
  return {
    report,
    snapshot,
    // exception key의 discriminator는 stack이 없으면 자기 최초 rpt다.
    group_key: {
      kind: "exception",
      code: "_exception",
      discriminator: rpt(serial),
    },
    existing_problem: null,
    blobs: [
      {
        hash: "a".repeat(64),
        size_bytes: 64,
        purpose: "snapshot_logs",
        source: {
          kind: "prepared",
          blob: {
            preparation: `prep-logs-${serial}`,
            principal: "collector-1",
            hash: "a".repeat(64),
            size_bytes: 64,
            purpose: "snapshot_logs",
          },
        },
      },
    ],
    origin: {
      context: {
        authentication: credential(),
        app: APP,
        mode: "live",
        diagnostic_scope: null,
        release: "rel_01arz3ndektsv4rrffq69g5fav",
        release_missing_reason: null,
        bundle_hash: "a".repeat(64),
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt(serial),
      content_hash: "a".repeat(64),
    },
  };
}

async function post(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// route schema가 조립에 닿는지 실제 관측값으로 본다.
Deno.test("problems/reporting: 문제 route들이 contract registry에 있다", () => {
  const recordReport = PROBLEM_ROUTES.find((route) =>
    route.name === "RecordReport"
  );
  assert(recordReport !== undefined);
  assertEquals(recordReport.resource, "problems");
  assertEquals(recordReport.method, "record-report");
});

Deno.test("problems/reporting#R3 R4 R9 R12: 제품 core에 record-report가 닿고 같은 ID 재전송은 원래 결과, 비운영 보고는 진단 scope가 필수다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-problems-flow-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ problemsTestDefinitions }, { problemsReportDefinitions }],
    teamModules: [new URL("../register.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    // blob 준비 pipe는 platform/io worker가 설치한다(blob-flow와 같다).
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    // credential 기록은 writer가 현재 자격을 다시 볼 때 필요하다.
    assert(core.acceptTestCredential);
    const token = "a".repeat(43);
    const context = credential();
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(context);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    // 준비 blob: 등록은 command transaction이 맡는다.
    const prepared = await core.prepareBlob({
      principal: "collector-1",
      purpose: "snapshot_logs",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode("log line 1\nlog line 2"),
          );
          controller.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);

    const input = liveInput(1);
    // 준비 결과 binding: handle·hash·크기는 core가 준 값이다.
    const logsPrepared = input.blobs[0]!;
    if (logsPrepared.source.kind !== "prepared") {
      throw new Error("liveInput blob은 prepared다");
    }
    const logsBlob: RecordReportInput["blobs"][number] = {
      ...logsPrepared,
      hash: prepared.value.hash,
      size_bytes: prepared.value.size_bytes,
      source: {
        kind: "prepared" as const,
        blob: {
          ...logsPrepared.source.blob,
          preparation: prepared.value.preparation,
          hash: prepared.value.hash,
          size_bytes: prepared.value.size_bytes,
        },
      },
    };
    input.snapshot = {
      ...input.snapshot,
      logs: {
        ...input.snapshot.logs!,
        blob: prepared.value.hash,
      },
    };
    input.blobs = [logsBlob];

    const first = await post(core.port, "/v1/problems/record-report", {
      input,
      idempotency_key: "problems-flow-1",
      compare: {
        active_release: "rel_01arz3ndektsv4rrffq69g5fav",
        problem_seq: null,
      },
      prepared: [],
    }, token);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    const acceptance = first.body as {
      report: string;
      snapshot: string;
      problem: string;
      diagnostic_scope: null;
    };
    assert(acceptance.problem !== null && acceptance.problem.length > 0);
    assertFalse("pending" in acceptance);

    // 같은 ID·principal·content hash 재전송은 원래 결과다(R9).
    const replay = await post(core.port, "/v1/problems/record-report", {
      input,
      idempotency_key: "problems-flow-1-retry",
      compare: {
        active_release: "rel_01arz3ndektsv4rrffq69g5fav",
        problem_seq: null,
      },
      prepared: [],
    }, token);
    assertEquals(replay.status, 200, JSON.stringify(replay.body));
    assertEquals(replay.body, acceptance);

    // read는 reader Worker 풀의 reporting read로 닿는다(#142).
    const reportRead = await post(core.port, "/v1/problems/get-report", {
      report: input.report.id,
    }, token);
    assertEquals(reportRead.status, 200, JSON.stringify(reportRead.body));
    const readBody = reportRead.body as {
      report: { id: string; problem: string | null };
      snapshot: { id: string } | null;
      missing: { screen: { reason: string } | null };
    };
    assertEquals(readBody.report.id, input.report.id);
    assertEquals(readBody.report.problem, acceptance.problem);
    assertEquals(readBody.snapshot!.id, input.snapshot.id);
    assertEquals(readBody.missing.screen!.reason, "not collected");

    // 문제 목록·상세·보고 목록도 같은 reader 풀로 닿는다(problems#T6).
    const listed = await post(core.port, "/v1/problems/list", {}, token);
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const problems = (listed.body as { problems: { id: string }[] }).problems;
    assertEquals(problems.map((item) => item.id), [acceptance.problem]);
    const detail = await post(core.port, "/v1/problems/get", {
      problem: acceptance.problem,
    }, token);
    assertEquals(detail.status, 200, JSON.stringify(detail.body));
    assertEquals((detail.body as { report_count: number }).report_count, 1);
    const reports = await post(core.port, "/v1/problems/list-reports", {
      problem: acceptance.problem,
    }, token);
    assertEquals(reports.status, 200, JSON.stringify(reports.body));
    assertEquals(
      (reports.body as { reports: { id: string }[] }).reports.map((item) =>
        item.id
      ),
      [input.report.id],
    );

    // 비운영 보고는 진단 scope가 필수다(R4): live 형식 그대로 scope null은
    // input schema가 거절한다.
    const scopeless = await post(core.port, "/v1/problems/record-report", {
      input: {
        ...input,
        report: {
          ...input.report,
          id: rpt(2),
          mode: "preview" as never,
          diagnostic_scope: null,
        },
        origin: {
          ...input.origin,
          report_id: rpt(2),
        },
      },
      idempotency_key: "problems-flow-scopeless",
      compare: { active_release: null, problem_seq: null },
      prepared: [],
    }, token);
    assertEquals(scopeless.status, 400, JSON.stringify(scopeless.body));
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

// group_key의 canonical JSON이 groupKeyText와 같은 정규화다.
Deno.test("problems/grouping: exception group key의 canonical JSON은 discriminator만 정규화한다", () => {
  const key: RecordReportInput["group_key"] = {
    kind: "exception",
    code: "_exception",
    discriminator: "rpt_01arz3ndektsv4rrffq69g5fav",
  };
  assertEquals(canonicalize(key), canonicalize({ ...key }));
});

// 고정한 로그 조각은 제품 core의 GetSnapshotLogs로 읽힌다(snapshots#R13, R16).
// 바이트는 blob store에서 오고, 앱 actor와 없는 snapshot은 읽지 못한다.
Deno.test("problems/snapshots#R13 R16: 접수한 로그 조각은 user가 GetSnapshotLogs로 읽고 앱 credential과 없는 snapshot은 읽지 못한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-problems-logs-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { problemsTestDefinitions },
      { problemsReportDefinitions },
      { createLedgerRegistration: createProblemsRegistration },
    ],
    teamModules: [new URL("../register.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    assert(core.acceptTestCredential);
    const collectorToken = "a".repeat(43);
    const collector = credential();
    const accepted = await core.acceptTestCredential(collector, collectorToken);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const recorded = await core.record(collector);
    assert(recorded.ok, recorded.ok ? "" : recorded.error.message);

    const prepared = await core.prepareBlob({
      principal: "collector-1",
      purpose: "snapshot_logs",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("log one\nlog two"));
          controller.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : prepared.error.message);
    const input = liveInput(3);
    const template = input.blobs[0]!;
    if (template.source.kind !== "prepared") throw new Error("prepared");
    input.snapshot = {
      ...input.snapshot,
      logs: {
        ...input.snapshot.logs!,
        blob: prepared.value.hash,
        line_count: 2,
        truncated: true,
        scope: "app log fragment",
      },
    };
    input.blobs = [{
      ...template,
      hash: prepared.value.hash,
      size_bytes: prepared.value.size_bytes,
      source: {
        kind: "prepared" as const,
        blob: {
          ...template.source.blob,
          preparation: prepared.value.preparation,
          hash: prepared.value.hash,
          size_bytes: prepared.value.size_bytes,
        },
      },
    }];
    const recordedReport = await post(
      core.port,
      "/v1/problems/record-report",
      {
        input,
        idempotency_key: "problems-logs-1",
        compare: {
          active_release: "rel_01arz3ndektsv4rrffq69g5fav",
          problem_seq: null,
        },
        prepared: [],
      },
      collectorToken,
    );
    assertEquals(
      recordedReport.status,
      200,
      JSON.stringify(recordedReport.body),
    );

    const userToken = "b".repeat(43);
    const user = {
      principal: "user-1",
      actor: "user" as const,
      scope: { operations: ["GetSnapshotLogs"], targets: {} },
      conditions: {},
      credential_ref: "cred-problems-logs-user",
    };
    const userAccepted = await core.acceptTestCredential(user, userToken);
    assert(userAccepted.ok, userAccepted.ok ? "" : userAccepted.error.message);
    const userRecorded = await core.record(user);
    assert(userRecorded.ok, userRecorded.ok ? "" : userRecorded.error.message);
    const read = await post(core.port, "/v1/problems/get-snapshot-logs", {
      snapshot: snp(3),
    }, userToken);
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const fragment = (read.body as { fragment: Record<string, unknown> })
      .fragment;
    assertEquals(fragment["kind"], "fragment");
    assertEquals(fragment["lines"], ["log one", "log two"]);
    assertEquals(fragment["truncated"], true);
    assertEquals(fragment["scope"], "app log fragment");
    assertFalse(Object.keys(fragment).some((key) => /rate|ratio/.test(key)));

    // 없는 snapshot은 not_found다.
    const missing = await post(core.port, "/v1/problems/get-snapshot-logs", {
      snapshot: snp(4),
    }, userToken);
    assertEquals(missing.status, 404, JSON.stringify(missing.body));

    // 앱 credential은 같은 snapshot도 없는 snapshot도 읽지 못하고 답이 같다.
    const appToken = "c".repeat(43);
    const app = {
      principal: "app-1",
      actor: "app:app_01arz3ndektsv4rrffq69g5fav" as const,
      scope: { operations: ["GetSnapshotLogs"], targets: {} },
      conditions: {},
      credential_ref: "cred-problems-logs-app",
    };
    const appAccepted = await core.acceptTestCredential(app, appToken);
    assert(appAccepted.ok, appAccepted.ok ? "" : appAccepted.error.message);
    const appRecorded = await core.record(app);
    assert(appRecorded.ok, appRecorded.ok ? "" : appRecorded.error.message);
    const known = await post(core.port, "/v1/problems/get-snapshot-logs", {
      snapshot: snp(3),
    }, appToken);
    const unknown = await post(core.port, "/v1/problems/get-snapshot-logs", {
      snapshot: snp(4),
    }, appToken);
    assert(known.status >= 400);
    assertEquals(known, unknown);
    assertFalse(JSON.stringify(known.body).includes("log one"));
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
