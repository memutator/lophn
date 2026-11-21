import assert from "node:assert/strict";
import { test } from "node:test";

import { createFocusKeeper } from "./person-focus.ts";

// 깨지면 사람이 치던 글이 agent의 page로 가거나, agent가 일하는 동안 사람이 옮긴 focus가 되돌려진다.
test("input을 넣는 동안 사람이 하지 않은 focus 이동은 삼키고 되돌리며, 사람이 옮긴 focus는 따른다", () => {
  const address = { name: "address" } as unknown as Element;
  const agentPage = { name: "agent page" } as unknown as Element;
  const palette = { name: "palette" } as unknown as Element;
  let now = 1000;
  let active: Element | null = address;
  const restored: (Element | null)[] = [];
  const queued: (() => void)[] = [];
  const keeper = createFocusKeeper({
    now: () => now,
    active: () => active,
    restore(element) {
      restored.push(element);
      active = element;
    },
    later: (run) => void queued.push(run),
  });
  const flush = () => {
    for (const run of queued.splice(0)) run();
  };

  // 표시가 없으면 아무것도 하지 않는다.
  assert.equal(keeper.focusEvent(), false);

  // agent의 click이 focus를 page로 가져갔다. 사람이 글자를 치는 중이어도 되돌린다.
  keeper.mark(true);
  active = agentPage;
  assert.equal(keeper.focusEvent(), true);
  flush();
  assert.deepEqual(restored, [address]);

  // 사람이 누르고 연 곳으로 옮긴 focus는 따르고, 끝에 되돌리지 않는다.
  now += 1000;
  keeper.person();
  active = palette;
  assert.equal(keeper.focusEvent(), false);
  flush();
  now += 1000;
  keeper.mark(false);
  assert.deepEqual(restored, [address]);

  // focus event 없이 남은 이동도 표시가 끝날 때 되돌린다.
  keeper.mark(true);
  active = agentPage;
  keeper.mark(false);
  assert.deepEqual(restored, [address, palette]);
});
