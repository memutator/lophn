import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { GrantRevokeInput } from "../../../contracts/apps/mod.ts";
import {
  type AppProcesses,
  createGrantApplier,
  type GrantRevoker,
  type StopResult,
} from "./apply-grant.ts";
import { createBrokerHub } from "./server.ts";
import { createNetFetchService } from "./net-fetch.ts";
import {
  APP,
  child,
  createAccessFixture,
  CREDENTIAL,
  NONCE,
  OTHER_APP,
  requirement,
  serveLocal,
  withChild,
} from "../testing/broker.ts";

const GRANT = "grt_01h455vb4pex5v6nkc6gd5fdw1";

type Gate = { promise: Promise<void>; open(): void };
function gate(): Gate {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function world(options: { stops?: StopResult[]; hold?: Gate } = {}) {
  const log: string[] = [];
  const stops = [...(options.stops ?? [])];
  let running = 1;
  let peak = 1;
  const processes: AppProcesses = {
    async stop(app) {
      log.push(`stop:${app}`);
      if (options.hold) await options.hold.promise;
      const next = stops.shift() ??
        { confirmed: true as const, processNonce: NONCE };
      if (next.confirmed) running = 0;
      log.push(`stopped:${next.confirmed ? "confirmed" : "unconfirmed"}`);
      return next;
    },
    start(app) {
      log.push(`start:${app}`);
      running += 1;
      peak = Math.max(peak, running);
      return Promise.resolve();
    },
  };
  const revokes: GrantRevokeInput[] = [];
  let revokeResult: Result<unknown> = ok({});
  const revoker: GrantRevoker = {
    revoke(input) {
      log.push("revoke");
      revokes.push(input);
      return Promise.resolve(revokeResult);
    },
  };
  const hub = createBrokerHub();
  const closed = new Set<string>();
  const applier = createGrantApplier({
    broker: {
      blockApp(app) {
        log.push(`block:${app}`);
        return hub.blockApp(app);
      },
    },
    connections: {
      close(app) {
        log.push(`close:${app}`);
        closed.add(app);
      },
    },
    processes,
    revoker,
    secrets: {
      appsUsing: (name) =>
        Promise.resolve(ok(name === "calendar.token" ? [APP, OTHER_APP] : [])),
    },
  });
  return {
    log,
    // 접수 때와 적용 때 같은 차단을 두 번 부르므로 stop 전의 같은 차단은 하나로 본다.
    steps: () =>
      log.filter((line, index) => {
        if (!line.startsWith("block:") && !line.startsWith("close:")) {
          return true;
        }
        const first = log.indexOf(line);
        return first === index ||
          log.slice(first, index).some((entry) => entry.startsWith("stop:"));
      }),
    revokes,
    closed,
    hub,
    applier,
    peak: () => peak,
    failRevoke() {
      revokeResult = err({ code: "unavailable", message: "not confirmed" });
    },
  };
}

Deno.test("apps/permissions#R20: grant 변경은 새 호출 차단, 기존 자식 종료 확인, 새 범위 재시작 순서이고 종료 확인 전에 새 자식이 없다", async () => {
  const hold = gate();
  const w = world({ hold });
  const applying = w.applier.created({ app: APP, kind: "net.fetch" });
  // 종료 확인이 멈춰 있는 동안 통로는 이미 닫혔고 새 자식은 없다.
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(w.steps(), [`block:${APP}`, `close:${APP}`, `stop:${APP}`]);
  hold.open();
  assertEquals(await applying, { state: "applied" });
  assertEquals(w.steps(), [
    `block:${APP}`,
    `close:${APP}`,
    `stop:${APP}`,
    "stopped:confirmed",
    `start:${APP}`,
  ]);
});

Deno.test("apps/permissions#R20: 변경이 겹쳐도 새 자식이 둘 생기지 않는다", async () => {
  const w = world();
  const first = w.applier.created({ app: APP, kind: "net.fetch" });
  const second = w.applier.created({ app: APP, kind: "secret.use" });
  await Promise.all([first, second]);
  assertEquals(w.peak(), 1);
  const starts = w.log.filter((line) => line.startsWith("start:"));
  const stops = w.log.filter((line) => line.startsWith("stop:"));
  assertEquals(starts.length, 2);
  assertEquals(stops.length, 2);
  // stop과 start가 번갈아 온다.
  const order = w.log.filter((line) =>
    line.startsWith("stop:") || line.startsWith("start:")
  ).map((line) => line.split(":")[0]);
  assertEquals(order, ["stop", "start", "stop", "start"]);
});

Deno.test("apps/permissions#R20: 종료를 확인하지 못하면 새 범위로 재시작하지 않는다", async () => {
  const w = world({ stops: [{ confirmed: false }] });
  const outcome = await w.applier.created({ app: APP, kind: "fs.read" });
  assertEquals(outcome.state, "in_progress");
  assertEquals(w.log.some((line) => line.startsWith("start:")), false);
});

Deno.test("apps/permissions#R20: 자동 회차 허락은 clock이 회차마다 확인하므로 프로세스를 다시 시작하지 않는다", async () => {
  const w = world();
  assertEquals(
    await w.applier.created({ app: APP, kind: "automation.run" }),
    { state: "applied" },
  );
  assertEquals(
    await w.applier.revoke({ id: GRANT, app: APP, kind: "automation.run" }),
    { state: "applied" },
  );
  assertEquals(w.steps(), ["revoke"]);
  assertEquals(w.revokes[0], {
    grant: GRANT,
    process_nonce: null,
    termination_confirmed: null,
  });
});

Deno.test("apps/permissions#R21: 종료 확인을 막으면 회수는 진행 중이고 확인 뒤에만 회수 완료가 된다", async () => {
  const w = world({ stops: [{ confirmed: false }] });
  const grant = { id: GRANT, app: APP, kind: "net.fetch" as const };
  const pending = await w.applier.revoke(grant);
  assertEquals(pending.state, "in_progress");
  // 통로를 막았어도 종료를 확인하지 못했으므로 core에 회수 완료를 요청하지 않는다.
  assertEquals(w.revokes.length, 0);
  assertEquals(w.log.some((line) => line.startsWith("start:")), false);

  const done = await w.applier.revoke(grant);
  assertEquals(done, { state: "applied" });
  assertEquals(w.revokes, [{
    grant: GRANT,
    process_nonce: NONCE,
    termination_confirmed: true,
  }]);
  // 회수가 끝난 뒤에야 새 범위로 시작한다.
  assertEquals(w.steps().slice(-2), ["revoke", `start:${APP}`]);
});

Deno.test("apps/permissions#R21: core가 회수를 거절하면 완료로 표시하지 않고 새 자식도 띄우지 않는다", async () => {
  const w = world();
  w.failRevoke();
  const outcome = await w.applier.revoke({
    id: GRANT,
    app: APP,
    kind: "secret.use",
  });
  assertEquals(outcome.state, "failed");
  assertEquals(w.log.some((line) => line.startsWith("start:")), false);
});

Deno.test("apps/permissions#R21: 이미 멈춘 앱의 회수는 종료 근거 없이 확정을 요청한다", async () => {
  const w = world({ stops: [{ confirmed: true, processNonce: null }] });
  const outcome = await w.applier.revoke({
    id: GRANT,
    app: APP,
    kind: "fs.write",
  });
  assertEquals(outcome, { state: "applied" });
  assertEquals(w.revokes[0], {
    grant: GRANT,
    process_nonce: null,
    termination_confirmed: null,
  });
});

Deno.test("apps/permissions#R22: 회수는 이미 시작한 전송을 취소하지 않고 앞으로의 요청만 막는다", async () => {
  const release = gate();
  const reached = gate();
  const target = serveLocal(async () => {
    reached.open();
    await release.promise;
    return Response.json({ delivered: true });
  });
  try {
    const access = createAccessFixture({
      permissions: [
        requirement("net.fetch", { host: "127.0.0.1", port: target.port }),
      ],
    });
    access.grant({ kind: "net.fetch", host: "127.0.0.1", port: target.port });
    const w = world();
    const endpoint = w.hub.register(
      { child: child(), credential: CREDENTIAL },
      {
        net: createNetFetchService({
          access,
          scheme: "http",
          platformPorts: [],
        }),
      },
    );
    const send = () =>
      endpoint.handle(
        new Request("http://lophn.invalid/_lophn/broker/net/fetch", {
          method: "POST",
          headers: { authorization: CREDENTIAL },
          body: JSON.stringify(withChild({
            invocation: null,
            command: "sync",
            host: "127.0.0.1",
            port: target.port,
            method: "POST",
            path: "/push",
          })),
        }),
      );
    const inFlight = send();
    await reached.promise;
    const revoking = w.applier.revoke({
      id: GRANT,
      app: APP,
      kind: "net.fetch",
    });
    // 회수가 진행되는 동안 새 요청은 막힌다.
    const blocked = await send();
    assertEquals(blocked.status, 503);
    release.open();
    // 이미 보낸 전송은 완료 사실로 남는다.
    const completed = await inFlight;
    console.log("DBG", completed.status, await completed.clone().text());
    assertEquals(completed.status, 200);
    assertEquals(await completed.json(), {
      status: 200,
      body: { delivered: true },
    });
    assertEquals(await revoking, { state: "applied" });
    assertEquals(target.seen.length, 1);
  } finally {
    await target.stop();
  }
});

Deno.test("apps/permissions#R29: app.call 회수는 관련 연결 차단과 종료 확인 뒤에 적용되고 진행 중으로 보이다 완료 뒤 옛 연결은 거절된다", async () => {
  const w = world({ stops: [{ confirmed: false }] });
  const grant = { id: GRANT, app: APP, kind: "app.call" as const };
  const pending = await w.applier.revoke(grant);
  assertEquals(pending.state, "in_progress");
  // 종료를 확인하지 못해도 source의 직접 연결은 새 호출부터 막혔다.
  assert(w.closed.has(APP));
  assertEquals(w.revokes.length, 0);

  assertEquals(await w.applier.revoke(grant), { state: "applied" });
  assertEquals(w.revokes[0]?.termination_confirmed, true);
  // 서명된 옛 연결은 같은 source의 새 자식에도 쓰지 못한다.
  assert(w.closed.has(APP));
  assertEquals(w.closed.has(OTHER_APP), false);
});

Deno.test("apps/permissions#R29: agent.commands 변경도 target 자식 종료 확인 뒤 새 범위로 적용한다", async () => {
  const w = world();
  assertEquals(
    await w.applier.created({ app: APP, kind: "agent.commands" }),
    { state: "applied" },
  );
  assertEquals(w.steps(), [
    `block:${APP}`,
    `close:${APP}`,
    `stop:${APP}`,
    "stopped:confirmed",
    `start:${APP}`,
  ]);
});

Deno.test("apps/permissions#R17: secret 값 교체·삭제 뒤 사용 앱을 종료 확인과 새 시작으로 다시 띄운다", async () => {
  const w = world({
    stops: [
      { confirmed: true, processNonce: NONCE },
      { confirmed: false },
    ],
  });
  const changed = await w.applier.secretChanged("calendar.token");
  assert(changed.ok);
  assertEquals(changed.value, [
    { app: APP, outcome: { state: "applied" } },
    {
      app: OTHER_APP,
      outcome: {
        state: "in_progress",
        reason: "the previous process termination is not confirmed",
      },
    },
  ]);
  // 종료를 확인하지 못한 앱은 새 시작이 없다.
  assertEquals(w.log.filter((line) => line.startsWith("start:")), [
    `start:${APP}`,
  ]);
  const unused = await w.applier.secretChanged("unused.token");
  assert(unused.ok);
  assertEquals(unused.value, []);
});
