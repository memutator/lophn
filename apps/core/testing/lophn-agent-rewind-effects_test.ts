import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { rewind } from "../../../packages/contracts/lophn-agent/mod.ts";
import { answeredFacts } from "../rewind-facts.ts";
import { call, codeOf, command } from "./approvals-fixture.ts";
import { binding, id, tool } from "./tool-judgment-world.ts";
import {
  acceptCredential,
  approvalOf,
  context,
  count,
  inspect,
  issueConfirmation,
  judgmentFor,
  MACHINE_TOKEN,
  openWaitingWorld,
  requestTool,
  type Seat,
  TARGET,
  USER_TOKEN,
  type WaitingWorld,
} from "./waiting-world.ts";

// rewind가 대화 밖에 미치는 효과의 조립(lophn-agent/revert R15, "대화 밖 상태"; agent-RW3d). 실제 core에서 숨김
// 구간에서 기다리던 질문 묶음·approval request가 같은 transaction에서 취소되고, 질문 답·승인 결정은 남는 사실로
// 알려진다. Summarize from here는 아무것도 취소하지 않는다.

const REWIND_TOKEN = "r".repeat(43);

// 되돌리기를 하는 사람의 자격이다. 시험 world의 사람 자격(principal user)을 덮어쓰지 않게 principal을 따로 둔다.
async function rewinder(world: WaitingWorld): Promise<void> {
  await acceptCredential(
    world.core,
    {
      ...context(
        "user",
        [
          "PreviewRewind",
          "Rewind",
          "ListReverts",
          "ListRewindCheckpoints",
          // rewind가 같은 transaction에서 approval을 취소한다(tx.call은 바깥 자격의 scope를 본다).
          "cancel_approval_request",
        ],
        {},
        "rewind",
      ),
      principal: "user-rewind",
    },
    REWIND_TOKEN,
  );
}

async function stateSeqOf(world: WaitingWorld, run: string): Promise<string> {
  const read = await world.read("runs/read", MACHINE_TOKEN, { run });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body["run"] as { state_seq: string }).state_seq;
}

const GROUP = id("qgr", 90);
const QUESTION = id("qst", 90);

// run이 질문 묶음 하나를 기다리게 한다.
async function ask(world: WaitingWorld, seat: Seat) {
  const waited = await world.post("runs/wait", MACHINE_TOKEN, {
    run: seat.run,
    request: {
      kind: "question",
      input: {
        id: GROUP,
        run: seat.run,
        session: null,
        expires_at: null,
        questions: [{
          id: QUESTION,
          prompt: "어느 쪽으로 정리할까요?",
          reason: "두 방향이 모두 가능해서 정해야 합니다",
          options: [],
          recommendation: null,
        }],
      },
    },
    call: null,
  }, { state_seq: await stateSeqOf(world, seat.run) });
  assertEquals(waited.status, 200, JSON.stringify(waited.body));
}

// run을 멈춘다. 기다리던 질문 묶음은 pending으로 남는다.
async function stop(world: WaitingWorld, seat: Seat) {
  const stopped = await world.post("runs/stop", USER_TOKEN, {
    run: seat.run,
    request_key: `stop-${seat.run}`,
    reason: "user_stopped",
  }, { state_seq: await stateSeqOf(world, seat.run) });
  assertEquals(stopped.status, 200, JSON.stringify(stopped.body));
}

async function rewindTo(
  world: WaitingWorld,
  seat: Seat,
  choice: "messages_only" | "summarize",
  over: { id?: string; summary_call?: string | null } = {},
) {
  const shown = await world.read("rewind/preview", REWIND_TOKEN, {
    kind: "rewind",
    session: seat.session,
    checkpoint: seat.message,
    choice,
  });
  assertEquals(shown.status, 200, JSON.stringify(shown.body));
  const input = {
    id: over.id ?? id("rvt", 90),
    session: seat.session,
    checkpoint: seat.message,
    choice,
    accept_remaining: true,
    preview_hash: shown.body["preview_hash"],
    summary_call: over.summary_call ?? null,
    files: [],
  };
  return await call(
    world.server,
    "rewind/apply",
    REWIND_TOKEN,
    command(input, {
      compare: {
        session_state: "open",
        active_run: null,
        applying_revert: null,
      },
      confirmation: await issueConfirmation(world, rewind as never, input),
    }),
  );
}

const status = (world: WaitingWorld, table: string, key: string) =>
  inspect(world.server, `select status from ${table} where id = ?`, [
    key,
  ])[0]!["status"];

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: a question group that waited in the hidden range is closed with the rewind, and the answer is not taken afterwards", async () => {
  const world = await openWaitingWorld();
  try {
    await rewinder(world);
    await ask(world, world.lophn);
    await stop(world, world.lophn);
    assertEquals(status(world, "question_groups", GROUP), "pending");

    const rewound = await rewindTo(world, world.lophn, "messages_only");
    assertEquals(rewound.status, 200, JSON.stringify(rewound.body));
    assertEquals(
      rewound.body["outcome"] as string,
      "applied",
      JSON.stringify(rewound.body),
    );
    assertEquals(status(world, "question_groups", GROUP), "cancelled");
    assertEquals(
      count(
        world.server,
        "select count(*) as n from events where type = 'QuestionCancelled'",
      ),
      1,
    );
    // 닫힌 묶음에는 답이 오지 않는다.
    const created = inspect(
      world.server,
      "select created_seq from question_groups where id = ?",
      [GROUP],
    )[0]!["created_seq"];
    const late = await world.post("questions/answer", USER_TOKEN, {
      group: GROUP,
      created_seq: String(created),
      answers: [{
        question: QUESTION,
        answer: { kind: "text", text: "늦은 답" },
      }],
    }, { created_seq: String(created) });
    assert(codeOf(late) !== undefined);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: an approval request that waited in the hidden range is cancelled with the rewind", async () => {
  const world = await openWaitingWorld();
  try {
    await rewinder(world);
    const note = {
      definition: tool("note.record"),
      binding: binding([{ id: TARGET, reversibility: "irreversible" }]),
    };
    const judgment = judgmentFor(world, world.lophn, [note]);
    const request = await requestTool(
      world,
      world.lophn,
      note.definition,
      { note: "n1" },
    );
    const decided = await judgment.decide(request);
    assert(decided.ok, decided.ok ? "" : JSON.stringify(decided.error));
    const approval = decided.value.decision.approval;
    assert(approval !== null);
    assertEquals((await approvalOf(world, approval)).status, "pending");
    await stop(world, world.lophn);

    const rewound = await rewindTo(world, world.lophn, "messages_only");
    assertEquals(rewound.status, 200, JSON.stringify(rewound.body));
    assertEquals(status(world, "approval_requests", approval), "cancelled");
    assertEquals(
      count(
        world.server,
        "select count(*) as n from events where type = 'ApprovalRequestCancelled'",
      ),
      1,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: Summarize from here without a finished summary call changes nothing and closes nothing", async () => {
  const world = await openWaitingWorld();
  try {
    await rewinder(world);
    await ask(world, world.lophn);
    await stop(world, world.lophn);
    const refused = await rewindTo(world, world.lophn, "summarize", {
      summary_call: id("mcl", 90),
    });
    assertEquals(
      codeOf(refused),
      "invalid_input",
      JSON.stringify(refused.body),
    );
    assertEquals(status(world, "question_groups", GROUP), "pending");
    assertEquals(
      count(world.server, "select count(*) as n from reverts"),
      0,
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/revert#R10 [agent-RW3d]: the rewind preview names answered questions and decided approvals as facts that stay", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table runs (id text primary key, session text);
    create table question_groups (
      id text primary key, session text, status text, closed_seq integer
    );
    create table approval_requests (
      id text primary key, run text, status text, closed_seq integer
    );
    insert into runs values ('run_1', 'ses_1'), ('run_2', 'ses_2');
  `);
  const lookup = {
    sql: {
      all: (query: string, params: readonly (string | number)[]) =>
        db.prepare(query).all(...params) as never,
    },
  };
  const from = (session: string, seq: string) =>
    answeredFacts(lookup, { session, from_seq: seq }).map((fact) =>
      fact.target
    );
  assertEquals(from("ses_1", "5"), []);
  db.exec(`
    insert into question_groups values ('q1', 'ses_1', 'answered', 10);
    insert into question_groups values ('q2', 'ses_1', 'pending', null);
    insert into approval_requests values ('a1', 'run_1', 'granted', 12);
    insert into approval_requests values ('a2', 'run_2', 'granted', 12);
  `);
  assertEquals(from("ses_1", "5"), ["answered_question", "approval_decision"]);
  // 숨기기 시작하는 곳보다 앞서 답한 것은 숨김 구간 밖의 일이다.
  assertEquals(from("ses_1", "11"), ["approval_decision"]);
  assertEquals(from("ses_1", "13"), []);
  assertEquals(from("ses_2", "5"), ["approval_decision"]);
  db.close();
});
