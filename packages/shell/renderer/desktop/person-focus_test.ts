import assert from "node:assert/strict";
import { test } from "node:test";

import { createFocusKeeper, movesFocus } from "./person-focus.ts";

const element = (name: string) => ({ name }) as unknown as Element;

function setup() {
  const address = element("address");
  const agentPage = element("agent page webview");
  const otherPage = element("other page webview");
  const dialog = element("dialog");
  let now = 1000;
  const state = {
    active: address as Element | null,
    focused: true,
    webviews: new Map<number, Element>([
      [7, agentPage],
      [8, otherPage],
    ]),
  };
  const restored: (Element | null)[] = [];
  const queued: (() => void)[] = [];
  const keeper = createFocusKeeper({
    now: () => now,
    active: () => state.active,
    focused: () => state.focused,
    restore(to) {
      restored.push(to);
      state.active = to;
    },
    later: (run) => void queued.push(run),
    webviewOf: (page) => state.webviews.get(page) ?? null,
  });
  const flush = () => {
    for (const run of queued.splice(0)) run();
  };
  const tick = (ms: number) => {
    now += ms;
  };
  return {
    keeper,
    state,
    restored,
    flush,
    tick,
    address,
    agentPage,
    otherPage,
    dialog,
  };
}

// 깨지면 사람이 치던 글이 agent의 page로 가거나, agent가 일하는 동안 열린 dialog·사람이 누른 page의 focus가 되돌려진다.
test("표시 중 focus가 그 page로 들어간 것과 그 page에 Tab을 넣은 뒤의 이동만 되돌리고, 다른 이동은 그대로 둔다", () => {
  const {
    keeper,
    state,
    restored,
    flush,
    tick,
    address,
    agentPage,
    otherPage,
    dialog,
  } = setup();

  // 표시가 없으면 아무것도 하지 않는다.
  assert.equal(keeper.focusEvent(null), false);

  // agent의 click이 focus를 page로 가져갔다: event를 삼키고 되돌린다.
  assert.equal(keeper.message({ page: 7, event: "start" }), false);
  state.active = agentPage;
  assert.equal(keeper.focusEvent(agentPage), true);
  assert.equal(keeper.focusEvent(null), true);
  flush();
  assert.deepEqual(restored, [address]);

  // 창의 focus만 page로 갔고 activeElement는 그대로다: 되돌린다.
  state.focused = false;
  keeper.focusEvent(null);
  flush();
  assert.deepEqual(restored, [address, address]);
  state.focused = true;

  // timer가 연 dialog가 focus를 가져갔다: 그대로 두고, 그 뒤 agent의 click은 dialog로 되돌린다.
  state.active = dialog;
  assert.equal(keeper.focusEvent(address), false);
  flush();
  state.active = agentPage;
  keeper.focusEvent(null);
  flush();
  assert.deepEqual(restored, [address, address, dialog]);

  // 사람이 다른 page를 눌렀다(main이 알린다): 그대로 둔다.
  tick(1000);
  keeper.message({ page: 8, event: "person" });
  state.active = otherPage;
  assert.equal(keeper.focusEvent(null), false);
  flush();
  assert.equal(restored.length, 3);

  // page에 Tab을 넣은 뒤 focus가 창의 다음 요소로 갔다: 되돌린다.
  tick(1000);
  keeper.message({ page: 7, event: "tab" });
  state.active = address;
  keeper.focusEvent(address);
  flush();
  assert.deepEqual(restored.at(-1), otherPage);
  keeper.message({ page: 7, event: "end" });

  // 사람의 focus가 그 page에 있었으면 start가 알리고, 그 page 안의 이동은 되돌리지 않는다.
  state.active = agentPage;
  assert.equal(keeper.message({ page: 7, event: "start" }), true);
  keeper.focusEvent(null);
  flush();
  assert.equal(restored.length, 4);

  // page의 <webview>가 사라지면 end가 오지 않아도 표시가 풀린다.
  state.webviews.delete(7);
  state.active = address;
  keeper.focusEvent(null);
  flush();
  assert.equal(keeper.focusEvent(null), false);
  assert.equal(restored.length, 4);
});

test("입력칸에 글자를 치는 것은 사람이 focus를 옮긴 것이 아니다", () => {
  assert.equal(movesFocus({ key: "k", editable: true }), false);
  assert.equal(movesFocus({ key: "Backspace", editable: true }), false);
  assert.equal(movesFocus({ key: "k", ctrlKey: true, editable: true }), true);
  assert.equal(movesFocus({ key: "Tab", editable: true }), true);
  assert.equal(movesFocus({ key: "k", editable: false }), true);
  assert.equal(movesFocus({ editable: true }), true);
});
