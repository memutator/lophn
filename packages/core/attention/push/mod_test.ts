import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../../base/mod.ts";
import { createFakePushHandler } from "../../../../tests/support/fake-push/mod.ts";
import { createExpoPushSender, type PushMessage } from "./mod.ts";

const SEND = "http://push.test/--/api/v2/push/send";

const message = (to: string): PushMessage => ({
  to,
  title: "Needs you",
  data: { host: "h", kind: "inbox" },
  channelId: "needs-you",
  priority: "high",
  ttl: 3600,
});

// 시계와 timer를 손으로 돌리고 fetch는 메모리 fake push server로 보낸다.
function setup(url: () => string) {
  const fake = createFakePushHandler();
  const clock = manualClock(0);
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const calls: string[] = [];
  const dead: string[] = [];
  let down = false;
  const sender = createExpoPushSender({
    fetch: (async (input: string, init: RequestInit) => {
      calls.push(input);
      if (down) throw new Error("network");
      return fake.handle(new Request(input, init));
    }) as typeof fetch,
    url,
    clock,
    timers: {
      set(fn, ms) {
        const entry = { fn, ms, live: true };
        timers.push(entry);
        return entry;
      },
      clear(handle) {
        (handle as { live: boolean }).live = false;
      },
    },
    onDeadToken: (token) => dead.push(token),
  });
  // 기다리는 timer를 모두 즉시 돌린다(backoff와 영수증 timer 모두).
  const fire = () => {
    for (const entry of timers.splice(0)) if (entry.live) entry.fn();
  };
  return {
    fake,
    clock,
    timers,
    calls,
    dead,
    sender,
    fire,
    setDown: (v: boolean) => (down = v),
  };
}

test("remote.push가 비어 있으면 fetch를 한 번도 부르지 않는다", async () => {
  const t = setup(() => "");
  assert.equal(await t.sender.send(message("T1")), "dropped");
  assert.deepEqual(t.calls, []);
  assert.deepEqual(t.timers, []);
});

test("DeviceNotRegistered는 ticket과 receipt 단계 모두 token으로 알리고, 네트워크 실패와 500은 던지지 않고 dropped다", async () => {
  const t = setup(() => SEND);

  // ticket 단계
  t.fake.failNext("DeviceNotRegistered");
  assert.equal(await t.sender.send(message("T1")), "dropped");
  assert.deepEqual(t.dead, ["T1"]);

  // receipt 단계: ok ticket이고 15분 뒤 영수증이 DeviceNotRegistered
  assert.equal(await t.sender.send(message("T2")), "sent");
  assert.equal(await t.sender.send(message("T3")), "sent");
  t.fake.deadToken("T2");
  t.clock.advance(15 * 60 * 1000);
  t.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(t.dead, ["T1", "T2"]);
  assert.equal(t.fake.receiptJournal.length, 1);

  // 500은 backoff로 세 번 다시 해도 안 되면 dropped, 네트워크 오류도 같다
  t.fake.failNext(500, 500, 500, 500);
  const failing = t.sender.send(message("T4"));
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    t.fire();
  }
  assert.equal(await failing, "dropped");

  t.setDown(true);
  const offline = t.sender.send(message("T5"));
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    t.fire();
  }
  assert.equal(await offline, "dropped");
  t.sender.close();
});
