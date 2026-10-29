import assert from "node:assert/strict";
import { test } from "node:test";

import { followAfterInput, followAfterScroll } from "./follow.ts";

// 두 번 고쳤는데 다시 생긴 bug다. 맨 아래에서 1px씩 올린 wheel이 매번 맨 아래로 되돌아갔다.
test("맨 아래에서 위로 올린 입력은 1px이어도 따라가기를 끄고, 여유 안의 scroll이 다시 켜지 않는다", () => {
  let following = followAfterInput(true, { kind: "wheel", deltaY: -1 }, 626);
  assert.equal(following, false);
  following = followAfterScroll(following, 626, 625, 1);
  assert.equal(following, false);
  // 아래로 내려 여유에 들어오면 다시 따라간다.
  assert.equal(followAfterScroll(following, 600, 610, 16), true);
  // 창이 커져 대화가 다 들어왔다.
  assert.equal(followAfterScroll(following, 334, 0, 0), true);
});

test("맨 아래 고정이 scrollTop을 올린 같은 frame에 위로 올린 wheel은 다시 따라가지 않는다", () => {
  // 고정이 880에서 900으로 옮겼고(thread-scroll이 900을 기록한다) wheel이 897로 올렸다.
  const following = followAfterInput(true, { kind: "wheel", deltaY: -3 }, 900);
  assert.equal(followAfterScroll(following, 900, 897, 3), false);
});

test("올라갈 데가 없거나 아래로 가는 입력은 따라가기를 끄지 않는다", () => {
  assert.equal(followAfterInput(true, { kind: "wheel", deltaY: -5 }, 0), true);
  assert.equal(followAfterInput(true, { kind: "wheel", deltaY: 5 }, 300), true);
  assert.equal(
    followAfterInput(
      true,
      { kind: "key", key: "PageUp", shiftKey: false },
      300,
    ),
    false,
  );
  assert.equal(followAfterInput(true, { kind: "scrollbar" }, 300), false);
});
