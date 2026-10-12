import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../../testing/core.ts";
import type { TeamModule } from "../../main/daemon/registration.ts";

// 실제 core(temp LOPHN_HOME)를 띄우고 HTTP로 command·read가 닿는지 확인한다.
// lead 요구: "실제 core 통합 테스트(temp LOPHN_HOME)로 command·read가 HTTP로 닿는지 확인한다".

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const LATER = "2026-10-04T00:00:01.000Z";

async function appsTeam(): Promise<TeamModule> {
  // 팀 등록 모듈을 dynamic import한다. 앱 등록은 같은 모듈에서 reader도 낸다.
  const module = await import("../register.ts");
  return { createLedgerRegistration: module.createLedgerRegistration };
}

Deno.test("apps/invocations#R3: command와 read가 HTTP로 닿는다", async () => {
  const opened = await createCoreHarness({
    teams: [await appsTeam()],
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "task:check",
      scope: {
        operations: [
          "invocation.record_started",
          "invocation.record_finished",
          "invocations.list",
          "invocations.get",
        ],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const base = `http://127.0.0.1:${harness.port}`;

    const post = async (
      resource: string,
      method: string,
      body: unknown,
      token: string,
    ): Promise<Response> =>
      await fetch(`${base}/v1/${resource}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

    // record_started command가 HTTP로 닿는다.
    const start = await post("invocations", "record_started", {
      input: {
        invocation: INV,
        app: APP,
        release: REL,
        mode: "live",
        actor: "user",
        caller: { kind: "direct" },
        operation: { kind: "command", command: "usage.sync" },
        trigger: { kind: "direct" },
        started_at: AT,
      },
      idempotency_key: "http-start",
      compare: {},
      prepared: [],
    }, issued.value.token);
    assertEquals(start.status, 200);
    assertEquals(await start.json(), { accepted: true });

    // record_finished도 닿는다.
    const finish = await post("invocations", "record_finished", {
      input: {
        invocation: INV,
        status: "succeeded",
        started_at: AT,
        finished_at: LATER,
        summary: { code: "ok" },
        detail_hash: null,
      },
      idempotency_key: "http-finish",
      compare: {},
      prepared: [],
    }, issued.value.token);
    assertEquals(finish.status, 200);
    assertEquals(await finish.json(), { accepted: true });

    // 같은 envelope 재전송도 200이다.
    const replay = await post("invocations", "record_finished", {
      input: {
        invocation: INV,
        status: "succeeded",
        started_at: AT,
        finished_at: LATER,
        summary: { code: "ok" },
        detail_hash: null,
      },
      idempotency_key: "http-finish",
      compare: {},
      prepared: [],
    }, issued.value.token);
    assertEquals(replay.status, 200);
    assertEquals(await replay.json(), { accepted: true });

    // get read가 HTTP로 닿는다.
    const gotten = await post("invocations", "get", {
      invocation: INV,
    }, issued.value.token);
    assertEquals(gotten.status, 200);
    const body = await gotten.json();
    assertEquals(body.invocation?.status, "succeeded");
    assertEquals(body.invocation?.release, REL);

    // list read도 닿는다.
    const list = await post("invocations", "list", {}, issued.value.token);
    assertEquals(list.status, 200);
    const listed = await list.json();
    assertEquals(listed.invocations?.length, 1);

    // 모르는 command는 invalid_input이다.
    const unknown = await fetch(`${base}/v1/invocations/record_started`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issued.value.token}`,
      },
      body: JSON.stringify({
        input: { invocation: "inv_other" },
        compare: {},
        prepared: [],
      }),
    });
    assertEquals(unknown.status, 400);

    // 충돌하는 늦은 종료 사실은 conflict(409)다.
    const late = await post("invocations", "record_finished", {
      input: {
        invocation: INV,
        status: "failed",
        started_at: AT,
        finished_at: LATER,
        summary: { code: "no" },
        detail_hash: null,
      },
      idempotency_key: "http-late",
      compare: {},
      prepared: [],
    }, issued.value.token);
    assertEquals(late.status, 409);
  } finally {
    await harness.close();
  }
});
