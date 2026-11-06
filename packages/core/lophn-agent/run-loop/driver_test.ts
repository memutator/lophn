import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createTurnDriver } from "./driver.ts";
import { createQueue } from "./queue.ts";
import { createTurnSource, createTurnStarter } from "./work.ts";

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
      hold: () => Promise.resolve(ok(true)),
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

// 모든 turn이 Compact하라고 정하고 끝나는 driver다.
function compactSetup(compact: (session: string) => Promise<unknown>) {
  const queue = createQueue();
  const source = createTurnSource({
    queue,
    starter: createTurnStarter({ queue }),
  });
  const driver = createTurnDriver({
    source,
    credentials: {
      open: () => Promise.resolve(ok({ token: "t" })),
      end: () => 1,
      endSession: () => 0,
      endAll: () => 0,
    } as never,
    preparer: {
      forget() {},
      prepare: (start: { input: { message: string } }) =>
        Promise.resolve(
          ok({
            kind: "ready",
            turn: {
              turn: `trn_${start.input.message}`,
              begin: {},
              startTurn: () => Promise.resolve(ok({})),
              closeStarted: () => Promise.resolve(),
              loop: () => ({ provider: "p", deps: {}, input: {} }),
            },
          } as never),
        ),
    },
    startLoop: (() => ({
      done: Promise.resolve({ kind: "finish_ok" }),
      compactNext: () => true,
    })) as never,
    compact,
  } as never);
  const put = (session: string, message: string) =>
    queue.put(
      session as never,
      { kind: "message", message, delivery: "next_turn" } as never,
    );
  const turnOf = (result: unknown) => (result as { turn: string }).turn;
  const doneOf = (result: unknown) =>
    (result as { done: Promise<unknown> }).done;
  return { driver, put, turnOf, doneOf };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a session that is compacting does not start a turn but another session still does", async () => {
  const compacting: string[] = [];
  let finishCompact: () => void = () => {};
  const compactDone = new Promise<void>((resolve) => {
    finishCompact = resolve;
  });
  const { driver, put, turnOf, doneOf } = compactSetup((session) => {
    compacting.push(session);
    return compactDone;
  });

  // A의 turn이 Compact하라고 정하고 끝난다. 그래도 다음 입력이 오기 전에는 Compact하지 않는다.
  put("ses_a", "msg_a1");
  const first = await driver.startNext();
  await doneOf(first);
  assert.deepEqual(compacting, []);

  // A의 다음 입력이 오면 Compact를 기다리지 않고 시작하고 A를 잡는다. 입력은 남는다.
  put("ses_a", "msg_a2");
  put("ses_b", "msg_b1");
  assert.equal((await driver.startNext()).kind, "compacting");
  assert.deepEqual(compacting, ["ses_a"]);

  // Compact가 끝나기 전에 A는 시작하지 않고 B는 시작한다.
  const second = await driver.startNext();
  assert.equal(turnOf(second), "trn_msg_b1");
  await doneOf(second);
  assert.equal((await driver.startNext()).kind, "idle");

  finishCompact();
  await tick();
  assert.equal(turnOf(await driver.startNext()), "trn_msg_a2");
});
