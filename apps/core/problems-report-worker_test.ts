// 시작된 core와 문제 worker route(/v1/problems/report) 사이 접수 통로의 테스트
// (problems/reporting#R1, R2; plan problems T3). 문 contract registry·인증·scope·
// 입력 형식 뒤 collector seam에 닿는지 시작된 core에서 본다. harness의 fileLedger나
// 직접 insert는 쓰지 않는다. collector 경계 자체는 apps/worker/problems의 테스트가
// 흔든다.

import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { reportProblem } from "../../packages/protocol/problems/mod.ts";
import { startCore } from "./core.ts";
import { problemsReportDefinitions } from "./problems.ts";

const NOW_MS = Date.UTC(2026, 9, 4, 12, 0, 0);
const AT = "2026-10-04T12:00:00.000Z";

// ID는 domain-model ID 접두사 표의 소문자 Crockford base32다.
const APP = "app_01arz3ndektsv4rrffq69g5fav";

// app 실행 credential의 실제 모양이다: actor는 app Actor(dispatch actorAllowed),
// scope operation은 route.name인 ReportProblem(dispatch scopeAllowed), 고정 조건
// app·mode는 credential에서만 온다.
function executionCredential(credentialRef: string): AuthenticatedContext {
  return {
    principal: "app-supervisor-1",
    actor: `app:${APP}`,
    scope: {
      operations: ["ReportProblem"],
      targets: { app: APP },
    },
    conditions: { app: APP, mode: "live" },
    credential_ref: credentialRef,
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

Deno.test("problems/reporting: 문제 worker route는 contract registry에 있다", () => {
  assertEquals(reportProblem.resource, "problems");
  assertEquals(reportProblem.method, "report");
  assertEquals(reportProblem.name, "ReportProblem");
  assertEquals(reportProblem.actors, ["app"]);
});

Deno.test("problems/reporting#R1 R2: 시작된 core에서 실행 credential로 /v1/problems/report가 입력 형식 뒤 collector seam에 닿고 권한 밖 scope는 worker 전에 결정 거절이다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-report-worker-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ problemsReportDefinitions }],
    teamModules: [new URL("./problems.ts", import.meta.url).href],
    clock: manualClock(NOW_MS),
    random: seededRandom(1),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  try {
    const token = "b".repeat(43);
    const outside = "c".repeat(43);
    await seedCredential(
      core,
      executionCredential("cred-report-worker"),
      token,
    );
    await seedCredential(
      core,
      {
        ...executionCredential("cred-report-outside"),
        scope: { operations: [], targets: {} },
      },
      outside,
    );
    const post = (bearer: string, body: string) =>
      fetch(`http://127.0.0.1:${core.port}/v1/problems/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body,
      });
    const body = JSON.stringify({
      report_id: "rpt_01arz3ndektsv4rrffq69g5fav",
      code: "save_failed",
      observed_at: AT,
    });

    // 감독을 끈 core(superviseIo: false)에는 collector가 없다(제품 조립은
    // problems-collector-product_test가 본다). 입력 형식·actor·scope 검사를 모두
    // 통과한 뒤 worker가 없으면 결정 응답은 unavailable이다.
    const seam = await post(token, body);
    assertEquals(seam.status, 503);
    assertEquals((await seam.json()).error.code, "unavailable");

    // scope 밖 credential은 worker에 닿기 전에 forbidden이다(R1 권한 경계).
    const refused = await post(outside, body);
    assertEquals(refused.status, 403);
    assertEquals((await refused.json()).error.code, "forbidden");
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
