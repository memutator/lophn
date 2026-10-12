import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GLOBAL_PALETTE_ACCELERATOR,
  WINDOW_SHORTCUTS,
} from "../../ipc/shortcuts.ts";
import {
  type GlobalShortcutPort,
  installGlobalPalette,
} from "./global-shortcut.ts";

// OS에 등록하지 않는 가짜. 받은 등록·해제만 기억한다.
function fakePort(answer: "ok" | "taken" | "throws" = "ok") {
  const registered = new Map<string, () => void>();
  const attempts: string[] = [];
  const unregistered: string[] = [];
  const port: GlobalShortcutPort = {
    register(accelerator, callback) {
      attempts.push(accelerator);
      if (answer === "throws") throw new Error("conversion failure");
      if (answer === "taken") return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      unregistered.push(accelerator);
      registered.delete(accelerator);
    },
  };
  return { port, registered, attempts, unregistered };
}

test("shell/desktop#R18: 전역 팔레트는 CommandOrControl+Shift+K 하나만 등록하고 전역 Ctrl+K는 등록하지 않는다", () => {
  const fake = fakePort();
  let pressed = 0;
  const palette = installGlobalPalette({
    port: fake.port,
    onPalette: () => pressed += 1,
    log: () => {},
  });
  assert.equal(palette.state, "registered");
  assert.deepEqual(fake.attempts, ["CommandOrControl+Shift+K"]);
  assert.equal(GLOBAL_PALETTE_ACCELERATOR, "CommandOrControl+Shift+K");
  // 창 안 팔레트·런처 복귀 키와 다르다.
  assert.ok(
    !Object.values(WINDOW_SHORTCUTS).includes(
      GLOBAL_PALETTE_ACCELERATOR as never,
    ),
  );
  assert.equal(fake.registered.has("CommandOrControl+K"), false);
  fake.registered.get(GLOBAL_PALETTE_ACCELERATOR)!();
  assert.equal(pressed, 1);
});

for (const answer of ["taken", "throws"] as const) {
  test(`shell/desktop#R18: 등록이 실패하면(${answer}) 사용 불가로 안내하고 다른 key를 차지하지 않는다`, () => {
    const fake = fakePort(answer);
    let notices = 0;
    const palette = installGlobalPalette({
      port: fake.port,
      onPalette: () => assert.fail("not registered"),
      unavailable: () => notices += 1,
      log: () => {},
    });
    assert.equal(palette.state, "unavailable");
    assert.equal(notices, 1);
    assert.deepEqual(fake.attempts, [GLOBAL_PALETTE_ACCELERATOR]);
    assert.equal(fake.registered.size, 0);
    // 등록하지 않은 key는 풀지 않는다(다른 앱의 등록을 건드리지 않는다).
    palette.dispose();
    assert.deepEqual(fake.unregistered, []);
  });
}

test("shell/desktop#R18: 종료 때 자기 key만 한 번 푼다", () => {
  const fake = fakePort();
  const palette = installGlobalPalette({
    port: fake.port,
    onPalette: () => {},
    log: () => {},
  });
  palette.dispose();
  palette.dispose();
  assert.deepEqual(fake.unregistered, [GLOBAL_PALETTE_ACCELERATOR]);
  assert.equal(fake.registered.size, 0);
});
