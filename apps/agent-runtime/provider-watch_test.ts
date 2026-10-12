import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { RunDriver } from "./run-driver.ts";
import { createProviderWatch } from "./provider-watch.ts";
import { startRunPump } from "./product-driver.ts";

// lophn-agent/harness/provider#R4 [agent-I53]: Disconnect(ProviderDisconnected)를 core event로 따라 읽어 그
// provider로 진행 중인 run에 회수를 알린다. 시험의 core는 events/list를 흉내 내는 함수다.

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const OTHER = "pvd_01arz3ndektsv4rrffq69g5fb0";

function disconnected(seq: string, subject: string) {
  return {
    seq,
    type: "ProviderDisconnected",
    subject,
    actor: "user",
    run: null,
    payload: { definition_key: "anthropic" },
    at: "2026-10-12T00:00:00.000Z",
  };
}

function page(
  events: ReturnType<typeof disconnected>[],
  scanned: string,
  head: string,
) {
  return {
    events,
    scanned_through_seq: scanned,
    head_seq: head,
    as_of_seq: head,
    next_cursor: null,
  };
}

Deno.test("lophn-agent/harness/provider#R4 [agent-I53]: ProviderDisconnected마다 그 provider의 run 회수를 알리고 훑은 event는 다시 처리하지 않는다", async () => {
  const bodies: unknown[] = [];
  const revoked: string[] = [];
  const watch = createProviderWatch({
    cursor: "5",
    read: (path, body) => {
      assertEquals(path, "/v1/events/list");
      bodies.push(body);
      const after = (body as { after_seq: string }).after_seq;
      if (after === "5") {
        return Promise.resolve(ok(page(
          [disconnected("6", PROVIDER), disconnected("8", OTHER)],
          "8",
          "8",
        )));
      }
      return Promise.resolve(ok(page([], after, after)));
    },
    revokeProvider: (provider) => {
      revoked.push(provider);
      return Promise.resolve();
    },
  });

  assert((await watch.poll()).ok);
  assertEquals(revoked, [PROVIDER, OTHER]);
  assert((await watch.poll()).ok);
  // 두 번째 훑기는 첫 훑기가 지나간 위치 다음부터다. 같은 Disconnect를 다시 알리지 않는다.
  assertEquals(bodies, [
    { after_seq: "5", types: ["ProviderDisconnected"] },
    { after_seq: "8", types: ["ProviderDisconnected"] },
  ]);
  assertEquals(revoked, [PROVIDER, OTHER]);
});

Deno.test("lophn-agent/harness/provider#R4 [agent-I53]: core를 읽지 못하면 위치를 옮기지 않아 다음 훑기가 같은 Disconnect를 이어 처리한다", async () => {
  const revoked: string[] = [];
  let reachable = false;
  const bodies: unknown[] = [];
  const watch = createProviderWatch({
    cursor: "0",
    read: (_path, body) => {
      bodies.push(body);
      return Promise.resolve<Result<unknown>>(
        reachable
          ? ok(page([disconnected("3", PROVIDER)], "3", "3"))
          : err({ code: "unavailable", message: "core is not reachable" }),
      );
    },
    revokeProvider: (provider) => {
      revoked.push(provider);
      return Promise.resolve();
    },
  });

  const failed = await watch.poll();
  assert(!failed.ok);
  assertEquals(revoked, []);
  reachable = true;
  assert((await watch.poll()).ok);
  assertEquals(revoked, [PROVIDER]);
  assertEquals(bodies, [
    { after_seq: "0", types: ["ProviderDisconnected"] },
    { after_seq: "0", types: ["ProviderDisconnected"] },
  ]);
});

Deno.test("lophn-agent/harness/provider#R4 [agent-I53]: pump는 매 주기 provider 알림을 훑고 한 번의 실패가 pump를 끝내지 않는다", async () => {
  const stop = new AbortController();
  let rounds = 0;
  const driver = {
    startNext: () => Promise.resolve({ kind: "idle" as const }),
  } as unknown as RunDriver;
  await startRunPump({
    driver,
    providerWatch: {
      poll() {
        rounds++;
        if (rounds >= 3) stop.abort();
        return rounds === 1
          ? Promise.reject(new Error("one bad round"))
          : Promise.resolve(ok(undefined));
      },
    },
    signal: stop.signal,
    idleMs: 1,
  });
  assert(rounds >= 3);
});
