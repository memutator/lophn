// 접수된 RequestTest가 제품 core에서 실제로 돈다(problems/tests#R1, R2, R4, R5, R17, R21; plan problems#T12 후속).
// 제품과 같은 감독으로 core를 temp LOPHN_HOME에 띄우고(사람 데이터 root는 열지 않는다), 깨지는 fixture 앱을
// 등록·봉인한 뒤 API로 RequestTest를 보내 runner가 실제 앱 자식·test 자식으로 돌리는지, 앱 보고가 collector에
// mode=test로 닿는지, 결과가 실제 RecordVerification으로 남는지, runner를 시작하지 못한 요청과 core 재시작 중에
// 끊긴 요청이 이유와 함께 끝나는지 본다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import { prepareFromSource } from "../../apps/releases/prepare/from-source.ts";
import { installedHome } from "../../apps/packages/testing/mod.ts";
import { deriveAppTest } from "./mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../projects/register.ts";
import { lophnAgentDefinitions } from "../../lophn-agent/register.ts";
import { type Core, startCore } from "../../main/daemon/core.ts";
import {
  createLedgerRegistration as createProblemsRegistration,
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../register.ts";
import { madeFixture } from "../../testing/problems-app-test.ts";

// 앱 등록은 documents의 place 이름 공간과 lophn-agent의 지침 판정 port를 함께 쓴다. 제품 기동처럼 함께 띄운다.
const TEAMS = [
  { lophnAgentDefinitions },
  { createLedgerRegistration: createDocumentsRegistration },
  { problemsTestDefinitions },
  { problemsReportDefinitions },
  { createLedgerRegistration: createProblemsRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const MODULES = [
  new URL("../../lophn-agent/register.ts", import.meta.url).href,
  new URL("../../projects/register.ts", import.meta.url).href,
  new URL("../register.ts", import.meta.url).href,
  new URL("../../apps/register.ts", import.meta.url).href,
];
const CREATOR = "c".repeat(43);
const REQUESTER = "r".repeat(43);

async function boot(home: string): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: TEAMS,
    teamModules: MODULES,
    // 제품 기동과 같이 시스템 시계다(준비 참조의 10분 수명은 core와 writer가 같은 시계로 잰다).
    writerClock: "system",
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  return started.value;
}

async function accept(
  core: Core,
  context: AuthenticatedContext,
  token: string,
): Promise<void> {
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
}

async function post(
  core: Core,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch { /* JSON이 아니다 */ }
  return { status: response.status, body: json };
}

const command = (input: unknown, key: string) => ({
  input,
  idempotency_key: key,
  compare: {},
  prepared: [],
});

type Request = {
  accepted: boolean;
  preparation_failed: boolean;
  start_attempted_at: string | null;
  started_at: string | null;
  start_unknown: boolean;
  result_ref: string | null;
  reason: string;
};

async function readRequest(core: Core, key: string): Promise<Request> {
  const read = await post(
    core,
    "problems/get-test-request",
    { request_key: key },
    REQUESTER,
  );
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body.request as Request;
}

async function until(
  core: Core,
  key: string,
  done: (request: Request) => boolean,
  limitMs: number,
): Promise<Request> {
  const deadline = Date.now() + limitMs;
  let last: Request | undefined;
  while (Date.now() < deadline) {
    last = await readRequest(core, key);
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`요청이 기한 안에 끝나지 않았다: ${JSON.stringify(last)}`);
}

const ended = (request: Request) =>
  request.result_ref !== null || request.preparation_failed ||
  request.start_unknown;

Deno.test("problems/tests#R1 R2 R4 R5 R17 R21: 접수한 RequestTest를 제품 core의 runner가 실제로 돌려 Verification을 남기고, 시작하지 못한 요청과 재시작 중 끊긴 요청은 이유와 함께 끝난다", async () => {
  const installed = await installedHome();
  const made = await madeFixture("broken", installed);
  const home = installed.home;
  let core = await boot(home);
  try {
    // 앱을 등록하고(실제 API) 같은 temp home에 봉인 bundle을 만든다.
    await accept(core, {
      principal: "user-1",
      actor: "user",
      scope: { operations: ["app.create"], targets: {} },
      conditions: {},
      credential_ref: "cred-creator",
    }, CREATOR);
    const created = await post(
      core,
      "apps/create",
      command(
        { slug: "broken", name: "broken", description: "fixture" },
        "create-broken",
      ),
      CREATOR,
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body.id);
    const sealed = await prepareFromSource({
      dataRoot: home,
      app,
      sourceRoot: made.dir,
      commit: await made.commit(),
    });
    assert(sealed.ok, sealed.ok ? "" : JSON.stringify(sealed.error));
    const bundleHash = sealed.value.bundleHash;
    const derived = await deriveAppTest(sealed.value.copyPath, bundleHash);
    assert(derived.ok, derived.ok ? "" : derived.reason);
    const requesterContext: AuthenticatedContext = {
      principal: "user-1",
      actor: "user",
      scope: {
        operations: [
          "RequestTest",
          "GetTestRequest",
          "GetVerification",
          "ListVerifications",
        ],
        targets: { app },
      },
      conditions: { app },
      credential_ref: "cred-requester",
    };
    await accept(core, requesterContext, REQUESTER);
    const requestFor = (key: string, test: string, bundle = bundleHash) => ({
      request_key: key,
      kind: "app_test",
      app,
      target: { bundle_hash: bundle, release: null },
      problem: null,
      basis_seq: null,
      reports: [],
      before: null,
      after: null,
      ticket: null,
      test,
      timeout_ms: 240_000,
    });
    const send = async (key: string, test: string, bundle?: string) => {
      const sent = await post(
        core,
        "problems/request-test",
        command(requestFor(key, test, bundle), `send-${key}`),
        REQUESTER,
      );
      assertEquals(sent.status, 200, JSON.stringify(sent.body));
      assertEquals(sent.body.accepted, true);
      return sent.body;
    };

    // 1) 시작하지 못하는 요청: 고정 시험 hash가 bundle에서 만든 것과 다르거나 bundle 사본이 없다. 실행하지 않고
    // 이유와 함께 끝난다. Verification은 없다(성공으로 꾸미지 않는다).
    await send("wrong-test", "f".repeat(64));
    const wrong = await until(core, "wrong-test", ended, 60_000);
    assertEquals(wrong.preparation_failed, true);
    assertEquals(wrong.start_attempted_at, null);
    assertEquals(wrong.result_ref, null);
    assert(wrong.reason.trim() !== "" && wrong.reason !== "accepted");
    await send("no-bundle", derived.value.test_hash, "a".repeat(64));
    const missing = await until(core, "no-bundle", ended, 60_000);
    assertEquals(missing.preparation_failed, true);
    assertEquals(missing.result_ref, null);
    assert(missing.reason.includes("bundle"));

    // 2) 정상 요청: runner가 실제로 시작하고 결과가 실제 RecordVerification으로 남는다.
    await send("full-run", derived.value.test_hash);
    const done = await until(core, "full-run", ended, 600_000);
    assertEquals(done.preparation_failed, false);
    assert(done.start_attempted_at !== null);
    assert(done.started_at !== null);
    assert(done.result_ref !== null, JSON.stringify(done));
    const read = await post(
      core,
      "problems/get-verification",
      { verification: done.result_ref, detail: false },
      REQUESTER,
    );
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const verification = read.body.verification as Record<string, unknown>;
    assertEquals(verification.kind, "app_test");
    assertEquals(verification.app, app);
    assertEquals(
      (verification.target as { bundle_hash: string }).bundle_hash,
      bundleHash,
    );
    assertEquals(verification.test, derived.value.test_hash);
    // 화면 검사 host가 없으면 화면 있는 앱은 통과하지 못한다. 어느 쪽이든 판정은 실제 관측이 정한다.
    assert(["pass", "fail"].includes(String(verification.result)));
    // 앱의 보고가 collector에 mode=test와 요청 scope로 닿았고 운영 문제에 묶이지 않았다.
    const ledger = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    try {
      const reports = ledger.prepare(
        `select code, mode, diagnostic_scope, problem from reports where app = ?`,
      ).all(app) as {
        code: string;
        mode: string;
        diagnostic_scope: string | null;
        problem: string | null;
      }[];
      assert(reports.length > 0, "collector가 받은 보고가 없다");
      for (const report of reports) {
        assertEquals(report.mode, "test");
        assertEquals(report.diagnostic_scope, "app-test-full-run");
        assertEquals(report.problem, null);
      }
      assert(reports.some((report) => report.code === "fixture_broken"));
    } finally {
      ledger.close();
    }

    // 3) 시작한 뒤 core가 멈추고 다시 뜬다: 다시 돌리지 않고 이어받아 runner_lost inconclusive로 끝난다.
    await send("lost-run", derived.value.test_hash);
    await until(
      core,
      "lost-run",
      (request) => request.started_at !== null || ended(request),
      300_000,
    );
    const midway = await readRequest(core, "lost-run");
    assertEquals(midway.result_ref, null, "재시작 전에 이미 끝났다");
    await core.shutdown();
    core = await boot(home);
    // 같은 사람의 새 기동 credential이다(이전 기동의 ref는 그 기동의 것이다).
    await accept(core, {
      ...requesterContext,
      credential_ref: "cred-requester-2",
    }, REQUESTER);
    const lost = await until(core, "lost-run", ended, 300_000);
    assert(lost.result_ref !== null, JSON.stringify(lost));
    const lostRead = await post(
      core,
      "problems/get-verification",
      { verification: lost.result_ref, detail: false },
      REQUESTER,
    );
    assertEquals(lostRead.status, 200, JSON.stringify(lostRead.body));
    const lostVerification = lostRead.body.verification as Record<
      string,
      unknown
    >;
    assertEquals(lostVerification.result, "inconclusive");
    assert(String(lostVerification.reason).includes("runner_lost"));
    assertEquals(lostVerification.test, derived.value.test_hash);
    // 시작 시도는 한 번뿐이다: 이어받아도 다시 시작하지 않았다.
    const attempts = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    try {
      const rows = attempts.prepare(
        `select phase from test_requests where request_key = 'lost-run' order by seq`,
      ).all() as { phase: string }[];
      assertEquals(
        rows.filter((row) => row.phase === "start_attempt").length,
        1,
      );
      assertEquals(rows.filter((row) => row.phase === "recovery").length, 1);
    } finally {
      attempts.close();
    }
  } finally {
    await core.shutdown();
    // 끊긴 runner가 남긴 자식(우리 temp home 아래에서 도는 것)을 정리한다.
    await new Deno.Command("pkill", { args: ["-f", home] }).output().catch(
      () => undefined,
    );
    await made.dispose();
  }
});
