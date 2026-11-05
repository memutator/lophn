import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksText,
  textBlocks,
} from "../../../protocol/lophn-agent/content-block.ts";
import type { RoutedInput } from "../../router/ports.ts";
import { createQueue } from "./queue.ts";

const SESSION = "ses_s1" as never;

function input(
  kind: RoutedInput["kind"],
  body: string,
  delivery: RoutedInput["delivery"] = "next_turn",
): RoutedInput {
  return {
    kind,
    from:
      kind === "message"
        ? { kind: "human" }
        : {
            kind: "agent",
            session: "ses_a1",
          },
    call: null,
    reply_to: null,
    body: textBlocks(body),
    refs: [],
    delivery,
    message: null,
    reply: null,
    outcome: null,
    event: null,
    notice: null,
    step: null,
    unattended: false,
  } as RoutedInput;
}

test("사람 메시지가 call보다 먼저 나오고 steer는 도는 turn이 없으면 다음 turn 입력이 된다", () => {
  const queue = createQueue();
  queue.put(SESSION, input("call", "c1"));
  queue.put(SESSION, input("message", "m1"));
  queue.put(SESSION, input("call", "c2"));
  queue.put(SESSION, input("message", "m2", "steer"));
  assert.deepStrictEqual(queue.pendingSteering(SESSION), []);
  const order = [1, 2, 3, 4].map(() => blocksText(queue.take(SESSION)!.body));
  assert.deepStrictEqual(order, ["m1", "m2", "c1", "c2"]);
  assert.deepStrictEqual(queue.take(SESSION), undefined);

  // 도는 turn이 있으면 steer는 queue가 아니라 steering 목록에 간다.
  queue.setRunning(SESSION, true);
  queue.put(SESSION, input("message", "s1", "steer"));
  assert.deepStrictEqual(queue.next(SESSION), undefined);
  assert.deepStrictEqual(
    queue.pendingSteering(SESSION).map((i) => blocksText(i.body)),
    ["s1"],
  );
});

test("큐의 글을 고치면 다음 turn이 고친 글을 가져가고, 순서를 바꾸면 그 순서로 가져간다", () => {
  const queue = createQueue();
  queue.setRunning(SESSION, true);
  queue.put(SESSION, {
    ...input("message", "old"),
    message: "msg_q1",
  } as RoutedInput);
  queue.put(SESSION, {
    ...input("message", "q2"),
    message: "msg_q2",
  } as RoutedInput);

  assert.deepStrictEqual(
    queue.edit(SESSION, "msg_q1", textBlocks("edited")),
    true,
  );
  assert.deepStrictEqual(queue.move(SESSION, "msg_q2", "up"), true);
  assert.deepStrictEqual(
    [
      blocksText(queue.take(SESSION)!.body),
      blocksText(queue.take(SESSION)!.body),
    ],
    ["q2", "edited"],
  );
  // 이미 가져간 메시지는 고칠 수 없다.
  assert.deepStrictEqual(
    queue.edit(SESSION, "msg_q1", textBlocks("again")),
    false,
  );
});

test("지금 올리기와 빼기는 아직 가져가지 않은 사람 메시지에만 먹는다", () => {
  const queue = createQueue();
  const queued = {
    ...input("message", "q1"),
    message: "msg_q1",
  } as RoutedInput;
  queue.put(SESSION, queued);
  // 도는 turn이 없으면 올릴 곳이 없다.
  assert.deepStrictEqual(queue.steerNow(SESSION, "msg_q1"), false);
  queue.setRunning(SESSION, true);
  assert.deepStrictEqual(queue.steerNow(SESSION, "msg_q1"), true);
  assert.deepStrictEqual(queue.next(SESSION), undefined);
  assert.deepStrictEqual(
    queue.pendingSteering(SESSION).map((i) => i.delivery),
    ["steer"],
  );
  // 이미 steer로 넘어간 메시지와 없는 메시지는 뺄 수 없다.
  assert.deepStrictEqual(queue.remove(SESSION, "msg_q1"), false);
  queue.put(SESSION, {
    ...input("message", "q2"),
    message: "msg_q2",
  } as RoutedInput);
  assert.deepStrictEqual(queue.remove(SESSION, "msg_q2"), true);
  assert.deepStrictEqual(queue.next(SESSION), undefined);
});
