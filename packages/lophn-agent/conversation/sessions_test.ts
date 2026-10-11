import { assert, assertEquals } from "@std/assert";
import type { LedgerHarness } from "../../../apps/core/testing/ledger.ts";
import { envelope } from "../harness/run-loop/testing/mod.ts";
import { bodyHashOf, cred, id, textContent } from "./testing/mod.ts";
import {
  agentOf,
  ASG_AE,
  ASG_CE,
  ASG_LOPHN,
  code,
  count,
  DONE,
  eventsOf,
  finishRun,
  machineCred,
  messageRow,
  open,
  openLophn,
  openSession,
  output,
  PLACES,
  PVDR,
  receive,
  runningRun,
  runOf,
  runStateSeq,
  seed,
  sessionSeq,
  sql,
  startRun,
  userCred,
  value,
} from "./world_test.ts";

// 세션 관리 ledger 테스트: 제목(R18)·archive(R19)·delete(R20)·목록(R21)·첫 context(R22)·
// model 선택(R23). 실제 등록 executor(harness)와 임시 ledger 파일을 쓰고 실제 provider를
// 부르지 않는다.

type SessionView = Record<string, unknown>;

// receive 도우미가 본문을 주지 않을 때 쓰는 글(메시지 ID 길이가 들어간다).
const DEFAULT_TEXT = `message ${id("msg", 1).length}`;

async function readSession(
  h: LedgerHarness,
  session: string,
  ctx = userCred,
): Promise<SessionView> {
  const read = value(
    await h.read({ resource: "sessions", method: "read" }, ctx, { session }),
  ) as { session: SessionView };
  return read.session;
}

async function listSessions(
  h: LedgerHarness,
  options: {
    assignment?: string;
    place?: { kind: string; id: string };
    archived?: "exclude" | "include" | "only";
    ctx?: typeof userCred;
  } = {},
): Promise<string[]> {
  const listed = value(
    await h.read(
      { resource: "sessions", method: "list" },
      options.ctx ?? userCred,
      {
        assignment: options.assignment ?? ASG_LOPHN,
        work_place: options.place ?? PLACES.project,
        ...(options.archived === undefined
          ? {}
          : { archived: options.archived }),
      },
    ),
  ) as { sessions: { id: string }[] };
  return listed.sessions.map((session) => session.id);
}

function rename(
  h: LedgerHarness,
  session: string,
  title: string,
  seq: string,
  ctx = userCred,
) {
  return h.command(
    ctx,
    envelope("RenameSession", { session, title }, { state_seq: seq }),
  );
}

async function archive(
  h: LedgerHarness,
  session: string,
  command: "ArchiveSession" | "UnarchiveSession",
  seq?: string,
  ctx = userCred,
) {
  return h.command(
    ctx,
    envelope(command, { session }, {
      state_seq: seq ?? await sessionSeq(h, session),
    }),
  );
}

async function deleteSession(
  h: LedgerHarness,
  session: string,
  seq?: string,
  ctx = userCred,
) {
  return h.command(
    ctx,
    envelope("DeleteSession", { session }, {
      state_seq: seq ?? await sessionSeq(h, session),
    }),
  );
}

const CHOICE = {
  provider: PVDR,
  model_name: "claude-haiku-4-5",
  option_values: { effort: "high" },
};

async function changeModel(
  h: LedgerHarness,
  session: string,
  model: unknown,
  seq?: string,
  ctx = userCred,
) {
  return h.command(
    ctx,
    envelope("ChangeSessionModel", { session, model }, {
      state: "open",
      state_seq: seq ?? await sessionSeq(h, session),
    }),
  );
}

// 접수한 요청의 run을 시작해 끝낸다. 다음 요청은 앞선 run이 시작된 뒤에야 접수된다.
async function settle(h: LedgerHarness, message: string) {
  const run = await runOf(h, message);
  value(await startRun(h, run, ASG_LOPHN));
  value(await finishRun(h, run, DONE));
}

// 담당 assignment(App Engineer) 회수로 닫힌 session 하나.
async function closedSession(h: LedgerHarness, session: string) {
  value(await openSession(h, session, ASG_AE, PLACES.app));
  const run = await runningRun(h, session, id("msg", 90), ASG_AE);
  value(await finishRun(h, run, DONE));
  value(
    await h.command(
      userCred,
      envelope("WithdrawAssignment", { assignment: ASG_AE }, {
        revision: 1,
        state: "enabled",
      }),
    ),
  );
  value(
    await h.command(
      machineCred,
      envelope("CloseSession", { session, reason: "assignment_withdrawn" }, {
        state_seq: await sessionSeq(h, session),
        state: "open",
      }),
    ),
  );
}

Deno.test("lophn-agent/conversation#R18 [agent-I12]: the first person message sets the title to its first 60 characters and a rename is never overwritten", async () => {
  const h = await open();
  try {
    await seed(h);
    const first = await openLophn(h, id("ses", 1));
    // 메시지가 없는 세션에는 제목도 번호 이름도 없다.
    assertEquals((await readSession(h, first))["title"], null);
    // 줄바꿈은 공백 하나가 되고 앞 60자(글자)에서 자른다.
    const long = `  Plan the weekly\n\nreport  ${"가".repeat(80)}`;
    value(
      await receive(h, {
        message: id("msg", 1),
        session: first,
        mode: "request",
        text: long,
      }),
    );
    await settle(h, id("msg", 1));
    const title = String((await readSession(h, first))["title"]);
    assertEquals(title, `Plan the weekly report  ${"가".repeat(36)}`);
    assertEquals([...new Intl.Segmenter().segment(title)].length, 60);
    // 다음 메시지가 와도 제목은 그대로다.
    value(
      await receive(h, {
        message: id("msg", 2),
        session: first,
        mode: "request",
        text: "another request",
      }),
    );
    assertEquals((await readSession(h, first))["title"], title);
    await settle(h, id("msg", 2));
    // 수정(correction)은 제목을 정하지 않는다.
    const second = await openLophn(h, id("ses", 2));
    const run = await runningRun(h, second, id("msg", 3));
    assertEquals((await readSession(h, second))["title"], DEFAULT_TEXT);
    value(
      await receive(h, {
        message: id("msg", 4),
        session: second,
        mode: "correction",
        run,
        text: "a correction",
      }),
    );
    assertEquals((await readSession(h, second))["title"], DEFAULT_TEXT);
    // rename한 제목은 새 메시지가 자동으로 덮어쓰지 않는다. 첫 메시지 전에 rename해도 같다.
    const third = await openLophn(h, id("ses", 3));
    value(await rename(h, third, "My own name", await sessionSeq(h, third)));
    value(
      await receive(h, {
        message: id("msg", 5),
        session: third,
        mode: "request",
        text: "first words",
      }),
    );
    assertEquals((await readSession(h, third))["title"], "My own name");
    value(await rename(h, first, "Renamed", await sessionSeq(h, first)));
    value(
      await receive(h, {
        message: id("msg", 6),
        session: first,
        mode: "request",
        text: "after rename",
      }),
    );
    assertEquals((await readSession(h, first))["title"], "Renamed");
    // 본문이 공백뿐이면 제목은 null로 남고 번호 이름은 만들지 않는다.
    const blank = await openLophn(h, id("ses", 4));
    value(
      await receive(h, {
        message: id("msg", 7),
        session: blank,
        mode: "request",
        text: " \n ",
      }),
    );
    assertEquals((await readSession(h, blank))["title"], null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R18 [agent-I12]: a person renames at any time, even a closed session, and a blank or too long title is refused", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const seq = await sessionSeq(h, session);
    // 앞뒤 공백은 빼고 저장한다. 이전·이후 제목이 event에 남는다.
    const renamed = output<{ id: string; title: string; state_seq: string }>(
      await rename(h, session, "  Weekly report  ", seq),
    );
    assertEquals(renamed.title, "Weekly report");
    assertEquals(renamed.state_seq, await sessionSeq(h, session));
    assert(BigInt(renamed.state_seq) > BigInt(seq));
    const events = await eventsOf(h, "SessionRenamed", session);
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      before: null,
      after: "Weekly report",
    });
    // 같은 제목을 다시 보내면 이전 결과이고 event를 더하지 않는다.
    value(await rename(h, session, "Weekly report", renamed.state_seq));
    assertEquals((await eventsOf(h, "SessionRenamed", session)).length, 1);
    // 두 번째 rename은 이전 제목을 싣는다.
    value(await rename(h, session, "Monthly", await sessionSeq(h, session)));
    const again = await eventsOf(h, "SessionRenamed", session);
    assertEquals(JSON.parse(String(again[1]!["payload"])), {
      before: "Weekly report",
      after: "Monthly",
    });
    // 공백뿐인 글, 120자를 넘는 글은 거절하고 120자는 받는다.
    const current = await sessionSeq(h, session);
    code(await rename(h, session, "   ", current), "invalid_input");
    code(await rename(h, session, "", current), "invalid_input");
    code(await rename(h, session, "a".repeat(121), current), "invalid_input");
    value(await rename(h, session, "a".repeat(120), current));
    assertEquals(String((await readSession(h, session))["title"]).length, 120);
    // 낡은 상태 seq는 충돌이고, 없는 세션은 없는 세션이며, 사람만 한다.
    code(await rename(h, session, "Late", seq), "conflict");
    code(await rename(h, id("ses", 30), "x", "1"), "not_found");
    const live = await sessionSeq(h, session);
    code(
      await rename(h, session, "By machine", live, machineCred),
      "forbidden",
    );
    code(
      await rename(h, session, "By agent", live, agentOf(ASG_LOPHN)),
      "forbidden",
    );
    // 닫힌 세션도 이름을 바꿀 수 있다.
    await closedSession(h, id("ses", 2));
    value(
      await rename(
        h,
        id("ses", 2),
        "Kept name",
        await sessionSeq(h, id("ses", 2)),
      ),
    );
    assertEquals((await readSession(h, id("ses", 2)))["title"], "Kept name");
    assertEquals((await readSession(h, id("ses", 2)))["state"], "closed");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R19 [agent-I12]: archive only hides the session from the default list and an archived session still takes input and keeps its runs", async () => {
  const h = await open();
  try {
    await seed(h);
    const kept = await openLophn(h, id("ses", 1));
    const other = await openLophn(h, id("ses", 2));
    const run = await runningRun(h, kept, id("msg", 1));
    const stateBefore = (await sql(
      h,
      "select state, state_seq from runs where id = ?",
      [run],
    ))[0]!;
    const archived = output<
      { id: string; archived: boolean; state_seq: string }
    >(await archive(h, kept, "ArchiveSession"));
    assertEquals(archived.archived, true);
    assertEquals(archived.state_seq, await sessionSeq(h, kept));
    assertEquals((await readSession(h, kept))["archived"], true);
    assertEquals((await eventsOf(h, "SessionArchived", kept)).length, 1);
    // 기본 목록에는 없고 Archived 보기에는 있다.
    assertEquals(await listSessions(h), [other]);
    assertEquals(await listSessions(h, { archived: "exclude" }), [other]);
    assertEquals(await listSessions(h, { archived: "only" }), [kept]);
    assertEquals(await listSessions(h, { archived: "include" }), [kept, other]);
    // 진행 중 run과 메시지는 그대로다.
    assertEquals(
      (await sql(h, "select state, state_seq from runs where id = ?", [run]))[
        0
      ],
      stateBefore,
    );
    assertEquals(await count(h, "messages", `session = '${kept}'`), 1);
    // 이미 archive한 세션을 다시 archive하면 이전 결과이고 event를 더하지 않는다.
    const again = output<{ state_seq: string }>(
      await archive(h, kept, "ArchiveSession", "1"),
    );
    assertEquals(again.state_seq, archived.state_seq);
    assertEquals((await eventsOf(h, "SessionArchived", kept)).length, 1);
    // archive는 입력 접수에 영향이 없고 늦은 입력이 archive를 풀지 않는다.
    value(
      await receive(h, {
        message: id("msg", 2),
        session: kept,
        mode: "correction",
        run,
      }),
    );
    assertEquals((await readSession(h, kept))["archived"], true);
    // 다시 열면(unarchive) 기본 목록으로 돌아온다.
    const restored = output<{ archived: boolean; state_seq: string }>(
      await archive(h, kept, "UnarchiveSession"),
    );
    assertEquals(restored.archived, false);
    assertEquals(await listSessions(h), [kept, other]);
    assertEquals(await listSessions(h, { archived: "only" }), []);
    assertEquals((await eventsOf(h, "SessionUnarchived", kept)).length, 1);
    // 이미 풀린 세션을 다시 풀어도 이전 결과다.
    value(await archive(h, kept, "UnarchiveSession", "1"));
    assertEquals((await eventsOf(h, "SessionUnarchived", kept)).length, 1);
    // 낡은 상태 seq는 충돌이고, 없는 세션은 없는 세션이며, 사람만 한다.
    code(await archive(h, kept, "ArchiveSession", "1"), "conflict");
    code(await archive(h, id("ses", 30), "ArchiveSession", "1"), "not_found");
    code(
      await archive(h, kept, "ArchiveSession", undefined, machineCred),
      "forbidden",
    );
    // 닫힌 세션도 archive하고 풀 수 있다.
    await closedSession(h, id("ses", 3));
    value(await archive(h, id("ses", 3), "ArchiveSession"));
    assertEquals((await readSession(h, id("ses", 3)))["archived"], true);
    value(await archive(h, id("ses", 3), "UnarchiveSession"));
    assertEquals((await readSession(h, id("ses", 3)))["archived"], false);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R20 [agent-I12]: delete is refused while a run is not finished", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    // 접수만 된 run도, 진행 중인 run도 먼저 멈추기 전에는 지우지 않는다.
    value(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    code(await deleteSession(h, session), "conflict");
    const run = await runOf(h, id("msg", 1));
    value(await startRun(h, run, ASG_LOPHN));
    code(await deleteSession(h, session), "conflict");
    assertEquals(await count(h, "sessions"), 1);
    assertEquals(await count(h, "messages"), 1);
    assertEquals(await count(h, "runs"), 1);
    assertEquals((await eventsOf(h, "SessionDeleted")).length, 0);
    // 멈춘 뒤에는 지울 수 있다.
    value(
      await h.command(
        userCred,
        envelope("StopRun", {
          run,
          request_key: "stop-before-delete",
          reason: "user_stopped",
        }, { state_seq: await runStateSeq(h, run) }),
      ),
    );
    value(await deleteSession(h, session));
    assertEquals(await count(h, "sessions"), 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R20 [agent-I12]: delete removes the session, its messages and its run records and nothing of another session", async () => {
  const h = await open();
  try {
    await seed(h);
    const doomed = await openLophn(h, id("ses", 1));
    const kept = await openLophn(h, id("ses", 2));
    // 이어진 run 셋(앞선 run을 가리킨다)과 agent 답 하나.
    const first = await runningRun(h, doomed, id("msg", 1));
    value(
      await receive(h, {
        message: id("msg", 2),
        session: doomed,
        mode: "request",
      }),
    );
    value(
      await receive(h, {
        message: id("msg", 3),
        session: doomed,
        mode: "request",
      }),
    );
    value(
      await h.command(
        machineCred,
        envelope("RecordMessage", {
          id: id("msg", 4),
          session: doomed,
          run: first,
          content: textContent("an answer"),
          links: [],
        }),
      ),
    );
    value(await finishRun(h, first, DONE));
    for (const message of [id("msg", 2), id("msg", 3)]) {
      const run = await runOf(h, message);
      value(await startRun(h, run, ASG_LOPHN));
      value(await finishRun(h, run, DONE));
    }
    const survivor = await runningRun(h, kept, id("msg", 10));
    assertEquals(await count(h, "runs", `session = '${doomed}'`), 3);
    const before = await sessionSeq(h, doomed);
    const deleted = output<{ id: string; deleted_at: string }>(
      await deleteSession(h, doomed, before),
    );
    assertEquals(deleted.id, doomed);
    assert(deleted.deleted_at.length > 0);
    // 세션·메시지·run 기록이 어디서도 열리지 않는다.
    assertEquals(await count(h, "sessions", `id = '${doomed}'`), 0);
    assertEquals(await count(h, "messages", `session = '${doomed}'`), 0);
    assertEquals(await count(h, "runs", `session = '${doomed}'`), 0);
    code(
      await h.read({ resource: "sessions", method: "read" }, userCred, {
        session: doomed,
      }),
      "not_found",
    );
    code(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session: doomed,
      }),
      "not_found",
    );
    code(
      await h.read({ resource: "runs", method: "read" }, userCred, {
        run: first,
      }),
      "not_found",
    );
    assertEquals(await listSessions(h, { archived: "include" }), [kept]);
    // 지운 사실의 최소 기록만 남는다.
    const events = await eventsOf(h, "SessionDeleted", doomed);
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      assignment: ASG_LOPHN,
      deleted_at: deleted.deleted_at,
    });
    // 다른 세션과 그 run은 그대로다.
    assertEquals(await count(h, "messages", `session = '${kept}'`), 1);
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [survivor]))[0]![
          "state"
        ],
      ),
      "running",
    );
    // 같은 세션을 다시 지우려 하면 없는 세션이다.
    code(await deleteSession(h, doomed, before), "not_found");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R20 [agent-I12]: only a person deletes, from the current state, and a closed or archived session can be deleted", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const seq = await sessionSeq(h, session);
    code(await deleteSession(h, session, seq, machineCred), "forbidden");
    code(await deleteSession(h, session, seq, agentOf(ASG_LOPHN)), "forbidden");
    code(
      await deleteSession(
        h,
        session,
        seq,
        cred(`coding_agent:${id("cac", 1)}`),
      ),
      "forbidden",
    );
    code(await deleteSession(h, id("ses", 30), "1"), "not_found");
    // 낡은 상태 seq는 충돌이다.
    value(await archive(h, session, "ArchiveSession"));
    code(await deleteSession(h, session, seq), "conflict");
    assertEquals(await count(h, "sessions"), 1);
    // archive한 세션도 지울 수 있다.
    value(await deleteSession(h, session));
    assertEquals(await count(h, "sessions"), 0);
    // 닫힌 세션도 지울 수 있다.
    await closedSession(h, id("ses", 2));
    value(await deleteSession(h, id("ses", 2)));
    assertEquals(await count(h, "sessions"), 0);
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R21 [agent-I12]: the list shows only the sessions of the asked assignment and place", async () => {
  const h = await open();
  try {
    await seed(h);
    const a = await openLophn(h, id("ses", 1));
    const b = await openLophn(h, id("ses", 2));
    value(await openSession(h, id("ses", 3), ASG_LOPHN, PLACES.app));
    value(await openSession(h, id("ses", 4), ASG_CE, PLACES.project));
    value(
      await openSession(h, id("ses", 5), ASG_LOPHN, {
        kind: "project",
        id: id("prj", 2),
      }),
    );
    // 다른 agent의 세션도 다른 자리의 세션도 섞이지 않는다.
    assertEquals(await listSessions(h), [a, b]);
    assertEquals(await listSessions(h, { place: PLACES.app }), [id("ses", 3)]);
    assertEquals(await listSessions(h, { assignment: ASG_CE }), [id("ses", 4)]);
    assertEquals(
      await listSessions(h, { place: { kind: "project", id: id("prj", 2) } }),
      [id("ses", 5)],
    );
    assertEquals(
      await listSessions(h, { place: { kind: "project", id: id("prj", 9) } }),
      [],
    );
    // 목록의 각 줄은 제목을 담아 화면이 제목만 거를 수 있고 메시지 본문은 싣지 않는다.
    value(
      await receive(h, {
        message: id("msg", 1),
        session: a,
        mode: "request",
        text: "Quarterly numbers",
      }),
    );
    const listed = value(
      await h.read({ resource: "sessions", method: "list" }, userCred, {
        assignment: ASG_LOPHN,
        work_place: PLACES.project,
      }),
    ) as { sessions: SessionView[] };
    assertEquals(listed.sessions.map((s) => s["title"]), [
      "Quarterly numbers",
      null,
    ]);
    assert(!JSON.stringify(listed).includes(bodyHashOf("Quarterly numbers")));
    // agent는 자기 assignment의 목록만 본다.
    assertEquals(await listSessions(h, { ctx: agentOf(ASG_LOPHN) }), [a, b]);
    assertEquals(
      await listSessions(h, { ctx: agentOf(ASG_CE), assignment: ASG_LOPHN }),
      [],
    );
    // 입력은 assignment와 자리가 둘 다 필요하다.
    code(
      await h.read({ resource: "sessions", method: "list" }, userCred, {
        assignment: ASG_LOPHN,
      }),
      "invalid_input",
    );
    code(
      await h.read({ resource: "sessions", method: "list" }, userCred, {
        work_place: PLACES.project,
      }),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R22 [agent-I12]: a session opened from a toast keeps the event target as its first context and it never changes", async () => {
  const h = await open();
  try {
    await seed(h);
    const event = output<{ seq: string }>(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "DocumentSaved",
          subject: id("doc", 1),
        }),
      ),
    );
    const opening = { source_seq: event.seq, target: id("prb", 1) };
    value(
      await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.project, {
        opening_context: opening,
      }),
    );
    assertEquals(
      (await readSession(h, id("ses", 1)))["opening_context"],
      opening,
    );
    const opened = await eventsOf(h, "SessionOpened", id("ses", 1));
    assertEquals(
      JSON.parse(String(opened[0]!["payload"]))["opening_context"],
      opening,
    );
    // 같은 요청의 재전송은 같은 세션이고 다른 첫 context는 충돌이다.
    value(
      await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.project, {
        opening_context: opening,
      }),
    );
    code(
      await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.project, {
        opening_context: { source_seq: event.seq, target: id("app", 1) },
      }),
      "conflict",
    );
    code(
      await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.project),
      "conflict",
    );
    // 다른 길로 연 세션에는 없다.
    value(await openSession(h, id("ses", 2), ASG_LOPHN, PLACES.project));
    assertEquals((await readSession(h, id("ses", 2)))["opening_context"], null);
    // 없는 사건을 가리키는 첫 context는 받지 않고 세션도 만들지 않는다.
    code(
      await openSession(h, id("ses", 3), ASG_LOPHN, PLACES.project, {
        opening_context: { source_seq: "99999", target: id("prb", 1) },
      }),
      "not_found",
    );
    assertEquals(await count(h, "sessions", `id = '${id("ses", 3)}'`), 0);
    // 열 때만 정해진다: 저장소도 바꾸지 못하게 막는다.
    const changed = await h.probeWrite(
      "update sessions set opening_target = ? where id = ?",
      [id("app", 1), id("ses", 1)],
    );
    assert(!changed.ok, "the opening context must not change");
    // 메시지를 받아도 첫 context는 같다.
    value(
      await receive(h, {
        message: id("msg", 1),
        session: id("ses", 1),
        mode: "request",
      }),
    );
    assertEquals(
      (await readSession(h, id("ses", 1)))["opening_context"],
      opening,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R23 [agent-I12]: the model choice is stored on this session only and null returns to the agent default", async () => {
  const h = await open();
  try {
    await seed(h);
    const a = await openLophn(h, id("ses", 1));
    const b = await openLophn(h, id("ses", 2));
    assertEquals((await readSession(h, a))["model_selection"], null);
    const changed = output<
      { id: string; model_selection: unknown; state_seq: string }
    >(await changeModel(h, a, CHOICE));
    assertEquals(changed.model_selection, CHOICE);
    assertEquals(changed.state_seq, await sessionSeq(h, a));
    // 이 세션에만 저장한다. 다른 세션과 agent 기본값은 그대로다.
    assertEquals((await readSession(h, a))["model_selection"], CHOICE);
    assertEquals((await readSession(h, b))["model_selection"], null);
    const events = await eventsOf(h, "SessionModelChanged", a);
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      before: null,
      after: CHOICE,
    });
    // 같은 선택을 다시 보내면 이전 결과이고 event를 더하지 않는다.
    value(await changeModel(h, a, CHOICE));
    assertEquals((await eventsOf(h, "SessionModelChanged", a)).length, 1);
    // 진행 중 run에는 적용하지 않는다: run의 시작 근거는 바뀌지 않는다.
    const run = await runningRun(h, a, id("msg", 1));
    const runBefore = (await sql(
      h,
      "select basis, limits, state_seq from runs where id = ?",
      [run],
    ))[0]!;
    const next = { ...CHOICE, option_values: { effort: "low" } };
    value(await changeModel(h, a, next));
    assertEquals(
      (await sql(h, "select basis, limits, state_seq from runs where id = ?", [
        run,
      ]))[0],
      runBefore,
    );
    // null은 agent 기본값으로 돌아간다.
    value(await changeModel(h, a, null));
    assertEquals((await readSession(h, a))["model_selection"], null);
    const all = await eventsOf(h, "SessionModelChanged", a);
    assertEquals(JSON.parse(String(all[2]!["payload"])), {
      before: next,
      after: null,
    });
    // 낡은 상태 seq는 충돌이고, 모양이 틀린 선택은 거절하고, 사람만 한다.
    code(await changeModel(h, a, CHOICE, "1"), "conflict");
    code(
      await changeModel(h, a, { provider: "nope", model_name: "x" }),
      "invalid_input",
    );
    code(await changeModel(h, id("ses", 30), CHOICE, "1"), "not_found");
    code(await changeModel(h, a, CHOICE, undefined, machineCred), "forbidden");
    // 닫힌 세션은 model을 바꾸지 못한다.
    await closedSession(h, id("ses", 3));
    code(await changeModel(h, id("ses", 3), CHOICE), "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I12]: a copied message is a past remark without run, mode or application, and a normal message has no origin", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
      }),
    ) as { messages: { message: Record<string, unknown> }[] };
    assertEquals(listed.messages[0]!.message["copied_from"], null);
    assert((await messageRow(h, id("msg", 1))) !== undefined);
    const insert = (
      run: string | null,
      mode: string | null,
      copiedFrom: string | null,
    ) =>
      h.probeWrite(
        `insert into messages (id, session, actor, body, run, mode, links,
           copied_from, created_seq, state_seq)
         values (?, ?, 'user', ?, ?, ?, '[]', ?, 9999, 9999)`,
        [id("msg", 50), session, "d".repeat(64), run, mode, copiedFrom],
      );
    // Fork가 복사한 사람 메시지는 mode도 run도 없다.
    assert((await insert(null, null, id("msg", 1))).ok);
    // 복사본이 run이나 mode를 가지면 지난 발언이 아니다.
    assert(
      !(await insert(await runOf(h, id("msg", 1)), null, id("msg", 1))).ok,
    );
    assert(!(await insert(null, "request", id("msg", 1))).ok);
    // 복사본이 아닌 사람 메시지는 mode가 있어야 한다.
    assert(!(await insert(null, null, null)).ok);
    // 원래 메시지를 가리키는 칸은 불변이다.
    const moved = await h.probeWrite(
      "update messages set copied_from = ? where id = ?",
      [id("msg", 2), id("msg", 1)],
    );
    assert(!moved.ok, "the origin of a message must not change");
  } finally {
    await h.close();
  }
});
