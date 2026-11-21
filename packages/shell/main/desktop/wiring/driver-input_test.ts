import assert from "node:assert/strict";
import { test } from "node:test";

import { DRIVER_INPUT_CHANNEL } from "../../../ipc/shortcuts.ts";
import { electronDriverInput, type InputContents } from "./driver-input.ts";

function contents(id: number, host: InputContents | null = null) {
  const sent: unknown[] = [];
  const ignored: boolean[] = [];
  let destroyed = false;
  const self = {
    id,
    hostWebContents: host,
    isDestroyed: () => destroyed,
    send: (channel: string, payload: unknown) => {
      assert.equal(channel, DRIVER_INPUT_CHANNEL);
      sent.push(payload);
    },
    setIgnoreMenuShortcuts: (on: boolean) => void ignored.push(on),
  };
  return { self, sent, ignored, destroy: () => void (destroyed = true) };
}

// 깨지면 창이 표시를 풀지 못해 사람의 focus 이동을 계속 되돌리거나, 다른 창이 사람의 키를 버리게 하거나, 사람이 누른 page에서 친
// 키를 버린다.
test("표시는 켤 때의 창에 끝을 알리고, 그 창의 답만 받으며, 사람이 표시된 page를 누르면 그 page의 키를 사람의 것으로 둔다", async () => {
  const shell = contents(1);
  const other = contents(2);
  const page = contents(7, shell.self);
  const known = new Map<number, InputContents>([[7, page.self]]);
  const input = electronDriverInput({
    contents: (id) =>
      known.get(id)?.isDestroyed() ? undefined : known.get(id),
    schedule: () => () => {},
  });
  let release = () => {};
  const done = input.sending(
    7,
    () => new Promise<void>((resolve) => void (release = resolve)),
  );
  assert.deepEqual(shell.sent, [{ page: 7, event: "start" }]);
  assert.deepEqual(page.ignored, [true]);

  // 다른 창의 답은 받지 않고 표시를 받은 창의 답으로 input이 시작한다.
  input.answer(other.self, { page: 7, person: true });
  assert.equal(input.strayKey(7), true);
  input.answer({ id: shell.self.id }, { page: 7, person: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(input.strayKey(7), true);

  // lophn의 누르기는 사람의 것이 아니다. 사람의 누르기는 창에 알리고 그 page의 키를 버리지 않는다.
  await input.mouse(7, async () => input.pressed(page.self));
  assert.equal(input.strayKey(7), true);
  input.pressed(page.self);
  assert.deepEqual(shell.sent.at(-1), { page: 7, event: "person" });
  assert.equal(input.strayKey(7), false);

  // page가 사라져도 끝은 켤 때의 창에 간다.
  page.destroy();
  release();
  await done;
  assert.deepEqual(shell.sent.at(-1), { page: 7, event: "end" });
  assert.equal(input.marked(7), false);
});
