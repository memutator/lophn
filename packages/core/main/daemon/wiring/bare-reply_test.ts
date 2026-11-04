import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import { type BareReplyPorts, createBareReply } from "./bare-reply.ts";

// 보낸 쪽이 마지막 응답을 정확히 한 번 받는지가 깨지면 곤란하다. call 상태는 router가 가진 규칙(닫힌 call은 다시 보내지 않는다)을 대역으로 흉내 낸다.
const TURN = "trn_1";
const SESSION = "ses_1";
const CALL = "cal_1";

function setup(options: { bare: boolean; replied?: boolean }) {
  const sent: string[] = [];
  let open = options.replied !== true;
  const ports: BareReplyPorts = {
    turn: () =>
      Promise.resolve(
        ok({
          session: SESSION,
          input_message: "msg_1",
          unattended: false,
        }),
      ),
    resultCallOf: () => Promise.resolve(ok(CALL)),
    callOpen: () => Promise.resolve(ok(open)),
    isBare: () => Promise.resolve(ok(options.bare)),
    answer: () => Promise.resolve(ok("the answer")),
    reply: (input) => {
      sent.push(input.text);
      open = false;
      return Promise.resolve(ok(undefined));
    },
  };
  const turnEnded = createBareReply(ports);
  const end = () => turnEnded({ turn: TURN, outcome: { kind: "completed" } });
  return { sent, end };
}

test("a bare turn that answers a result call sends the last response once", async () => {
  const { sent, end } = setup({ bare: true });
  await end();
  await end();
  assert.deepStrictEqual(sent, ["the answer"]);
  // agent가 이미 reply로 닫은 call에는 자동 답이 가지 않는다.
  const replied = setup({ bare: true, replied: true });
  await replied.end();
  assert.deepStrictEqual(replied.sent, []);
});

test("a lophn runtime turn gets no automatic reply", async () => {
  const { sent, end } = setup({ bare: false });
  await end();
  assert.deepStrictEqual(sent, []);
});
