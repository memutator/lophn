// 호출 path·깊이(apps/connections#R7), 새 release의 범위(R2), 통로 차단(apps/permissions#R29)을
// 실제 broker endpoint와 실제 서명으로 본다. 앱 사실은 시험이 쥔 메모리 출처다.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import { createPathBook } from "./origin.ts";
import {
  connectPair,
  openPairWorld,
  type PairWorld,
  PARENT,
  type Peer,
} from "./world_test.ts";

const READ = "usage.read";
const SAVE = "usage.save";
const inv = (n: number) =>
  `inv_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;

async function withWorld(run: (world: PairWorld) => Promise<void>) {
  const world = await openPairWorld();
  try {
    await run(world);
  } finally {
    await world.close();
  }
}

function appCaller(peer: Peer, parent: string | null) {
  return {
    kind: "app",
    app: peer.app,
    release: peer.release,
    parent_invocation: parent,
  };
}

Deno.test("apps/connections#R7: A→B→A는 handler 전에 거절되고 독립적인 A→B와 B→A는 각 허락 안에서 가능하다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2);
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    world.declare(b, a, [READ]);
    world.grant(b, a, [READ]);
    const viaA = world.bridge(a);
    const viaB = world.bridge(b);

    // A의 호출로 시작한 B의 호출 안에서 A로 돌아가는 호출이다.
    const first = await connectPair(viaA, b.app, [READ]);
    assert(first.ok);
    const started = await viaB.start(inv(1), appCaller(a, null));
    assertEquals(started.status, 200, JSON.stringify(started.body));
    const loop = await connectPair(viaB, a.app, [READ], inv(1));
    assert(!loop.ok);
    assertEquals(loop.response.status, 400);
    assertEquals(
      (loop.response.body as { error: { code: string } }).error.code,
      "invalid_input",
    );

    // 호출 경로에 없는 독립 호출은 각각 허락 안에서 된다. B 자신의 부모가 없으면 새 경로다.
    const independent = await connectPair(viaB, a.app, [READ]);
    assert(independent.ok);
    const again = await connectPair(viaA, b.app, [READ]);
    assert(again.ok);
    // B가 직접(사람) 호출로 시작한 호출은 A의 경로가 아니다.
    await viaB.start(inv(2), { kind: "direct" });
    const direct = await connectPair(viaB, a.app, [READ], inv(2));
    assert(direct.ok);
    assertEquals(
      (direct.value.connection["caller"] as Record<string, unknown>)["path"],
      [b.app],
    );
  });
});

Deno.test("apps/connections#R7: 이어 부르는 앱은 최대 8개이고 아홉 번째 앱 호출은 거절된다", async () => {
  await withWorld(async (world) => {
    const chain: Peer[] = [];
    for (let n = 1; n <= 9; n++) chain.push(await world.addPeer(n));
    for (let n = 0; n < 8; n++) {
      world.declare(chain[n], chain[n + 1], [READ]);
      world.grant(chain[n], chain[n + 1], [READ]);
    }
    // 첫 앱은 직접 시작한 호출 안에서 다음 앱을 부른다.
    await world.bridge(chain[0]).start(inv(1), { kind: "direct" });
    let parent: string | null = inv(1);
    for (let n = 0; n < 7; n++) {
      const bridge = world.bridge(chain[n]);
      const prepared = await connectPair(
        bridge,
        chain[n + 1].app,
        [READ],
        parent,
      );
      assert(prepared.ok, `hop ${n + 1}: ${JSON.stringify(prepared)}`);
      const origin = prepared.value.connection["caller"] as {
        path: string[];
      };
      assertEquals(origin.path, chain.slice(0, n + 1).map((peer) => peer.app));
      // 받은 앱이 그 호출로 시작한 invocation을 알리면 다음 호출의 부모가 된다.
      const next = inv(n + 2);
      const received = await world.bridge(chain[n + 1]).start(
        next,
        appCaller(chain[n], parent),
      );
      assertEquals(received.status, 200, JSON.stringify(received.body));
      parent = next;
    }
    // 여덟 번째 앱(chain[7])까지 왔다. 아홉 번째 앱을 부르면 거절된다.
    const ninth = await connectPair(
      world.bridge(chain[7]),
      chain[8].app,
      [READ],
      parent,
    );
    assert(!ninth.ok);
    assertEquals(ninth.response.status, 400);
    // 같은 앱이 새 호출(부모 없음)로 시작하면 다시 깊이 0이다.
    const fresh = await connectPair(world.bridge(chain[7]), chain[8].app, [
      READ,
    ]);
    assert(fresh.ok);
  });
});

Deno.test("apps/connections#R7: 알려진 부모의 path만 이어지고 앱을 잊으면 장부도 비운다", () => {
  const clock = manualClock(0);
  const book = createPathBook(clock);
  const source = { app: "app_a", release: "rel_a", processNonce: "n-a" };
  const origin = book.next({
    source,
    target: "app_b",
    grant: "grt_1",
    parent: null,
  });
  assert(origin.ok);
  book.issued({ processNonce: "n-b" }, origin.value, clock.nowMs() + 1000);
  book.started({ processNonce: "n-b" }, "inv_b", {
    kind: "app",
    app: "app_a",
    release: "rel_a",
    parent: null,
  });
  assertEquals(book.parentOf("n-b", "inv_b"), "inv_b");
  assertEquals(book.parentOf("n-b", "inv_unknown"), null);
  assertEquals(book.parentOf("n-other", "inv_b"), null);
  const onward = book.next({
    source: { app: "app_b", release: "rel_b", processNonce: "n-b" },
    target: "app_c",
    grant: "grt_2",
    parent: "inv_b",
  });
  assert(onward.ok);
  assertEquals(onward.value.path, ["app_a", "app_b"]);
  // 호출이 끝난 뒤 기한이 지난 발급은 새 호출의 path로 이어지지 않는다.
  clock.advance(2000);
  book.started({ processNonce: "n-b" }, "inv_late", {
    kind: "app",
    app: "app_a",
    release: "rel_a",
    parent: null,
  });
  const late = book.next({
    source: { app: "app_b", release: "rel_b", processNonce: "n-b" },
    target: "app_a",
    grant: "grt_3",
    parent: "inv_late",
  });
  assert(late.ok);
  assertEquals(late.value.path, ["app_b"]);
  book.forget("n-b");
  assertEquals(book.size, { invocations: 0, origins: 0 });
});

Deno.test("apps/connections#R2: 새 release가 같은 범위면 그대로 되고 새 command를 더한 선언은 옛 grant로 부르지 못한다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2, { commands: [READ, SAVE] });
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    const before = await connectPair(world.bridge(a), b.app, [READ]);
    assert(before.ok);

    // A가 새 release로 바뀐다(새 프로세스). 같은 범위의 선언이라 다시 묻지 않는다.
    const newer: Peer = {
      ...a,
      release: "rel_01h455vb4pex5v6nkc6gd5fd91",
      nonce: "nonce-1b",
    };
    const replace = (declared: string[]) => {
      world.declarations.set(a.app, {
        release: newer.release,
        app_connections: [{ app: b.app, commands: declared }],
      });
      world.apps.set(a.app, { release: newer.release, running: true });
      world.observations.set(a.app, {
        ...world.observations.get(a.app)!,
        release: newer.release,
        processNonce: newer.nonce,
      });
    };
    replace([READ]);
    const same = await connectPair(world.bridge(newer), b.app, [READ]);
    assert(same.ok);
    assertEquals(
      (same.value.connection["caller"] as Record<string, unknown>)["release"],
      newer.release,
    );
    // 옛 release의 프로세스가 보내는 요청은 현재 자식이 아니라서 거절된다.
    const old = await connectPair(world.bridge(a), b.app, [READ]);
    assert(!old.ok);
    assertEquals(old.response.status, 401);

    replace([READ, SAVE]);
    const widened = await connectPair(world.bridge(newer), b.app, [SAVE]);
    assert(!widened.ok);
    assertEquals(widened.response.status, 403);
    const kept = await connectPair(world.bridge(newer), b.app, [READ]);
    assert(kept.ok);

    // 대상 앱의 새 release에서 command가 사라지면 옛 grant가 남아도 부르지 못한다.
    world.observations.set(b.app, {
      ...world.observations.get(b.app)!,
      commands: [SAVE],
    });
    const removed = await connectPair(world.bridge(newer), b.app, [READ]);
    assert(!removed.ok);
    assertEquals(removed.response.status, 403);
  });
});

Deno.test("apps/permissions#R29: 앱을 닫으면 그 앱이 source이거나 target인 새 준비를 막고 새 프로세스부터 다시 열린다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2);
    world.declare(a, b, [READ]);
    world.grant(a, b, [READ]);
    const ok = await connectPair(world.bridge(a), b.app, [READ]);
    assert(ok.ok);
    assertEquals(world.preparer.issued, 1);

    // target B를 닫는다: A→B 새 준비는 막힌다.
    world.preparer.close(b.app);
    const closedTarget = await connectPair(world.bridge(a), b.app, [READ]);
    assert(!closedTarget.ok);
    assertEquals(closedTarget.response.status, 503);
    // B가 새 nonce로 다시 시작하면 다시 열린다.
    world.observations.set(b.app, {
      ...world.observations.get(b.app)!,
      processNonce: "nonce-2b",
    });
    assert((await connectPair(world.bridge(a), b.app, [READ])).ok);

    // source A를 닫으면 A의 옛 broker 요청도 막힌다.
    world.preparer.close(a.app);
    const closedSource = await connectPair(world.bridge(a), b.app, [READ]);
    assert(!closedSource.ok);
    assertEquals(closedSource.response.status, 503);
  });
});

function incomingOf(peer: Peer, parent: string | null = null) {
  return {
    app: peer.app,
    release: peer.release,
    parent_invocation: parent,
  };
}

Deno.test("apps/connections#R7: 호출을 받은 출처(incoming)를 싣으면 ledger에 남지 않는 읽기만 거친 A→B→A도 준비 때 거절된다", async () => {
  await withWorld(async (world) => {
    const a = await world.addPeer(1);
    const b = await world.addPeer(2);
    const c = await world.addPeer(3);
    for (const [from, to] of [[a, b], [b, a], [c, a]]) {
      world.declare(from, to, [READ]);
      world.grant(from, to, [READ]);
    }
    const viaA = world.bridge(a);
    const viaB = world.bridge(b);
    const first = await connectPair(viaA, b.app, [READ]);
    assert(first.ok);
    // B는 A에게서 받은 호출(start 사실 없음)을 처리하다 A로 돌아간다.
    const loop = await connectPair(viaB, a.app, [READ], null, incomingOf(a));
    assert(!loop.ok);
    assertEquals(loop.response.status, 400);
    // 출처를 싣지 않으면 서비스는 알 수 없어 독립 호출로 본다(기록된 start가 없는 경우의 기존 동작).
    assert((await connectPair(viaB, a.app, [READ])).ok);

    // 서비스가 발급하지 않은 출처, 다른 release, 다른 부모를 주장하는 것은 거절된다.
    for (
      const claim of [
        incomingOf(c),
        { ...incomingOf(a), release: "rel_01h455vb4pex5v6nkc6gd5fd77" },
        incomingOf(a, PARENT),
      ]
    ) {
      const forged = await connectPair(viaB, a.app, [READ], null, claim);
      assert(!forged.ok);
      assertEquals(forged.response.status, 400);
      assertEquals(
        (forged.response.body as { error: { message: string } }).error.message,
        "call origin is not known",
      );
    }
    // 이 프로세스가 받지 않은 출처는 다른 앱이 대신 주장할 수 없다.
    const viaC = world.bridge(c);
    const borrowed = await connectPair(
      viaC,
      a.app,
      [READ],
      null,
      incomingOf(a),
    );
    assert(!borrowed.ok);
    assertEquals(borrowed.response.status, 400);
  });
});

Deno.test("apps/connections#R7: 출처를 이어 싣는 호출도 여덟 앱까지이고 아홉 번째 앱은 거절된다", async () => {
  await withWorld(async (world) => {
    const chain: Peer[] = [];
    for (let n = 1; n <= 9; n++) chain.push(await world.addPeer(n));
    for (let n = 0; n < 8; n++) {
      world.declare(chain[n], chain[n + 1], [READ]);
      world.grant(chain[n], chain[n + 1], [READ]);
    }
    for (let n = 0; n < 7; n++) {
      const prepared = await connectPair(
        world.bridge(chain[n]),
        chain[n + 1].app,
        [READ],
        null,
        n === 0 ? undefined : incomingOf(chain[n - 1]),
      );
      assert(prepared.ok, `hop ${n + 1}: ${JSON.stringify(prepared)}`);
      assertEquals(
        (prepared.value.connection["caller"] as { path: string[] }).path,
        chain.slice(0, n + 1).map((peer) => peer.app),
      );
    }
    const ninth = await connectPair(
      world.bridge(chain[7]),
      chain[8].app,
      [READ],
      null,
      incomingOf(chain[6]),
    );
    assert(!ninth.ok);
    assertEquals(ninth.response.status, 400);
  });
});
