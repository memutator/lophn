// 앱 쌍 연결(apps/connections#R1, R3–R6, apps/runtime#R30)을 실제 broker endpoint, 실제 core 서명,
// 실제 앱 자식 프로세스(Ed25519 서명을 매 요청 검증)로 본다. 앱 사실은 시험이 쥔 메모리 출처이고
// 사람 데이터 root는 열지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  connectPair,
  invokePair,
  openPairWorld,
  type PairWorld,
  PARENT,
  userAuthorization,
} from "./world_test.ts";
import { unixPairDirect } from "./mod.ts";

async function withWorld(run: (world: PairWorld) => Promise<void>) {
  const world = await openPairWorld();
  try {
    await run(world);
  } finally {
    await world.close();
  }
}

const READ = "usage.read";
const SAVE = "usage.save";
const ADMIN = "usage.admin";

function resultOf(response: { status: number; body: unknown }) {
  assertEquals(response.status, 200, JSON.stringify(response.body));
  return (response.body as { result: { result: unknown } }).result.result;
}

Deno.test("apps/connections#R1 #R3: 허락한 두 command만 B의 같은 handler로 가고 B→A·A→C·범위 밖 command는 거절된다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    const c = await world.addPeer(3, { child: true });
    world.declare(a, b, [READ, SAVE, ADMIN]);
    world.grant(a, b, [READ, SAVE]);
    const bridge = world.bridge(a);

    const prepared = await connectPair(bridge, b.app, [READ, SAVE]);
    assert(prepared.ok, JSON.stringify(prepared));
    const pair = prepared.value;
    const origin = pair.connection["caller"] as Record<string, unknown>;
    assertEquals(origin["kind"], "app");
    assertEquals(origin["app"], a.app);
    assertEquals(pair.connection["actor"], `app:${a.app}`);

    const viaPair = await invokePair(pair, b.release, READ, undefined, "k-1");
    assertEquals(resultOf(viaPair), { command: READ, input: null });
    // 사람이 직접 쓰는 연결과 같은 handler·같은 결과 모양이다.
    const user = {
      endpoint: b.endpoint,
      authorization: await userAuthorization(world, b, [READ]),
    };
    const viaUser = await invokePair(user, b.release, READ, undefined, "k-2");
    assertEquals(resultOf(viaUser), resultOf(viaPair));
    // write는 같은 effect 규칙으로 invocation을 남긴다.
    const saved = await invokePair(pair, b.release, SAVE, undefined, "k-3");
    assertEquals(resultOf(saved), { command: SAVE, input: null });
    assert(
      typeof (saved.body as { invocation?: string }).invocation === "string",
    );

    // 선언은 했지만 grant가 없는 command는 연결에 들어가지 않는다.
    const denied = await connectPair(bridge, b.app, [READ, ADMIN]);
    assert(!denied.ok);
    assertEquals(denied.response.status, 403);
    const details = (denied.response.body as {
      error: { details: { permission: string } };
    }).error.details;
    assertEquals(details.permission, "app.call");

    // 반대 방향과 선언·grant 없는 대상은 없는 앱과 같은 응답이다.
    const reverse = await connectPair(world.bridge(b), a.app, [READ]);
    const missing = await connectPair(
      world.bridge(a),
      "app_01h455vb4pex5v6nkc6gd5fd99",
      [READ],
    );
    const other = await connectPair(world.bridge(a), c.app, [READ]);
    for (const refused of [reverse, other]) {
      assert(!refused.ok && !missing.ok);
      assertEquals(refused.response, missing.response);
    }
    assert(!missing.ok);
    assertEquals(missing.response.status, 404);

    // 연결의 범위 밖 command는 앱이 직접 요청해도 B가 거절한다.
    const outside = await invokePair(pair, b.release, ADMIN, undefined, "k-4");
    assertEquals(outside.status, 403);
  });
});

Deno.test("apps/connections#R3: 연결 허락과 secret grant는 사람 확인을 대신하지 않아 confirm=false만 그냥 실행되고 confirm=true는 proof가 없으면 실행되지 않는다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    // target 자신의 secret grant가 있어도 앱 쌍 호출의 확인 규칙은 command 선언을 따른다.
    world.grants.push({
      id: "grt_01h455vb4pex5v6nkc6gd5fd90",
      app: b.app,
      kind: "secret.use",
      scope: { kind: "secret.use", name: "calendar-token" },
      approval: "apr_01h455vb4pex5v6nkc6gd5fd90",
      status: "active",
      created_by: "user",
      created_at: "2026-10-06T00:00:00.000Z",
      revoked_by: null,
      revoked_at: null,
    });
    world.declare(a, b, [SAVE]);
    world.grant(a, b, [SAVE]);
    const prepared = await connectPair(world.bridge(a), b.app, [SAVE]);
    assert(prepared.ok);
    // usage.save는 confirm=false라 추가 approval 없이 실행된다.
    const saved = await invokePair(
      prepared.value,
      b.release,
      SAVE,
      undefined,
      "k-1",
    );
    assertEquals(resultOf(saved), { command: SAVE, input: null });
    // 같은 연결에 proof를 붙여도 confirm이 아닌 command는 proof를 쓰지 않는다.
    const stray = await invokePair(
      prepared.value,
      b.release,
      SAVE,
      undefined,
      "k-2",
      { payload: {}, signature: "x".repeat(86) },
    );
    assertEquals(stray.status, 400);
  });
});

Deno.test("apps/connections#R4 apps/runtime#R30: core 사실 조회가 멈춰도 연결된 A→B 요청·응답은 직접 간다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    const bridge = world.bridge(a);
    const prepared = await connectPair(bridge, b.app, [READ]);
    assert(prepared.ok);
    // ledger·supervisor 조회가 끝나지 않는 상황이다. 새 준비는 기다리지만 이미 연결한 호출은 응답한다.
    world.stall(true);
    const waiting = connectPair(bridge, b.app, [READ]);
    const raced = await Promise.race([
      waiting.then(() => "prepared"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 100)),
    ]);
    assertEquals(raced, "waiting");
    const posted = bridge.posts.length;
    for (let index = 0; index < 5; index++) {
      const reply = await bridge.invoke(
        prepared.value,
        b.release,
        READ,
        undefined,
        `k-${index}`,
      );
      assertEquals(resultOf(reply), { command: READ, input: null });
    }
    // 요청·응답은 target socket으로만 갔다. 멈춘 동안 broker로 간 요청은 대기 중인 준비 하나뿐이다.
    assertEquals(bridge.posts.length, posted);
    assertEquals(
      bridge.direct.filter((sent) => sent.command === READ).length,
      5,
    );
    world.stall(false);
  });
});

Deno.test("apps/runtime#R30: 위조 caller·바뀐 연결·미허락 command·옛 프로세스 연결은 거절된다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    const bridge = world.bridge(a);
    const prepared = await connectPair(bridge, b.app, [READ]);
    assert(prepared.ok);
    const signed = JSON.parse(prepared.value.authorization) as {
      payload: Record<string, unknown>;
      signature: string;
    };

    // 연결의 caller·command 범위를 바꾸면 서명이 맞지 않는다.
    const swapped = (patch: Record<string, unknown>) => ({
      endpoint: b.endpoint,
      authorization: JSON.stringify({
        payload: { ...signed.payload, ...patch },
        signature: signed.signature,
      }),
    });
    const forgedCaller = swapped({
      caller: {
        ...(signed.payload["caller"] as object),
        app: "app_01h455vb4pex5v6nkc6gd5fd77",
      },
    });
    assertEquals(
      (await invokePair(forgedCaller, b.release, READ, undefined, "f-1"))
        .status,
      401,
    );
    const widened = swapped({ commands: [READ, SAVE, ADMIN] });
    assertEquals(
      (await invokePair(widened, b.release, SAVE, undefined, "f-2")).status,
      401,
    );
    // 서명 없는 연결과 다른 key의 서명도 거절된다.
    const unsigned = {
      endpoint: b.endpoint,
      authorization: JSON.stringify({ payload: signed.payload }),
    };
    assertEquals(
      (await invokePair(unsigned, b.release, READ, undefined, "f-3")).status,
      401,
    );
    const stranger = await (await import("../runtime/mod.ts"))
      .createCoreSigner();
    const foreign = await stranger.signConnection(
      signed.payload as never,
    );
    assertEquals(
      (await invokePair(
        { endpoint: b.endpoint, authorization: JSON.stringify(foreign) },
        b.release,
        READ,
        undefined,
        "f-4",
      )).status,
      401,
    );

    // 본문이 신원이나 caller를 주장해도 준비는 자식 연결의 값만 쓴다.
    for (
      const claim of [
        { caller: { kind: "app", app: b.app } },
        { source: b.app },
        { actor: "user" },
      ]
    ) {
      const response = await bridge.post("/_lophn/broker/apps/connect", {
        app: b.app,
        commands: [READ],
        parent_invocation: null,
        ...claim,
      });
      assertEquals(response.status, 400);
    }
    // 다른 자식(nonce)의 요청은 이 broker 연결의 요청이 아니다.
    const wrongChild = await bridge.post("/_lophn/broker/apps/connect", {
      process_nonce: "other-nonce",
      app: b.app,
      commands: [READ],
      parent_invocation: null,
    });
    assertEquals(wrongChild.status, 401);

    // source가 교체된 뒤 옛 프로세스의 broker 요청은 현재 자식이 아니라서 거절된다.
    const stale = world.observations.get(a.app)!;
    world.observations.set(a.app, { ...stale, processNonce: "nonce-new" });
    const old = await connectPair(bridge, b.app, [READ]);
    assert(!old.ok);
    assertEquals(old.response.status, 401);
    world.observations.set(a.app, stale);

    // target이 새 nonce로 교체되면 옛 연결은 쓰지 못하고 새 연결이 필요하다.
    const replaced = await world.addPeer(4, { child: true });
    const oldTarget = {
      endpoint: replaced.endpoint,
      authorization: prepared.value.authorization,
    };
    assertEquals(
      (await invokePair(oldTarget, replaced.release, READ, undefined, "f-5"))
        .status,
      401,
    );
    // 서명이 있고 범위가 맞는 연결만 응답한다.
    const fine = await invokePair(
      prepared.value,
      b.release,
      READ,
      undefined,
      "f-6",
    );
    assertEquals(fine.status, 200);
  });
});

Deno.test("apps/connections#R5: 연결은 A의 당시 release와 알려진 부모 invocation을 싣고 부모가 없거나 모르면 없음이다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    const bridge = world.bridge(a);

    const root = await connectPair(bridge, b.app, [READ]);
    assert(root.ok);
    const rootOrigin = root.value.connection["caller"] as Record<
      string,
      unknown
    >;
    assertEquals(rootOrigin["release"], a.release);
    assertEquals(rootOrigin["process_nonce"], a.nonce);
    assertEquals(rootOrigin["parent_invocation"], null);
    assertEquals(rootOrigin["path"], [a.app]);
    assertNotEquals(rootOrigin["grant"], undefined);

    // A가 모르는 호출을 부모로 주장해도 서비스가 본 적 없는 호출은 부모로 남기지 않는다.
    const claimed = await connectPair(bridge, b.app, [READ], PARENT);
    assert(claimed.ok);
    assertEquals(
      (claimed.value.connection["caller"] as Record<string, unknown>)[
        "parent_invocation"
      ],
      null,
    );

    // A가 시작을 broker에 알린 호출은 알려진 부모다.
    const started = await bridge.start(PARENT, { kind: "direct" });
    assertEquals(started.status, 200, JSON.stringify(started.body));
    const known = await connectPair(bridge, b.app, [READ], PARENT);
    assert(known.ok);
    assertEquals(
      (known.value.connection["caller"] as Record<string, unknown>)[
        "parent_invocation"
      ],
      PARENT,
    );
  });
});

Deno.test("apps/connections#R5: B→C는 B 자신의 선언과 grant 없이는 거절되고 A의 허락이 C로 이어지지 않는다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2);
    const c = await world.addPeer(3);
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    // A가 C를 선언·허락하지 않았고 B도 아직 C를 선언·허락하지 않았다.
    const viaB = world.bridge(b);
    const refused = await connectPair(viaB, c.app, [READ]);
    assert(!refused.ok);
    assertEquals(refused.response.status, 404);
    // B가 선언만 하고 사람이 허락하지 않으면 여전히 거절이다.
    world.declare(b, c, [READ]);
    const declaredOnly = await connectPair(viaB, c.app, [READ]);
    assert(!declaredOnly.ok);
    assertEquals(declaredOnly.response.status, 404);
    world.grant(b, c, [READ]);
    const allowed = await connectPair(viaB, c.app, [READ]);
    assert(allowed.ok);
    const origin = allowed.value.connection["caller"] as Record<
      string,
      unknown
    >;
    assertEquals(origin["app"], b.app);
    assertEquals(origin["release"], b.release);
  });
});

Deno.test("apps/connections#R6: B가 응답 중 종료돼도 A의 다른 호출과 C 호출은 동작하고 B 쓰기를 반복하지 않는다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { child: true });
    const c = await world.addPeer(3, { child: true });
    world.declare(a, b, [READ, "slow"]);
    world.grant(a, b, [READ, "slow"]);
    world.declare(a, c, [READ]);
    world.grant(a, c, [READ]);
    const bridge = world.bridge(a);
    const toB = await connectPair(bridge, b.app, [READ, "slow"]);
    const toC = await connectPair(bridge, c.app, [READ]);
    assert(toB.ok && toC.ok);

    // 응답을 기다리는 중 B가 끝난다. 처리했는지 모르는 결과이고 자동으로 다시 부르지 않는다.
    const slow = bridge.invoke(
      toB.value,
      b.release,
      "slow",
      undefined,
      "slow-1",
    )
      .then(
        (response) => ({ response }),
        (error: Error) => ({ error: error.name }),
      );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await b.child!.stop();
    const lost = await slow;
    // 보낸 뒤 응답을 잃었다. 처리했는지 모르는 결과다.
    assertEquals("error" in lost && lost.error, "ResultLost");
    // 같은 request_key의 재조회는 사람이 정한다. 이 경로는 handler를 다시 실행하지 않는다.
    const after = await bridge.invoke(
      toB.value,
      b.release,
      READ,
      undefined,
      "again",
    ).then((response) => response.status, (error: Error) => error.name);
    assertEquals(after, "NotSent");
    // 끝난 B로 간 write 성격의 호출은 처음 하나뿐이다. 앱 쌍 통로가 다시 보내지 않았다.
    assertEquals(
      bridge.direct.filter((sent) => sent.command === "slow").length,
      1,
    );

    // 다른 앱 통로는 그대로다.
    const other = await bridge.invoke(
      toC.value,
      c.release,
      READ,
      undefined,
      "c-1",
    );
    assertEquals(resultOf(other), { command: READ, input: null });
    // B의 프로세스가 사라졌다는 관측이면 새 준비는 unavailable이다.
    world.observations.delete(b.app);
    const gone = await connectPair(bridge, b.app, [READ]);
    assert(!gone.ok);
    assertEquals(gone.response.status, 503);
    // 연결 자체도 시도하지 못한 요청은 보내지 않은 것으로 구별된다.
    const unreachable = await unixPairDirect(b.endpoint, {
      method: "GET",
      path: "/_lophn/commands/status",
      authorization: "x",
    }).catch((error: Error) => error.name);
    assertEquals(unreachable, "NotSent");
  });
});
