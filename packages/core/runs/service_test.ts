import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { RunRecord } from "../../protocol/runs/mod.ts";
import type { RunAgents, RunStore, TurnOfMessage } from "./ports.ts";
import { createRunService } from "./service.ts";

const SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const T1 = "trn_01hzzzzzzzzzzzzzzzzzzzzzza";
const T2 = "trn_01hzzzzzzzzzzzzzzzzzzzzzzb";
const OLDER_MESSAGE = "msg_01hzzzzzzzzzzzzzzzzzzzzzza";

test("run의 결과는 그 입력이 연 turn의 답이고 같은 session에 먼저 들어온 다른 입력의 답이 아니다", async () => {
  const turns = new Map<string, TurnOfMessage>();
  const answers = new Map<string, string>();
  let runMessage = "";
  let runText = "";
  const tabs: string[] = [];
  const agents: RunAgents = {
    resolve: () =>
      Promise.resolve(ok({ agent: "lophn_home", workspace: null })),
    agentOf: () =>
      Promise.resolve(ok({ agent: "lophn_home", workspace: null })),
    open: () => Promise.resolve(ok(undefined)),
    showTab: (_agent, session) => {
      tabs.push(session);
    },
    send: (_session, message, text) => {
      runMessage = message;
      runText = text;
      return Promise.resolve(ok(undefined));
    },
    turnOf: (message) => Promise.resolve(ok(turns.get(message) ?? null)),
    answer: (_session, turn) => Promise.resolve(ok(answers.get(turn) ?? null)),
    stop: () => Promise.resolve(ok(undefined)),
    unqueue: () => Promise.resolve(ok(undefined)),
  };
  const rows = new Map<string, RunRecord>();
  const store: RunStore = {
    create: (input) => {
      const run = {
        ...input,
        error: null,
        turn: null,
        invocation: null,
        result: null,
        state: "running",
        created_at: "t",
        finished_at: null,
        state_seq: "1",
      } as unknown as RunRecord;
      rows.set(input.id, run);
      return Promise.resolve(ok(run));
    },
    settle: (input) => {
      const run = rows.get(input.run)!;
      if (run.state !== "running") {
        return Promise.resolve(err({ code: "conflict", message: "done" }));
      }
      const next = {
        ...run,
        state: input.state,
        turn: input.turn ?? null,
        result: input.result ?? null,
        finished_at: "t",
      } as RunRecord;
      rows.set(input.run, next);
      return Promise.resolve(ok(next));
    },
    read: (run) => Promise.resolve(ok(rows.get(run)!)),
    running: () =>
      Promise.resolve(
        ok([...rows.values()].filter((run) => run.state === "running")),
      ),
  };
  const service = createRunService({
    agents,
    tools: {
      resolveApp: () => Promise.reject(new Error("unused")),
      call: () => Promise.reject(new Error("unused")),
    },
    store,
    ids: createIdSource({
      clock: manualClock(1_767_225_600_000),
      random: seededRandom(1),
    }),
    timers: { set: () => 0, clear: () => {} },
  });

  const started = await service.start({
    kind: "agent",
    session: SESSION,
    prompt: "hello",
  });
  if (!started.ok) throw new Error(started.error.message);
  // 사람 자격으로 들어가는 run 입력이 사람이 친 글로 읽히지 않는다.
  assert.equal(runText, '<lophn-run from="command">\nhello\n</lophn-run>');
  const id = started.value.id as `run_${string}`;
  // 이어 쓴 session은 새 탭을 요청하지 않는다.
  assert.deepStrictEqual(tabs, []);

  // 먼저 들어온 입력 A가 연 turn T1이 먼저 끝난다.
  turns.set(OLDER_MESSAGE, {
    turn: T1,
    state: "finished",
    outcome: { kind: "completed", reason: "answer_completed" },
  });
  answers.set(T1, "first");
  await service.turnEnded({ turn: T1, messages: [OLDER_MESSAGE] });
  assert.deepStrictEqual(rows.get(id)!.state, "running");

  turns.set(runMessage, {
    turn: T2,
    state: "finished",
    outcome: { kind: "completed", reason: "answer_completed" },
  });
  answers.set(T2, "second");
  await service.turnEnded({ turn: T2, messages: [runMessage] });
  const done = rows.get(id)!;
  assert.deepStrictEqual(
    [done.state, done.result, done.turn],
    ["done", "second", T2],
  );

  // run이 새로 연 session은 탭을 한 번 요청한다.
  const fresh = await service.start({
    kind: "agent",
    agent: { agent: "lophn" },
    prompt: "again",
  });
  if (!fresh.ok) throw new Error(fresh.error.message);
  assert.deepStrictEqual(tabs, [fresh.value.session]);
});
