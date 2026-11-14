import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BusEvent,
  gatewayServerFrameSchema,
} from "../../protocol/events/mod.ts";
import {
  createBus,
  createGatewaySession,
  GATEWAY_BUFFER_LIMIT,
} from "./mod.ts";

const SES_A = "ses_00000000000000000000000001";
const SES_B = "ses_00000000000000000000000002";

function turnStarted(session: string): BusEvent {
  return {
    session,
    type: "TurnStarted",
    at: "2026-10-16T00:00:00.000Z",
    payload: {
      turn: "trn_00000000000000000000000001",
      input_message: "msg_00000000000000000000000001",
    },
  } as BusEvent;
}
function acpUpdated(session: string): BusEvent {
  return {
    type: "AcpUpdated",
    session,
    subject: null,
    at: "2026-10-16T00:00:00.000Z",
    payload: { session, update: { type: "session_reset" } },
  } as BusEvent;
}
const stateChanged = {
  type: "StateChanged",
  subject: null,
  at: "2026-10-16T00:00:00.000Z",
  payload: { changes: [{ name: "settings", id: "a" }] },
} as BusEvent;

function fakeSocket() {
  const sent: unknown[] = [];
  const closed: number[] = [];
  let buffered = 0;
  return {
    sent,
    closed,
    setBuffered: (bytes: number) => (buffered = bytes),
    socket: {
      send: (text: string) => {
        sent.push(gatewayServerFrameSchema.parse(JSON.parse(text)));
      },
      close: (code: number) => void closed.push(code),
      bufferedAmount: () => buffered,
    },
  };
}

test("느린 구독자는 끊기고 다시 붙으면 snapshot부터 다시 읽게 한다", () => {
  const bus = createBus();
  const first = fakeSocket();
  const session = createGatewaySession(first.socket, bus);
  session.receive(
    JSON.stringify({
      type: "watch",
      conditions: [{ session: SES_A }, { types: ["StateChanged"] }],
    }),
  );
  // ready가 먼저 오고, 조건에 맞는 event만 한 번씩 온다(두 조건에 다 맞아도 한 번).
  bus.publish(turnStarted(SES_A));
  bus.publish(turnStarted(SES_B));
  bus.publish(stateChanged);
  // 남지 않는 AcpUpdated도 envelope의 session으로 걸러진다.
  bus.publish(acpUpdated(SES_A));
  bus.publish(acpUpdated(SES_B));
  assert.deepStrictEqual(
    first.sent.map((frame) => (frame as { type: string }).type),
    ["ready", "event", "event", "event"],
  );

  // 한도를 넘으면 closed(slow_consumer)와 1013, 그 뒤 publish는 가지 않는다.
  first.setBuffered(GATEWAY_BUFFER_LIMIT + 1);
  bus.publish(turnStarted(SES_A));
  assert.deepStrictEqual(first.sent.at(-1), {
    type: "closed",
    reason: "slow_consumer",
  });
  assert.deepStrictEqual(first.closed, [1013]);
  const count = first.sent.length;
  bus.publish(turnStarted(SES_A));
  assert.deepStrictEqual(first.sent.length, count);

  // 다시 붙으면 ready를 다시 받는다.
  const second = fakeSocket();
  createGatewaySession(second.socket, bus).receive(
    JSON.stringify({ type: "watch", conditions: [{ session: SES_A }] }),
  );
  assert.deepStrictEqual(second.sent, [{ type: "ready" }]);
  bus.publish(turnStarted(SES_A));
  assert.ok(second.sent.length === 2);

  // 틀린 조건은 closed 없이 1008로 끊는다.
  const bad = fakeSocket();
  createGatewaySession(bad.socket, bus).receive(
    JSON.stringify({ type: "watch", conditions: [{ session: "x" }] }),
  );
  assert.deepStrictEqual(bad.sent, []);
  assert.deepStrictEqual(bad.closed, [1008]);
});
