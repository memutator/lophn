import assert from "node:assert/strict";
import { test } from "node:test";

import { err, ok, type Result } from "../../../../base/mod.ts";
import type { AcpInput } from "../../../../protocol/acp/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createAcpSend } from "./acp-send.ts";

const SES = "ses_01h455vb4pex5v6nkc6gd5f001";
const MSG = "msg_01h455vb4pex5v6nkc6gd5f001";
const TURN = "trn_01h455vb4pex5v6nkc6gd5f001";

const person = (operations: string[]): AuthenticatedContext => ({
  principal: "user:me",
  actor: "user",
  scope: { operations, targets: {} },
  conditions: {},
  credential_ref: "user:me",
});

// 지금 route들처럼 부른 사람의 scope에 operation이 있어야 통과한다. 누가 불렀는지도 적는다.
function setup() {
  const callers: string[] = [];
  const allow = (who: AuthenticatedContext, name: string): Result<void> =>
    who.scope.operations.includes(name)
      ? ok(undefined)
      : err({ code: "forbidden", message: "operation forbidden" });
  const send = createAcpSend({
    command: (who, envelope) => {
      callers.push(who.principal);
      const allowed = allow(who, envelope.command);
      return Promise.resolve(allowed.ok ? ok({}) : allowed);
    },
    read: (who, route) => {
      callers.push(who.principal);
      const allowed = allow(who, route.method === "read" ? "ReadTurn" : "");
      return Promise.resolve(
        allowed.ok
          ? ok({ turn: { state_seq: 1, input_message: MSG } })
          : allowed,
      );
    },
    memory: () => Promise.resolve(ok({})),
    newMessageId: () => MSG,
  });
  return { send, callers };
}

test("AcpSend dispatches with the caller's own scope, so a caller without the route's scope is forbidden", async () => {
  const { send, callers } = setup();
  const message: AcpInput = {
    type: "send",
    session: SES,
    id: MSG,
    key: "k1",
    content: [{ type: "text", text: "hi" }],
    delivery: "next_turn",
  } as AcpInput;
  const stop: AcpInput = {
    type: "stop",
    session: SES,
    turn: TURN,
    key: "k2",
  } as AcpInput;

  const noSend = await send(person(["ReadTurn"]), message);
  assert.equal(!noSend.ok && noSend.error.code, "forbidden");
  const noStop = await send(person(["ReadTurn"]), stop);
  assert.equal(!noStop.ok && noStop.error.code, "forbidden");
  const noRead = await send(person(["StopTurn"]), stop);
  assert.equal(!noRead.ok && noRead.error.code, "forbidden");

  const allowed = await send(person(["SendMessage"]), message);
  assert.equal(allowed.ok, true);
  assert.deepEqual([...new Set(callers)], ["user:me"]);
});
