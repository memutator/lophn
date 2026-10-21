import { assertEquals } from "@std/assert";
import type { RoutedInput } from "../../router/ports.ts";
import { createInbox } from "./inbox.ts";

const SESSION = "ses_s1" as never;

function input(
  kind: RoutedInput["kind"],
  body: string,
  delivery: RoutedInput["delivery"] = "next_turn",
): RoutedInput {
  return {
    kind,
    from: kind === "message" ? { kind: "human" } : {
      kind: "agent",
      session: "ses_a1",
    },
    call: null,
    reply_to: null,
    body,
    refs: [],
    delivery,
    message: null,
    reply: null,
    outcome: null,
    event: null,
    notice: null,
    unattended: false,
  } as RoutedInput;
}

Deno.test("사람 메시지가 call보다 먼저 나오고 steer는 도는 turn이 없으면 다음 turn 입력이 된다", () => {
  const inbox = createInbox();
  inbox.put(SESSION, input("call", "c1"));
  inbox.put(SESSION, input("message", "m1"));
  inbox.put(SESSION, input("call", "c2"));
  inbox.put(SESSION, input("message", "m2", "steer"));
  assertEquals(inbox.pendingSteering(SESSION), []);
  const order = [1, 2, 3, 4].map(() => inbox.take(SESSION)?.body);
  assertEquals(order, ["m1", "m2", "c1", "c2"]);
  assertEquals(inbox.take(SESSION), undefined);

  // 도는 turn이 있으면 steer는 입력함이 아니라 steering 목록에 간다.
  inbox.setRunning(SESSION, true);
  inbox.put(SESSION, input("message", "s1", "steer"));
  assertEquals(inbox.next(SESSION), undefined);
  assertEquals(inbox.pendingSteering(SESSION).map((i) => i.body), ["s1"]);
});

Deno.test("지금 올리기와 빼기는 아직 가져가지 않은 사람 메시지에만 먹는다", () => {
  const inbox = createInbox();
  const queued = {
    ...input("message", "q1"),
    message: "msg_q1",
  } as RoutedInput;
  inbox.put(SESSION, queued);
  // 도는 turn이 없으면 올릴 곳이 없다.
  assertEquals(inbox.steerNow(SESSION, "msg_q1"), false);
  inbox.setRunning(SESSION, true);
  assertEquals(inbox.steerNow(SESSION, "msg_q1"), true);
  assertEquals(inbox.next(SESSION), undefined);
  assertEquals(inbox.pendingSteering(SESSION).map((i) => i.delivery), [
    "steer",
  ]);
  // 이미 steer로 넘어간 메시지와 없는 메시지는 뺄 수 없다.
  assertEquals(inbox.remove(SESSION, "msg_q1"), false);
  inbox.put(
    SESSION,
    { ...input("message", "q2"), message: "msg_q2" } as RoutedInput,
  );
  assertEquals(inbox.remove(SESSION, "msg_q2"), true);
  assertEquals(inbox.next(SESSION), undefined);
});
