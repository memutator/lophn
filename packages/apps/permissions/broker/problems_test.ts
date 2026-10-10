import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import {
  createProblemReportService,
  type ProblemReportRequest,
} from "./problems.ts";
import { createDocumentSaveService } from "./documents.ts";
import { createNetFetchService } from "./net-fetch.ts";
import { createSecretUseService } from "./secrets.ts";
import {
  APP,
  child,
  createAccessFixture,
  HASH,
  OTHER_APP,
  RELEASE,
  requirement,
  withChild,
} from "../testing/broker.ts";

const RPT = "rpt_01h455vb4pex5v6nkc6gd5fdw1";
const ACCEPTED = {
  report: RPT,
  snapshot: "snp_01h455vb4pex5v6nkc6gd5fdw1",
  problem: "prb_01h455vb4pex5v6nkc6gd5fdw1",
  diagnostic_scope: null,
};

function fixture() {
  const access = createAccessFixture({ problemCodes: ["calendar_failed"] });
  const calls: ProblemReportRequest[] = [];
  const service = createProblemReportService({
    access,
    problems: {
      report(request) {
        calls.push(request);
        return Promise.resolve(ok(ACCEPTED));
      },
    },
  });
  return { access, calls, service };
}

Deno.test("apps/permissions#R4: 문제 보고는 추가 permission 없이 선언한 code로 가고 신원은 자식 연결에서 정한다", async () => {
  const { calls, service } = fixture();
  const reported = await service.report(
    child(),
    withChild({ code: "calendar_failed", details: { count: 2 } }),
  );
  assert(reported.ok);
  assertEquals(reported.value, ACCEPTED);
  assertEquals(calls, [{
    app: APP,
    release: RELEASE,
    mode: "live",
    processNonce: "nonce-1",
    code: "calendar_failed",
    details: { count: 2 },
  }]);
});

Deno.test("apps/permissions#R4: 선언하지 않은 code와 본문이 정한 신원은 거절하고 닫는 통로는 없다", async () => {
  const { calls, service } = fixture();
  const undeclared = await service.report(
    child(),
    withChild({ code: "other_problem" }),
  );
  assert(!undeclared.ok);
  assertEquals(undeclared.error.code, "invalid_input");
  for (
    const extra of [
      { app: OTHER_APP },
      { release: "rel_01h455vb4pex5v6nkc6gd5fdw2" },
      { close: true },
      { status: "resolved" },
    ]
  ) {
    const forged = await service.report(
      child(),
      withChild({ code: "calendar_failed", ...extra }),
    );
    assert(!forged.ok);
    assertEquals(forged.error.code, "invalid_input");
  }
  assertEquals(calls.length, 0);
});

Deno.test("apps/permissions#R23: 진단·수리 runner(test 자식)는 같은 grant가 있어도 net·secret·문서 통로를 쓰지 못하고 보고만 한다", async () => {
  const access = createAccessFixture({
    permissions: [
      requirement("net.fetch", { host: "127.0.0.1", port: 9 }),
      requirement("secret.use", { name: "calendar.token" }),
      requirement("document.save", { key: "weekly-report" }),
    ],
    problemCodes: ["calendar_failed"],
  });
  access.grant({ kind: "net.fetch", host: "127.0.0.1", port: 9 });
  access.grant({ kind: "secret.use", name: "calendar.token" });
  access.grant({ kind: "document.save", key: "weekly-report" });
  const reached: string[] = [];
  const runner = child({ mode: "test", release: null });
  const net = createNetFetchService({
    access,
    scheme: "http",
    platformPorts: [],
    transport: () => {
      reached.push("net");
      return Promise.resolve(new Response("x"));
    },
  });
  const secrets = createSecretUseService({
    access,
    platformPorts: [],
    redaction: { ensure: () => ok(undefined) },
    delivery: {
      use: () => {
        reached.push("secret");
        return Promise.resolve(ok({ sent: true as const }));
      },
    },
  });
  const documents = createDocumentSaveService({
    access,
    documents: {
      save: () => {
        reached.push("documents");
        return Promise.resolve(ok({ saved: true, version: null }));
      },
    },
  });
  const problems = createProblemReportService({
    access,
    problems: {
      report: () => {
        reached.push("problems");
        return Promise.resolve(ok(ACCEPTED));
      },
    },
  });
  const fetched = await net.request(
    runner,
    withChild({
      invocation: null,
      command: "sync",
      host: "127.0.0.1",
      port: 9,
      method: "GET",
      path: "/",
    }, runner),
  );
  const used = await secrets.use(
    runner,
    withChild({
      release: RELEASE,
      invocation: null,
      command: "sync",
      input_hash: HASH,
      name: "calendar.token",
      destination: { scheme: "https", host: "127.0.0.1", port: 9 },
    }, runner),
  );
  const saved = await documents.save(
    runner,
    withChild(
      { key: "weekly-report", base_version: null, idempotency_key: "r" },
      runner,
    ),
  );
  for (const result of [fetched, used, saved]) {
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
  }
  assertEquals(reached, []);
  // 진단 보고는 mode와 함께 collector로 간다. 권한을 넓히지 않는다.
  const reported = await problems.report(
    runner,
    withChild({ code: "calendar_failed" }, runner),
  );
  assert(reported.ok);
  assertEquals(reached, ["problems"]);
});
