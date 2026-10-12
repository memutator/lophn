// 재시작 뒤 접수·실행 중으로 남은 invocation(apps/invocations#R9, R10, R12,
// platform/backup-and-migration#R16)을 실제 core와 같은 임시 LOPHN_HOME으로 본다. core를 끄고 같은 홈으로
// 다시 띄우면 기동이 점검 근거와 함께 미확인으로 확정한다. 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import type {
  ApprovalRequest,
  AuthenticatedContext,
} from "../../../protocol/server/mod.ts";
import { type Core, startCore } from "../../../../apps/core/core.ts";
import { createLedgerRegistration } from "../../../../apps/core/apps.ts";
import {
  actionOf,
  call,
  command,
  createInput,
  decide,
  inspect,
  type Server,
} from "../../../../apps/core/testing/approvals-fixture.ts";
import { observeInvocations } from "./restart.ts";
import { DatabaseSync } from "node:sqlite";

const NOW = Date.parse("2026-10-04T00:00:00.000Z");
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const RUNNING = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const DONE = "inv_01h455vb4pex5v6nkc6gd5fdw2";
const APR = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);

function context(
  actor: string,
  operations: string[],
  ref: string,
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: ref,
  } as AuthenticatedContext;
}

type Boot = {
  core: Core;
  server: Server;
  user: string;
  machine: string;
};

async function boot(
  home: string,
  generation: number,
  clock = manualClock(NOW),
): Promise<Boot> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration }],
    teamModules: [
      new URL("../../../../apps/core/apps.ts", import.meta.url).href,
    ],
    clock,
    // 시작마다 다른 seed다. 같은 seed는 같은 credential ref를 만들어 기록이 겹친다.
    random: seededRandom(31 + generation),
    testCredentials: true,
    superviseIo: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  const tokens: string[] = [];
  for (
    const [credential, token] of [
      [
        context("user", [
          "create_approval_request",
          "grant_approval_request",
          "apply_approved_action",
          "GetApproval",
          "ListApprovals",
          "invocations.get",
          "invocations.list",
        ], `cred-user-${generation}`),
        `${generation}`.repeat(43),
      ],
      [
        context("machine", [
          "apply_approved_action",
          "invocation.accept_confirm",
          "invocation.record_started",
          "invocation.record_finished",
          "invocations.get",
          "invocations.list",
        ], `cred-machine-${generation}`),
        `${generation + 4}`.repeat(43),
      ],
    ] as const
  ) {
    const accepted = await core.acceptTestCredential?.(credential, token);
    assert(accepted?.ok);
    assert((await core.record(credential)).ok);
    tokens.push(token);
  }
  const server: Server = {
    port: core.port,
    dataRoot: core.dataRoot,
    clock,
    confirmation: (body) =>
      core.confirmation?.(body) ??
        Promise.resolve({ ok: false as const, error: { message: "없다" } }),
  };
  return { core, server, user: tokens[0], machine: tokens[1] };
}

async function read(world: Boot, id: string) {
  const reply = await call(world.server, "invocations/get", world.user, {
    invocation: id,
  });
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return reply.body["invocation"] as Record<string, unknown> | null;
}

Deno.test("apps/invocations#R10 #R9 #R12: 재시작하면 접수만 있거나 실행 중으로 남은 invocation을 점검 근거와 함께 미확인으로 확정하고 끝난 호출과 업무는 건드리지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-invocation-restart-" });
  let first: Boot | undefined;
  let second: Boot | undefined;
  let third: Boot | undefined;
  try {
    first = await boot(home, 1);
    const world = first;
    // 끝난 호출 하나, 실행 중으로 남을 호출 하나.
    const record = (method: string, input: unknown, key: string) =>
      call(world.server, `invocations/${method}`, world.machine, {
        input,
        idempotency_key: key,
        compare: {},
        prepared: [],
      });
    const started = {
      app: APP,
      release: REL,
      mode: "live",
      actor: "user",
      caller: { kind: "direct" },
      operation: { kind: "command", command: "usage.sync" },
      trigger: { kind: "direct" },
      started_at: new Date(NOW).toISOString(),
    };
    for (const id of [RUNNING, DONE]) {
      assertEquals(
        (await record(
          "record_started",
          { invocation: id, ...started },
          `s-${id}`,
        ))
          .status,
        200,
      );
    }
    assertEquals(
      (await record("record_finished", {
        invocation: DONE,
        status: "succeeded",
        started_at: started.started_at,
        finished_at: new Date(NOW + 1000).toISOString(),
        summary: { command: "usage.sync" },
        detail_hash: null,
      }, "f-done")).status,
      200,
    );
    // 접수만 확정되고 시작은 없는 confirm 호출.
    const accept = {
      app: APP,
      release: REL,
      command: "usage.purge",
      input_hash: HASH,
      approval: APR,
      key: "confirm-key",
      process_nonce: "nonce-1",
      caller: { kind: "direct" },
    };
    const action = await actionOf({
      concern: "apps/invocations",
      command: "invocation.accept_confirm",
      caller: "user",
      targets: [APP, REL],
      value: accept as never,
      comparison: { release: REL },
    });
    const created = await call(
      world.server,
      "approvals/create",
      world.user,
      command(createInput(APR, "user", action)),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const granted = await decide(
      world.server,
      world.user,
      created.body["request"] as ApprovalRequest,
      "grant",
    );
    assertEquals(granted.status, 200, JSON.stringify(granted.body));
    const applied = await call(
      world.server,
      "approvals/apply",
      world.machine,
      command({ approval: APR, action, idempotency_key: "apply" }),
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    const [accepted] = inspect(
      world.server,
      "select id from invocations where approval = ?",
      [APR],
    );
    const ACCEPTED = String(accepted["id"]);
    assertEquals((await read(world, ACCEPTED))?.["status"], "accepted");
    assertEquals((await read(world, RUNNING))?.["status"], "running");

    // 점검 관측: 둘 다 시작·종료를 본 근거가 없어 unknown이다.
    const ledger = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    try {
      const observed = observeInvocations(
        {
          all: (query, params) =>
            ledger.prepare(query).all(...(params as never[])) as Record<
              string,
              unknown
            >[],
        },
        new Date(NOW).toISOString(),
      );
      assertEquals(
        observed.map((item) => [item.target, item.outcome]).sort(),
        [[ACCEPTED, "unknown"], [RUNNING, "unknown"]].sort(),
      );
    } finally {
      ledger.close();
    }

    await first.core.shutdown();
    first = undefined;

    // 같은 홈으로 다시 띄운다. 기동이 둘을 미확인으로 확정한다.
    second = await boot(home, 2, manualClock(NOW + 60_000));
    const acceptedAfter = await read(second, ACCEPTED);
    assertEquals(acceptedAfter?.["status"], "unknown");
    assertEquals(acceptedAfter?.["started_at"], null);
    assertEquals(acceptedAfter?.["approval"], APR);
    const runningAfter = await read(second, RUNNING);
    assertEquals(runningAfter?.["status"], "unknown");
    assertEquals(runningAfter?.["started_at"], started.started_at);
    for (const row of [acceptedAfter, runningAfter]) {
      const summary = row?.["summary"] as Record<string, unknown>;
      assertEquals(summary["reason"], "core_restarted");
      assert((summary["evidence"] as string[]).length >= 2);
    }
    assertEquals(
      (runningAfter?.["summary"] as { observation: string }).observation,
      "result_not_observed",
    );
    assertEquals(
      (acceptedAfter?.["summary"] as { observation: string }).observation,
      "start_not_observed",
    );
    // 끝난 호출은 그대로다.
    const doneAfter = await read(second, DONE);
    assertEquals(doneAfter?.["status"], "succeeded");
    // 성공이나 실패로 꾸미지 않고 이 확정이 접수·시작을 지어내지도 않는다.
    assertEquals(
      inspect(
        second.server,
        "select count(*) as n from events where type = 'InvocationFinished' and subject in (?, ?)",
        [ACCEPTED, RUNNING],
      )[0]["n"],
      2,
    );
    // 점검은 더는 이 호출들을 미완료로 보지 않는다.
    const ledger2 = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
    try {
      assertEquals(
        observeInvocations(
          {
            all: (query, params) =>
              ledger2.prepare(query).all(...(params as never[])) as Record<
                string,
                unknown
              >[],
          },
          new Date(NOW).toISOString(),
        ),
        [],
      );
    } finally {
      ledger2.close();
    }
    await second.core.shutdown();
    second = undefined;

    // 다시 재시작해도 이미 확정한 호출은 바뀌지 않는다.
    third = await boot(home, 3, manualClock(NOW + 120_000));
    assertEquals((await read(third, RUNNING))?.["status"], "unknown");
    assertEquals(
      inspect(
        third.server,
        "select count(*) as n from events where type = 'InvocationFinished' and subject in (?, ?)",
        [ACCEPTED, RUNNING],
      )[0]["n"],
      2,
    );
  } finally {
    await first?.core.shutdown();
    await second?.core.shutdown();
    await third?.core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
