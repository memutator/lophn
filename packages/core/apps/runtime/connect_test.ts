// apps.connect: core 안 제어 어댑터가 서명한 AppConnection을 실제 앱 자식 프로세스가
// 매 요청 로컬 검증한다. core는 실제 core(임시 LOPHN_HOME)이고 supervisor 관측만 시험
// 출처다(자식은 temp 폴더의 실제 프로세스). 사람 데이터 root는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { sha256Hex } from "../../../base/mod.ts";
import {
  canonicalPayload,
  decodeVerifyKey,
  verifySigned,
} from "./entrypoint/signature.ts";
import { call } from "../../../../apps/core/testing/approvals-fixture.ts";
import {
  authorizationOf,
  control,
  direct,
  observationOf,
  openWorld,
  revokeCredential,
  type World,
} from "./world_test.ts";

async function withWorld(
  run: (world: World) => Promise<void>,
  options: { sweepMs?: number } = {},
) {
  const world = await openWorld(options);
  try {
    await world.allow();
    await run(world);
  } finally {
    await world.close();
  }
}

function connectBody(app: string, overrides: Record<string, unknown> = {}) {
  return {
    app,
    mode: "live",
    screens: ["usage"],
    screen_sizes: { usage: ["full"] },
    commands: ["usage.read", "usage.save"],
    ...overrides,
  };
}

Deno.test("apps/runtime#R9: 인증 없는 connect와 모르는 credential은 거절한다", async () => {
  await withWorld(async (world) => {
    const missing = await fetch(
      `http://127.0.0.1:${world.harness.port}/v1/apps/connect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(connectBody(world.app)),
      },
    );
    assertEquals(missing.status, 401);
    await missing.body?.cancel();
    const unknown = await call(
      world.harness,
      "apps/connect",
      "x".repeat(43),
      connectBody(world.app),
    );
    assertEquals(unknown.status, 401);
    // operation scope 밖의 자격은 없는 앱과 같은 응답이다.
    const outside = await world.login("user", ["app.create"]);
    await world.start();
    const denied = await call(
      world.harness,
      "apps/connect",
      outside.token,
      connectBody(world.app),
    );
    assertEquals(denied.status, 404);
  });
});

Deno.test("apps/runtime#R9: 서명한 user connection은 실제 앱이 받아 command를 실행한다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const connected = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app),
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    const connection = connected.body["connection"] as Record<string, unknown>;
    assertEquals(connected.body["endpoint"], child.endpoint);
    assertEquals(connection["app"], world.app);
    assertEquals(connection["release"], child.release);
    assertEquals(connection["bundle_hash"], child.bundleHash);
    assertEquals(connection["process_nonce"], child.nonce);
    assertEquals(connection["actor"], world.user.context.actor);
    assertEquals(
      connection["credential_ref"],
      world.user.context.credential_ref,
    );
    assertEquals(connection["caller"], null);
    // 기한은 원래 credential 이하·최대 10분이다.
    const expires = Date.parse(String(connection["expires_at"]));
    assert(expires > world.harness.clock.nowMs());
    assert(expires <= world.harness.clock.nowMs() + 10 * 60_000);
    const authorization = authorizationOf(connected);
    const invoked = await direct(
      child.endpoint,
      "POST",
      "/_lophn/commands/invoke",
      authorization,
      {
        request_key: "k-1",
        release: child.release,
        command: "usage.read",
      },
    );
    assertEquals(invoked.status, 200, JSON.stringify(invoked.body));
    const output = invoked.body as {
      result: { result: { command: string } };
      mode: string;
    };
    assertEquals(output.result.result.command, "usage.read");
    assertEquals(output.mode, "live");
  });
});

Deno.test("apps/runtime#R9: 위조·다른 서명·옛 nonce는 앱이 거절한다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const connected = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app),
    );
    assertEquals(connected.status, 200);
    const signed = JSON.parse(authorizationOf(connected)) as {
      payload: Record<string, unknown>;
      signature: string;
    };
    const attempt = (authorization: string | null) =>
      direct(child.endpoint, "POST", "/_lophn/commands/invoke", authorization, {
        request_key: crypto.randomUUID(),
        release: child.release,
        command: "usage.read",
      });
    assertEquals((await attempt(null)).status, 401);
    // payload를 고치면 서명이 맞지 않는다(command 범위 넓히기).
    const widened = {
      payload: { ...signed.payload, commands: ["usage.admin"] },
      signature: signed.signature,
    };
    assertEquals((await attempt(JSON.stringify(widened))).status, 401);
    // 같은 payload의 다른 actor 주장도 서명이 맞지 않는다.
    const claimed = {
      payload: { ...signed.payload, actor: "machine" },
      signature: signed.signature,
    };
    assertEquals((await attempt(JSON.stringify(claimed))).status, 401);
    // 서명 key가 다른 core가 만든 서명은 받지 않는다.
    const other = await (await import("./signing.ts")).createCoreSigner();
    const forged =
      (await other.signConnection(signed.payload as never)).signature;
    assertNotEquals(forged, signed.signature);
    assertEquals(
      (await attempt(
        JSON.stringify({ payload: signed.payload, signature: forged }),
      ))
        .status,
      401,
    );
    // 정상 서명은 통과한다.
    assertEquals((await attempt(authorizationOf(connected))).status, 200);
  });
});

Deno.test("apps/runtime#R9: 임의 caller의 제어 요청은 거절하고 platform machine 연결만 받는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start({ ready: false });
    const probe = { process_nonce: child.nonce };
    // 서명 없는 제어 요청.
    assertEquals(
      (await direct(
        child.endpoint,
        "POST",
        "/_lophn/control/probe",
        null,
        probe,
      ))
        .status,
      401,
    );
    // 정상 서명이어도 사람(user) connection은 제어 경로를 열지 못한다.
    world.state.live = observationOf(child);
    const user = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app),
    );
    assertEquals(user.status, 200, JSON.stringify(user.body));
    const refused = await direct(
      child.endpoint,
      "POST",
      "/_lophn/control/shutdown",
      authorizationOf(user),
      { process_nonce: child.nonce, grace_ms: 10000 },
    );
    assertEquals(refused.status, 403);
    // 앱은 계속 응답한다(제어 요청이 앱을 멈추지 못했다).
    const machine = await control(world, child, "/_lophn/control/probe", probe);
    assertEquals(machine.status, 200, JSON.stringify(machine.body));
    assertEquals(
      (machine.body as { process_nonce: string }).process_nonce,
      child.nonce,
    );
  });
});

Deno.test("apps/runtime#R9: 화면 connection 본문의 다른 앱 주장과 caller 주장은 권한 근거가 아니다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    // 이 앱 하나에 묶인 자격은 다른 앱을 요청해도 없는 앱과 같은 응답을 받는다.
    const bound = await world.login("user", ["app.connect"], {
      targets: { app: world.app },
      conditions: { app: world.app },
    });
    const other = "app_01arz3ndektsv4rrffq69g5faw";
    const stranger = await call(
      world.harness,
      "apps/connect",
      bound.token,
      connectBody(other),
    );
    const absent = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(other),
    );
    assertEquals(stranger.status, 404);
    assertEquals(absent.status, 404);
    assertEquals(stranger.body, absent.body);
    // 사람의 연결 요청이 agent caller를 주장해도 connection에는 들어가지 않는다.
    const claimed = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app, {
        caller: {
          kind: "agent",
          run: "run_01arz3ndektsv4rrffq69g5fav",
          tool_call: "tcl_01arz3ndektsv4rrffq69g5fav",
        },
      }),
    );
    assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
    assertEquals(
      (claimed.body["connection"] as Record<string, unknown>)["caller"],
      null,
    );
    // 앱 자식의 자격(app actor)은 이 경로로 다른 앱을 준비하지 못한다.
    assert(child.nonce.length > 0);
  });
});

Deno.test("apps/runtime#R9: live connection은 release가 있는 현재 채택·ready·accepting 프로세스에만 묶인다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const live = world.state.live!;
    const request = () =>
      call(
        world.harness,
        "apps/connect",
        world.user.token,
        connectBody(world.app),
      );
    // release 없는 live 관측은 연결하지 않는다.
    world.state.live = { ...live, release: null };
    assertEquals((await request()).status, 503);
    // 채택하지 않은 release의 프로세스(교체 중)도 연결하지 않는다.
    world.state.live = {
      ...live,
      release: "rel_01arz3ndektsv4rrffq69g5faw",
    };
    assertEquals((await request()).status, 503);
    // 준비 중이거나 통로가 열리지 않은 프로세스.
    world.state.live = { ...live, ready: false };
    assertEquals((await request()).status, 503);
    world.state.live = { ...live, accepting: false };
    assertEquals((await request()).status, 503);
    // supervisor에 닿지 못하면 과거 값으로 연결하지 않는다.
    world.state.live = live;
    world.state.down = true;
    assertEquals((await request()).status, 503);
    world.state.down = false;
    const ok = await request();
    assertEquals(ok.status, 200, JSON.stringify(ok.body));
    assertEquals(
      (ok.body["connection"] as Record<string, unknown>)["release"],
      child.release,
    );
  });
});

Deno.test("apps/runtime#R9: release 없는 preview connection은 bundle_hash에 묶이고 가짜 release를 만들지 않는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start({ mode: "preview" });
    assertEquals(child.release, null);
    const connected = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      {
        ...connectBody(world.app, { mode: "preview" }),
        preview_nonce: child.nonce,
      },
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    const connection = connected.body["connection"] as Record<string, unknown>;
    assertEquals(connection["release"], null);
    assertEquals(connection["mode"], "preview");
    assertEquals(connection["bundle_hash"], child.bundleHash);
    assertEquals(connection["process_nonce"], child.nonce);
    const invoked = await direct(
      child.endpoint,
      "POST",
      "/_lophn/commands/invoke",
      authorizationOf(connected),
      { request_key: "preview-1", command: "usage.read" },
    );
    assertEquals(invoked.status, 200, JSON.stringify(invoked.body));
    assertEquals((invoked.body as { mode: string }).mode, "preview");
    // 다른 nonce의 preview는 없는 프로세스다. mode와 nonce를 본문이 바꾸지 못한다.
    const stale = await call(world.harness, "apps/connect", world.user.token, {
      ...connectBody(world.app, { mode: "preview" }),
      preview_nonce: "another-nonce",
    });
    assertEquals(stale.status, 503);
    // preview가 live 자리를 대신하지 못한다.
    const live = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app),
    );
    assertEquals(live.status, 503);
  });
});

Deno.test("apps/runtime#R9: endpoint와 nonce는 ledger에 쓰지 않는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const connected = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app),
    );
    assertEquals(connected.status, 200);
    // ledger 파일(WAL 포함) 어디에도 이 프로세스의 nonce와 socket 주소가 없다.
    for (const name of ["lophn.db", "lophn.db-wal"]) {
      const bytes = await Deno.readFile(`${world.harness.dataRoot}/${name}`)
        .catch(() => new Uint8Array());
      const text = new TextDecoder("latin1").decode(bytes);
      assert(!text.includes(child.nonce), `${name} has the process nonce`);
      assert(!text.includes(child.endpoint), `${name} has the endpoint`);
    }
  });
});

Deno.test("apps/runtime#R9: 화면 connection은 요청한 screen·size와 blueprint 선언의 교집합만 받는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const connected = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      {
        app: world.app,
        mode: "live",
        // ghost는 선언에 없다. usage의 card는 선언된 크기가 아니다.
        screens: ["usage", "overview", "ghost"],
        screen_sizes: {
          usage: ["full", "card"],
          overview: ["panel"],
          ghost: ["full"],
        },
        commands: [],
      },
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    const connection = connected.body["connection"] as {
      screens: string[];
      screen_sizes: Record<string, string[]>;
    };
    assertEquals(connection.screens, ["usage", "overview"]);
    assertEquals(connection.screen_sizes, {
      usage: ["full"],
      overview: ["panel"],
    });
    const authorization = authorizationOf(connected);
    const get = (screen: string, size: string) =>
      direct(
        child.endpoint,
        "GET",
        `/screens/${screen}/app.js?size=${size}&view_session=v-${screen}-${size}`,
        authorization,
      );
    const shown = await get("usage", "full");
    assertEquals(shown.status, 200);
    assertEquals(shown.body, "screen usage app.js");
    assertEquals((await get("overview", "panel")).status, 200);
    // 선언은 하지만 connection이 주지 않은 크기.
    assertEquals((await get("usage", "panel")).status, 403);
    // 선언하지 않은 크기.
    assertEquals((await get("usage", "card")).status, 400);
    // connection에 없는 화면.
    assertEquals((await get("ghost", "full")).status, 403);
  });
});

Deno.test("apps/runtime#R9: connection 기한은 원래 credential 기한을 넘지 않는다", async () => {
  await withWorld(async (world) => {
    await world.start();
    // 기한이 1분 남은 자격이다.
    const soon = new Date(world.harness.clock.nowMs() + 60_000).toISOString();
    const stamped = await world.harness.credential({
      actor: "user",
      principal: "short-expiry",
      scope: { operations: ["app.connect"], targets: {} },
      conditions: {},
      expires_at: soon,
    });
    assert(stamped.ok, stamped.ok ? "" : stamped.error.message);
    const connected = await call(
      world.harness,
      "apps/connect",
      stamped.value.token,
      connectBody(world.app),
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    assertEquals(
      (connected.body["connection"] as Record<string, unknown>)["expires_at"],
      soon,
    );
  });
});

Deno.test("apps/runtime#R9: 회수된 credential의 connection은 그 프로세스를 한 번만 다시 띄우게 하고 다른 연결·만료된 연결은 건드리지 않는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const control = world.harness.appsControl;
    const connect = async (login: { token: string }) => {
      const connected = await call(
        world.harness,
        "apps/connect",
        login.token,
        connectBody(world.app),
      );
      assertEquals(connected.status, 200, JSON.stringify(connected.body));
    };
    const revoked = await world.login("user", ["app.connect"]);
    const healthy = await world.login("user", ["app.connect"]);
    await connect(revoked);
    await connect(healthy);
    assertEquals(control.connector.issued, 2);
    // 회수 전에는 닫을 것이 없다.
    await control.sweep();
    assertEquals(world.state.restarts, []);
    revokeCredential(world, revoked);
    // 시작을 알리지 못하면 기록이 남아 다음 검사가 다시 시도한다.
    world.state.failRestart = true;
    await control.sweep();
    assertEquals(world.state.restarts, []);
    assertEquals(control.connector.issued, 2);
    world.state.failRestart = false;
    await control.sweep();
    assertEquals(world.state.restarts, [{
      app: world.app,
      nonce: child.nonce,
    }]);
    // 그 프로세스의 통로를 닫았으니 두 연결의 기록이 모두 사라지고 두 번 닫지 않는다.
    assertEquals(control.connector.issued, 0);
    await control.sweep();
    assertEquals(world.state.restarts.length, 1);
  });
});

Deno.test("apps/runtime#R9: 기한이 지난 connection의 credential이 회수돼도 프로세스를 다시 띄우지 않는다", async () => {
  await withWorld(async (world) => {
    await world.start();
    const control = world.harness.appsControl;
    const holder = await world.login("user", ["app.connect"]);
    const connected = await call(
      world.harness,
      "apps/connect",
      holder.token,
      connectBody(world.app),
    );
    assertEquals(connected.status, 200);
    // 10분이 지나면 connection은 어차피 앱이 거절한다. 그 뒤 회수는 닫을 통로가 없다.
    const clock = world.harness.clock as { advance(ms: number): void };
    clock.advance(11 * 60_000);
    revokeCredential(world, holder);
    await control.sweep();
    assertEquals(world.state.restarts, []);
    assertEquals(control.connector.issued, 0);
  });
});

Deno.test("apps/runtime#R9: coding agent connection은 자기 앱 범위 안에서 화면 없이 선언한 command만 받는다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const coder = await world.login("coding_agent", ["app.connect"], {
      targets: { app: world.app },
      conditions: { app: world.app },
    });
    const connected = await call(
      world.harness,
      "apps/connect",
      coder.token,
      connectBody(world.app, { commands: ["usage.read", "not-declared"] }),
    );
    assertEquals(connected.status, 200, JSON.stringify(connected.body));
    const connection = connected.body["connection"] as {
      screens: string[];
      commands: string[];
      actor: string;
      caller: unknown;
    };
    // 화면은 사람(shell main)의 연결만 받는다. 선언하지 않은 command는 들어가지 않는다.
    assertEquals(connection.screens, []);
    assertEquals(connection.commands, ["usage.read"]);
    assertEquals(connection.actor, coder.context.actor);
    assertEquals(connection.caller, null);
    const invoked = await direct(
      child.endpoint,
      "POST",
      "/_lophn/commands/invoke",
      authorizationOf(connected),
      {
        request_key: "coder-1",
        release: child.release,
        command: "usage.read",
      },
    );
    assertEquals(invoked.status, 200, JSON.stringify(invoked.body));
    // 제어 경로는 coding agent connection을 거절한다(platform machine 연결만).
    const control = await direct(
      child.endpoint,
      "POST",
      "/_lophn/control/shutdown",
      authorizationOf(connected),
      { process_nonce: child.nonce, grace_ms: 10000 },
    );
    assertEquals(control.status, 403);
    // 범위 밖 앱은 없는 앱과 같다.
    const other = await call(
      world.harness,
      "apps/connect",
      coder.token,
      connectBody("app_01arz3ndektsv4rrffq69g5faw"),
    );
    assertEquals(other.status, 404);
  });
});

Deno.test("apps/runtime#R9: 같은 core의 AppConnection과 confirm proof는 같은 하나의 공개 key로 검증된다", async () => {
  await withWorld(async (world) => {
    const child = await world.start();
    const control = world.harness.appsControl;
    // 앱 시작 입력의 verify_key는 core가 하나 쥔 signer의 공개 key다(시험 world가 그 key로 자식을 띄웠다).
    const key = decodeVerifyKey(control.verifyKey);
    assert(key !== undefined);
    const connected = await call(
      world.harness,
      "apps/connect",
      world.user.token,
      connectBody(world.app),
    );
    assertEquals(connected.status, 200);
    const connection = {
      payload: connected.body["connection"],
      signature: String(connected.body["signature"]),
    };
    assert(await verifySigned(key, connection, canonicalPayload));
    // confirm proof도 같은 signer가 서명하고 같은 key로 검증된다.
    const proof = await control.signer.signConfirmProof({
      invocation: "inv_01arz3ndektsv4rrffq69g5fav",
      process_nonce: child.nonce,
      release: child.release!,
      command: "usage.save",
      input_hash: await sha256Hex("{}"),
      caller: { kind: "direct" },
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    });
    assert(await verifySigned(key, proof, canonicalPayload));
    // 다른 core(다른 key)가 서명한 것은 이 key로 검증되지 않는다.
    const other = await (await import("./signing.ts")).createCoreSigner();
    const foreign = await other.signConnection(connection.payload as never);
    assert(!(await verifySigned(key, foreign, canonicalPayload)));
    assertNotEquals(other.verifyKey, control.verifyKey);
  });
});
