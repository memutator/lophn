import assert from "node:assert/strict";
import { test } from "node:test";

import { mayCall, TerminalFocusTable } from "./terminal-focus.ts";

// shell main은 이 검사를 통과한 일에만 자기 shell capability를 실어 core에 넘긴다. 이것이 열리면 아무 lophn 창이나 사람 입력으로
// 어느 터미널에나 친다.
test("focus가 없는 창의 입력·다시 시작과 그 터미널을 보이지 않는 창의 응답은 core에 가지 않는다", () => {
  const table = new TerminalFocusTable();
  const [win, other] = [1, 2];
  const call = { terminal: "trm_a", generation: 1 };
  const rows = () =>
    (["input", "restart", "response"] as const).map((channel) => [
      mayCall(table, channel, win, call),
      mayCall(table, channel, other, call),
    ]);

  assert.deepEqual(rows(), [
    [false, false],
    [false, false],
    [false, false],
  ]);

  table.focus(win, "trm_a", 1);
  table.show(other, "trm_a");
  assert.deepEqual(rows(), [
    [true, false],
    [true, false],
    [false, true],
  ]);
  // 지난 generation의 입력은 가지 않는다.
  assert.equal(
    mayCall(table, "input", win, { terminal: "trm_a", generation: 2 }),
    false,
  );

  // 한 창의 두 display가 같은 터미널을 보이면 하나를 놓아도 응답은 간다. 응답이 막히면 터미널의 답을 기다리는 program이 멎는다.
  table.show(other, "trm_a");
  table.hide(other, "trm_a");
  assert.equal(mayCall(table, "response", other, call), true);

  table.blur(win, "trm_a");
  table.hide(other, "trm_a");
  table.focus(win, "trm_a", 1);
  table.show(win, "trm_a");
  table.forget(win);
  assert.deepEqual(rows(), [
    [false, false],
    [false, false],
    [false, false],
  ]);
});

test("renderer는 terminals/input·restart를 core에 바로 부르지 못한다", async () => {
  // desktop/core는 이 폴더의 tsconfig.json(noUncheckedIndexedAccess) 밖이라 type 검사가 그 import를 따라가지 않게 경로를 값으로 둔다.
  const allowlist = "./core/allowlist.ts";
  const { isAllowed } = (await import(allowlist)) as {
    isAllowed(kind: string, resource: string, method: string): boolean;
  };
  assert.equal(isAllowed("memory", "terminals", "input"), false);
  assert.equal(isAllowed("memory", "terminals", "restart"), false);
  assert.equal(isAllowed("memory", "terminals", "open"), true);
});
