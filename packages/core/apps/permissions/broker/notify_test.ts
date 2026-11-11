import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import { createNotifyService } from "./notify.ts";

const LIVE = {
  app: "demo",
  release: "r1",
  mode: "live" as const,
  processNonce: "n1",
};

function setup(access: { kind: string; scope: unknown }[], release = "r1") {
  const posted: unknown[] = [];
  const service = createNotifyService({
    access: {
      candidate: () => false,
      current: () =>
        Promise.resolve(
          ok({
            release,
            scope: { access, app_calls: [] },
            tools: [],
          }),
        ) as never,
    },
    core: {
      post: (_child, input) => {
        posted.push(input);
        return Promise.resolve(ok({ id: "ntc_1" }));
      },
      setTray: (_child, input) => {
        posted.push(input);
        return Promise.resolve(ok({ set: true }));
      },
    },
  });
  const send = (child: typeof LIVE | { mode: "preview" } = LIVE) =>
    service.send({ ...LIVE, ...child } as typeof LIVE, {
      process_nonce: "n1",
      mode: child.mode,
      title: "Weekly limit under 10%",
    });
  const tray = (child: typeof LIVE | { mode: "preview" } = LIVE) =>
    service.tray({ ...LIVE, ...child } as typeof LIVE, {
      process_nonce: "n1",
      mode: child.mode,
      text: "42% left",
      tone: "good",
    });
  return { posted, send, tray };
}

// 사람이 notify.send를 허락하지 않은 앱, preview 자식, 교체된 옛 release의 자식은 사람에게 닿지 못한다.
test("notify is refused without the notify.send grant and never reaches core", async () => {
  const granted = [{ kind: "notify.send", scope: {} }];

  const none = setup([{ kind: "net.fetch", scope: { host: "x", port: 443 } }]);
  const refused = await none.send();
  assert.ok(!refused.ok);
  assert.deepStrictEqual(refused.error.code, "forbidden");
  assert.deepStrictEqual(none.posted, []);

  const preview = setup(granted);
  const fromPreview = await preview.send({ mode: "preview" });
  assert.ok(!fromPreview.ok);
  assert.deepStrictEqual(fromPreview.error.code, "forbidden");
  assert.deepStrictEqual(preview.posted, []);

  const stale = setup(granted, "r2");
  const fromStale = await stale.send();
  assert.ok(!fromStale.ok);
  assert.deepStrictEqual(fromStale.error.code, "forbidden");
  assert.deepStrictEqual(stale.posted, []);

  const allowed = setup(granted);
  assert.deepStrictEqual(await allowed.send(), ok({ notified: true }));
  assert.deepStrictEqual(allowed.posted, [{ title: "Weekly limit under 10%" }]);
});

// tray 값도 같은 권한(notify.send)이다. grant가 없거나 preview·옛 release인 앱의 setTray는 값을 바꾸지 못한다.
test("setTray is refused without the notify.send grant and never reaches core", async () => {
  const none = setup([{ kind: "net.fetch", scope: { host: "x", port: 443 } }]);
  const refused = await none.tray();
  assert.ok(!refused.ok);
  assert.deepStrictEqual(refused.error.code, "forbidden");
  assert.deepStrictEqual(none.posted, []);

  const granted = [{ kind: "notify.send", scope: {} }];
  const preview = setup(granted);
  assert.ok(!(await preview.tray({ mode: "preview" })).ok);
  assert.deepStrictEqual(preview.posted, []);

  const allowed = setup(granted);
  assert.deepStrictEqual(await allowed.tray(), ok({ set: true }));
  assert.deepStrictEqual(allowed.posted, [{ text: "42% left", tone: "good" }]);
});
