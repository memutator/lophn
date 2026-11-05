import assert from "node:assert/strict";
import { test } from "node:test";
import { textBlocks } from "../../../protocol/lophn-agent/content-block.ts";
import type { RoutedInput } from "../../router/ports.ts";
import { createQueue } from "./queue.ts";
import { createTurnStarter } from "./work.ts";

const SESSION = "ses_s1" as never;

function input(kind: RoutedInput["kind"], message: string): RoutedInput {
  return {
    kind,
    from: kind === "message" ? { kind: "human" } : { kind: "program" },
    call: null,
    reply_to: null,
    body: textBlocks(message),
    refs: [],
    delivery: "next_turn",
    message,
    reply: null,
    outcome: null,
    event: null,
    notice: null,
    step: null,
    unattended: false,
  } as unknown as RoutedInput;
}

test("began picks the message StartTurn recorded even if the queue head changed, and consumes nothing if it is gone", () => {
  const queue = createQueue();
  const starter = createTurnStarter({ queue });
  queue.put(SESSION, input("call", "msg_call"));
  assert.equal(starter.next()?.input.message, "msg_call");

  // StartTurn이 나가는 사이 사람 메시지가 들어와 머리가 바뀐다.
  queue.put(SESSION, input("message", "msg_human"));
  assert.equal(queue.next(SESSION)?.message, "msg_human");

  const taken = starter.began(SESSION, "msg_call" as never);
  assert.equal(taken?.message, "msg_call");
  assert.equal(queue.next(SESSION)?.message, "msg_human");
  assert.equal(queue.isRunning(SESSION), true);
  starter.ended(SESSION);

  // 그 입력이 이미 없으면 머리를 대신 집지 않고 session도 도는 중으로 두지 않는다.
  assert.equal(starter.began(SESSION, "msg_call" as never), undefined);
  assert.equal(queue.next(SESSION)?.message, "msg_human");
  assert.equal(queue.isRunning(SESSION), false);
});
