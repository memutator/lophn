// 제품 조립이 report collector를 감독하고 문제 보고 route에 묶는지 본다(problems/reporting#R1,
// R2; plan problems T3). `workers` seam 없이 제품 main과 같은 감독으로 core를 띄우고, 앱 실행
// credential의 /v1/problems/report가 503이 아니라 접수 응답을 받는지 본다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { startCore } from "./core.ts";
import { problemsReportDefinitions } from "./problems.ts";

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const AT = "2026-10-04T12:00:00.000Z";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const REPORT = "rpt_01arz3ndektsv4rrffq69g5fav";

Deno.test("problems/reporting#R1 R2: 제품처럼 띄운 core는 주입 없이 collector를 감독해 /v1/problems/report를 접수한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-collector-product-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ problemsReportDefinitions }],
    teamModules: [new URL("./problems.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    const token = "e".repeat(43);
    const context: AuthenticatedContext = {
      principal: "app-supervisor-1",
      actor: `app:${APP}`,
      scope: { operations: ["ReportProblem"], targets: { app: APP } },
      conditions: { app: APP, mode: "live" },
      credential_ref: "cred-collector-product",
    };
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential(context, token);
    assert(accepted.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
    const post = () =>
      fetch(`http://127.0.0.1:${core.port}/v1/problems/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          report_id: REPORT,
          code: "save_failed",
          observed_at: AT,
        }),
      });
    // collector child가 뜨기 전에는 unavailable(503)이다. 한도 안에서 뜨기를 기다린다.
    let response = await post();
    const deadline = Date.now() + 30_000;
    while (response.status === 503 && Date.now() < deadline) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 250));
      response = await post();
    }
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.report, REPORT);
    assert(typeof body.problem === "string");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
