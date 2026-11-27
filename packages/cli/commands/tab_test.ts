import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import { TAB_COMMANDS } from "./tab.ts";
import type { CommandContext } from "./types.ts";

const open = TAB_COMMANDS.find((command) => command.name === "tab.open")!;
const app = "app_0123456789ab";

function fakeCtx() {
  const sent: unknown[] = [];
  const ctx = {
    workspace: null,
    core: {
      read: (_route: unknown, input: unknown) => {
        sent.push(input);
        return Promise.resolve(ok({ tab: "tab_x", status: "accepted" }));
      },
    },
  } as unknown as CommandContext;
  return { ctx, sent };
}

// phone 탭은 실제 폰이라 desktop 기기 이름을 받지 않는다. --screen은 --phone과 된다.
test("tab open --phone은 --device와 같이 못 주고 --screen과 phone target으로 간다", async () => {
  const bad = fakeCtx();
  const withDevice = await open.run({ phone: app, device: "Pixel" }, bad.ctx);
  assert.ok(!withDevice.ok);
  assert.equal(withDevice.error.code, "invalid_input");
  assert.equal(bad.sent.length, 0);

  const good = fakeCtx();
  const ran = await open.run({ phone: app, screen: "home" }, good.ctx);
  assert.ok(ran.ok);
  assert.deepEqual(good.sent, [{ target: { phone: { app, screen: "home" } } }]);
});

test("tab open --terminal은 --command·--cwd·--cols·--rows와 함께 terminal target으로 가고 --terminal 없이는 거부된다", async () => {
  const bad = fakeCtx();
  const withoutTerm = await open.run(
    { url: "https://example.com", command: "vim" },
    bad.ctx,
  );
  assert.ok(!withoutTerm.ok && withoutTerm.error.code === "invalid_input");
  assert.equal(bad.sent.length, 0);

  const good = fakeCtx();
  const ran = await open.run(
    { terminal: true, command: "vim a.txt", cols: 100, rows: 30 },
    good.ctx,
  );
  assert.ok(ran.ok);
  assert.deepEqual(good.sent, [
    {
      target: { terminal: { command: "vim a.txt", columns: 100, rows: 30 } },
    },
  ]);
});
