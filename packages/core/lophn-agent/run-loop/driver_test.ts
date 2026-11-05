import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createTurnDriver } from "./driver.ts";

const SESSION = "ses_s1";

// loop가 던지는 turn과 정상으로 시작만 하는 turn을 번갈아 만들 수 있는 가짜 재료다.
function setup() {
  let turns = 0;
  const closed: string[] = [];
  const ended: string[] = [];
  const reported: string[] = [];
  const driver = createTurnDriver({
    source: {
      next: () =>
        Promise.resolve(
          ok({
            session: SESSION,
            input: { message: `msg_${turns + 1}` },
          } as never),
        ),
      began: () => Promise.resolve(ok({ message: "m" } as never)),
      ended: (session) => {
        ended.push(session);
        return Promise.resolve(ok(undefined));
      },
      steering: () => Promise.resolve(ok([])),
      settled: () => Promise.resolve(ok(undefined)),
    },
    credentials: {
      open: (input) =>
        Promise.resolve(
          ok({ ...input, token: "t", credential_ref: "c" } as never),
        ),
      end: () => 1,
      endSession: () => 0,
      endAll: () => 0,
      live: () => [],
    },
    preparer: {
      forget() {},
      prepare: () => {
        const turn = `trn_${++turns}`;
        return Promise.resolve(
          ok({
            kind: "ready",
            turn: {
              turn,
              session: SESSION,
              begin: { turn, session: SESSION },
              startTurn: () =>
                Promise.resolve(ok({ turn, state_seq: "1", basis: "b" })),
              closeStarted: (why: string) => {
                closed.push(`${turn}:${why}`);
                return Promise.resolve();
              },
              loop: () => ({
                provider: "p",
                deps: {
                  clock: { now: () => "", nowMs: () => 0 },
                  // 첫 turn만 loop 안에서 던진다.
                  ports: {
                    stop: () => {
                      if (turn === "trn_1") throw new Error("boom");
                      return Promise.resolve({
                        stopped: true,
                        reason: "user_stopped",
                      });
                    },
                  },
                },
                input: {
                  turn,
                  session: SESSION,
                  limits: { model_attempts: null, stall_ms: 1000 },
                  elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
                  attempts: 0,
                },
              }),
            },
          } as never),
        );
      },
    },
    report: (text) => reported.push(text),
  });
  return { driver, closed, ended, reported };
}

test("a turn that throws is closed as failed by the driver and the next turn can start", async () => {
  const { driver, closed, ended, reported } = setup();
  const first = await driver.startNext();
  assert.equal(first.kind, "started");
  const end = await (first as { done: Promise<{ kind: string }> }).done;
  assert.equal(end.kind, "finish_failed");
  assert.deepEqual(closed, ["trn_1:loop_threw"]);
  assert.deepEqual(ended, [SESSION]);
  assert.equal(reported.length, 1);
  assert.equal(driver.active, 0);

  const second = await driver.startNext();
  assert.equal(second.kind, "started");
  await (second as { done: Promise<unknown> }).done;
  assert.deepEqual(closed, ["trn_1:loop_threw"]);
});
