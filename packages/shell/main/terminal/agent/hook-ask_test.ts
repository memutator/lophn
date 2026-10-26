import assert from "node:assert/strict";
import { test } from "node:test";

import { createHookAsker, type HookAskWindow } from "./hook-ask.ts";

function fakeWindow(contentsId: number) {
  const sent: unknown[] = [];
  let gone: (() => void) | undefined;
  const window: HookAskWindow = {
    contentsId,
    send: (_channel, payload) => sent.push(payload),
    onGone: (run) => {
      gone = run;
      return () => {
        gone = undefined;
      };
    },
  };
  return { window, sent, close: () => gone?.() };
}

const input = { harness: "claude", label: "Claude Code", files: ["/a"] };

test("hook ask: no window or a window that closes before answering means no", async () => {
  const none = createHookAsker({ pick: () => null, requestId: () => "r1" });
  assert.equal(await none.ask(input), false);

  const win = fakeWindow(7);
  const asker = createHookAsker({
    pick: () => win.window,
    requestId: () => "r2",
  });
  const asked = asker.ask(input);
  win.close();
  assert.equal(await asked, false);
  // 끝난 request의 늦은 답은 버려진다.
  asker.answer(7, "r2", true);
});

test("hook ask: only the asked window's answer counts", async () => {
  const win = fakeWindow(7);
  const asker = createHookAsker({
    pick: () => win.window,
    requestId: () => "r3",
  });
  const asked = asker.ask(input);
  assert.deepEqual(win.sent, [{ request: "r3", ...input }]);
  asker.answer(8, "r3", true);
  asker.answer(7, "r3", true);
  assert.equal(await asked, true);
});
