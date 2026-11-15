import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/mod.ts";
import { createAttention } from "./mod.ts";

const SESSION = "ses_a";

function setup(opened_by_app = false) {
  const clock = manualClock(1_700_000_000_000);
  const changed: string[] = [];
  const attention = createAttention({
    clock,
    lookup: async () => ({
      title: "t",
      agent: "a",
      harness: null,
      opened_by_app,
    }),
    unseenChanged: (session) => changed.push(session),
  });
  const send = (type: string, payload: unknown = {}) =>
    attention.event({ type, session: SESSION, payload } as unknown as BusEvent);
  const ended = () =>
    send("TurnEnded", { outcome: { kind: "completed" }, active_ms: 1000 });
  const sessions = () => attention.unseenList().map((item) => item.session);
  return { clock, attention, send, ended, sessions, changed };
}

test("unseen은 앞에 있는 host가 보고 있지 않을 때만 서고 다른 host가 보면 꺼진다", async () => {
  const { attention, ended, sessions, changed } = setup();
  // 앞에 있지만 다른 session을 보는 desktop: 선다.
  attention.report("user", {
    focused: true,
    idle_ms: 0,
    looking: ["ses_other"],
  });
  await ended();
  assert.deepEqual(sessions(), [SESSION]);
  assert.deepEqual(changed, [SESSION]);
  // 폰이 앞에서 그 session을 보면 꺼진다.
  attention.report("device:dev_1", { focused: true, looking: [SESSION] });
  assert.deepEqual(sessions(), []);
  // 이미 보고 있는 동안 끝나면 서지 않는다.
  await ended();
  assert.deepEqual(sessions(), []);
  // 앞에 있지 않은(focus 없음) host가 보고 있다고 해도 본 것이 아니다.
  attention.forgetReporter("device:dev_1");
  attention.report("user", { focused: false, idle_ms: 0, looking: [SESSION] });
  await ended();
  assert.deepEqual(sessions(), [SESSION]);
});

test("승인·질문 대기와 app이 연 session의 끝은 unseen을 세우지 않고 다음 turn이 끄고 사람이 지운다", async () => {
  const { send, ended, sessions, attention } = setup();
  await send("TurnRequestOpened", { request: { to_parent: false } });
  await send("QuestionAsked", { to_parent: false });
  assert.deepEqual(sessions(), []);
  await ended();
  assert.deepEqual(sessions(), [SESSION]);
  await send("TurnStarted");
  assert.deepEqual(sessions(), []);
  await ended();
  assert.equal(attention.dismiss(SESSION), true);
  assert.equal(attention.dismiss(SESSION), false);

  const app = setup(true);
  await app.ended();
  assert.deepEqual(app.sessions(), []);
});
