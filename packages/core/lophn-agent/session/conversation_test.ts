import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../../protocol/platform/mod.ts";
import type { LedgerHarness } from "../../../../apps/core/testing/ledger.ts";
import { envelope } from "../run-loop/testing/mod.ts";
import { bodyHashOf, cred, id, textContent } from "./testing/mod.ts";
import {
  agentOf,
  APP_OTHER,
  applyMessages,
  ASG_AE,
  ASG_CE,
  ASG_LOPHN,
  ASG_OP,
  code,
  count,
  DONE,
  eventsOf,
  FAILED,
  finishRun,
  machineCred,
  messageRow,
  open,
  openLophn,
  openSession,
  output,
  type Place,
  PLACES,
  PROJECT,
  PROJECT_OTHER,
  receive,
  runningRun,
  runOf,
  runStateSeq,
  seed,
  seedProvider,
  sessionSeq,
  setAssignmentState,
  type Snapshot,
  sql,
  startCall,
  startRun,
  userCred,
  value,
} from "./world_test.ts";

// 세션·메시지 ledger 테스트. 실제 등록 executor(harness)와 임시 ledger 파일을 쓰고
// run-loop의 FinishRun이 제품 core와 같은 hasUnappliedSteering(messages 표)을 본다.
// 재시작과 30일 유휴는 파일 ledger를 닫고 다시 여는 apps/core/testing/
// lophn-agent-conversation_test.ts의 R2 시험이 맡는다. 세션 관리(제목·archive·delete·
// 목록·model 선택)는 sessions_test.ts가 본다. 실제 provider를 부르지 않는다.

Deno.test("lophn-agent/conversation#R1 [agent-I12]: a new session starts empty for one assignment and one place, and the place follows the role", async () => {
  const h = await open();
  try {
    await seed(h);
    // lophn은 project나 app, Context Engineer는 project, App Engineer는 담당 app,
    // Operator는 담당 project에서 열 수 있다.
    const lophn = output<{ id: string; state: string; work_place: unknown }>(
      await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.project),
    );
    assertEquals(lophn.state, "open");
    assertEquals(lophn.work_place, PLACES.project);
    value(await openSession(h, id("ses", 2), ASG_LOPHN, PLACES.app));
    value(await openSession(h, id("ses", 3), ASG_CE, PLACES.project));
    value(await openSession(h, id("ses", 4), ASG_AE, PLACES.app));
    value(await openSession(h, id("ses", 5), ASG_OP, PLACES.project));
    // 빈 세션이다. 다른 세션의 요약이나 원문이 자동으로 들어오지 않는다.
    assertEquals(await count(h, "messages"), 0);
    for (const n of [1, 2, 3, 4, 5]) {
      const read = value(
        await h.read({ resource: "sessions", method: "read" }, userCred, {
          session: id("ses", n),
        }),
      ) as { session: Record<string, unknown> };
      assertEquals(read.session["state"], "open");
      assertEquals(read.session["title"], null);
      assertEquals(read.session["archived"], false);
      assertEquals(read.session["forked_from"], null);
      assertEquals(read.session["opening_context"], null);
      assertEquals(read.session["model_selection"], null);
      assertEquals(read.session["compaction"], null);
      assertEquals(read.session["closed_reason"], null);
      // 세션에는 role도 이어가기 출처도 자리 판도 없다.
      for (const key of ["role", "continued_from", "work_place_revision"]) {
        assert(!(key in read.session), `${key} is not a session field`);
      }
    }
    // 역할의 자리 규칙을 어긴 열기는 거절한다.
    code(
      await openSession(h, id("ses", 9), ASG_CE, PLACES.app),
      "forbidden",
    );
    code(
      await openSession(h, id("ses", 9), ASG_AE, {
        kind: "app",
        id: APP_OTHER,
      }),
      "forbidden",
    );
    code(
      await openSession(h, id("ses", 9), ASG_AE, PLACES.project),
      "forbidden",
    );
    code(
      await openSession(h, id("ses", 9), ASG_OP, {
        kind: "project",
        id: PROJECT_OTHER,
      }),
      "forbidden",
    );
    // Lophn Workspace에는 세션이 없다: 전역 자리는 입력 계약이 거절한다.
    code(
      await openSession(h, id("ses", 9), ASG_LOPHN, {
        kind: "global",
        id: null,
      } as never),
      "invalid_input",
    );
    // 없거나 보관된 대상은 자리가 될 수 없다.
    code(
      await openSession(h, id("ses", 9), ASG_LOPHN, {
        kind: "project",
        id: id("prj", 30),
      }),
      "not_found",
    );
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "ProjectArchived",
          subject: PROJECT_OTHER,
        }),
      ),
    );
    code(
      await openSession(h, id("ses", 9), ASG_LOPHN, {
        kind: "project",
        id: PROJECT_OTHER,
      }),
      "not_found",
    );
    // 같은 id의 같은 요청은 같은 세션이고 다른 내용은 충돌이다.
    assertEquals(
      output<{ id: string }>(
        await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.project),
      ).id,
      id("ses", 1),
    );
    code(
      await openSession(h, id("ses", 1), ASG_LOPHN, PLACES.app),
      "conflict",
    );
    code(
      await openSession(h, id("ses", 1), ASG_CE, PLACES.project),
      "conflict",
    );
    assertEquals(await count(h, "sessions"), 5);
    // 사람만 세션을 연다.
    code(
      await openSession(h, id("ses", 6), ASG_LOPHN, PLACES.project, {
        ctx: machineCred,
      }),
      "forbidden",
    );
    // 열린 세션 수 상한이 없다. 같은 assignment·같은 자리의 세션이 여러 개다.
    for (const n of [7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      value(await openSession(h, id("ses", n), ASG_LOPHN, PLACES.project));
    }
    assertEquals(
      await count(
        h,
        "sessions",
        `assignment = '${ASG_LOPHN}' and work_place_kind = 'project'`,
      ),
      10,
    );
    assertEquals((await eventsOf(h, "SessionOpened")).length, 14);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R1 [agent-I12]: a withdrawn or paused assignment takes no new session and an unknown assignment is not found", async () => {
  const h = await open();
  try {
    await seed(h);
    value(
      await h.command(
        userCred,
        envelope("WithdrawAssignment", { assignment: ASG_OP }, {
          revision: 1,
          state: "enabled",
        }),
      ),
    );
    // 회수된 assignment는 compare가 어떤 값이든 새 세션을 받지 않는다.
    code(
      await h.command(
        userCred,
        envelope("OpenSession", {
          id: id("ses", 1),
          assignment: ASG_OP,
          work_place: PLACES.project,
          opening_context: null,
        }, { assignment_revision: 2, assignment_state: "enabled" }),
      ),
      "forbidden",
    );
    // 멈춘 assignment도 새 세션을 받지 않는다(대상 보관).
    await setAssignmentState(h, ASG_CE, "paused");
    code(
      await openSession(h, id("ses", 1), ASG_CE, PLACES.project),
      "forbidden",
    );
    code(
      await h.command(
        userCred,
        envelope("OpenSession", {
          id: id("ses", 1),
          assignment: id("asg", 30),
          work_place: PLACES.project,
          opening_context: null,
        }, { assignment_revision: 1, assignment_state: "enabled" }),
      ),
      "not_found",
    );
    // 낡은 assignment 판 기준은 충돌이다.
    code(
      await h.command(
        userCred,
        envelope("OpenSession", {
          id: id("ses", 1),
          assignment: ASG_LOPHN,
          work_place: PLACES.project,
          opening_context: null,
        }, { assignment_revision: 7, assignment_state: "enabled" }),
      ),
      "conflict",
    );
    assertEquals(await count(h, "sessions"), 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R3: a message sent while a run is going is received at once and shown applied only after a model call includes it", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const received = output<Snapshot>(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    // 접수와 담당 run이 같이 남고 최초 반영은 비어 있다.
    assertEquals(received.message["run"], run);
    assertEquals(received.message["mode"], "correction");
    assertEquals(received.message["applied_at_call"], null);
    assertEquals(
      (await eventsOf(h, "MessageReceived", id("msg", 2))).length,
      1,
    );
    assertEquals((await eventsOf(h, "MessageApplied")).length, 0);
    // 접수만으로 run을 끝내거나 멈추지 않는다.
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [run]))[0]![
          "state"
        ],
      ),
      "running",
    );
    // 입력 접수는 수정·멈춤 완료 표시가 아니다. 반영은 model call 뒤에만 있다.
    value(await startCall(h, id("mcl", 1), run, session));
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
        run,
      }),
    ) as { messages: Snapshot[] };
    assertEquals(
      listed.messages.map((entry) => entry.message["applied_at_call"]),
      [null, null],
    );
    const applied = output<{ messages: Snapshot[] }>(
      await applyMessages(h, [id("msg", 2)], id("mcl", 1)),
    );
    assertEquals(applied.messages[0]!.message["applied_at_call"], id("mcl", 1));
    assertEquals((await eventsOf(h, "MessageApplied", id("msg", 2))).length, 1);
    // 최초 반영은 한 번이다. 다른 call로 다시 반영하지 못한다.
    value(await startCall(h, id("mcl", 2), run, session, 2));
    code(await applyMessages(h, [id("msg", 2)], id("mcl", 2)), "conflict");
    // 같은 call 재전송은 이전 결과다.
    value(await applyMessages(h, [id("msg", 2)], id("mcl", 1)));
    assertEquals((await eventsOf(h, "MessageApplied")).length, 1);
    // 다른 run의 call이나 없는 call은 반영하지 못한다.
    code(await applyMessages(h, [id("msg", 2)], id("mcl", 9)), "not_found");
    // 사람만 접수하고 machine만 반영한다.
    code(
      await receive(h, {
        message: id("msg", 3),
        session,
        mode: "request",
      }, machineCred),
      "forbidden",
    );
    code(
      await h.command(
        userCred,
        envelope("ApplyMessages", {
          messages: [id("msg", 1)],
          call: id("mcl", 1),
        }, {
          applied_at_call: null,
        }),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R3: receiving a message and accepting its run are one transaction", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await h.command(
        machineCred,
        envelope("SeedAcceptFailure", { fail: true }),
      ),
    );
    code(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
      "conflict",
    );
    // 접수가 실패하면 메시지도 event도 남지 않는다.
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
    assertEquals((await eventsOf(h, "MessageReceived")).length, 0);
    assertEquals((await eventsOf(h, "RunAccepted")).length, 0);
    value(
      await h.command(
        machineCred,
        envelope("SeedAcceptFailure", { fail: false }),
      ),
    );
    const snapshot = output<Snapshot>(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    // 접수 완료를 돌려줄 때 담당 run이 이미 같은 commit에 있다.
    const run = String(snapshot.message["run"]);
    const source =
      (await sql(h, "select source_message, session from runs where id = ?", [
        run,
      ]))[0]!;
    assertEquals(String(source["source_message"]), id("msg", 1));
    assertEquals(String(source["session"]), session);
    assertEquals((await eventsOf(h, "RunAccepted", run)).length, 1);
    // 같은 id 재전송(다른 idempotency key)은 같은 메시지와 같은 run 하나다.
    const again = output<Snapshot>(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    assertEquals(again.message["run"], run);
    assertEquals(await count(h, "runs"), 1);
    assertEquals(await count(h, "messages"), 1);
    // 같은 id의 다른 내용은 충돌이고 run을 더 만들지 않는다.
    code(
      await receive(h, {
        message: id("msg", 1),
        session,
        mode: "request",
        text: "another body for the same id",
      }),
      "conflict",
    );
    assertEquals(await count(h, "runs"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R4: speakers stay distinct and a message links only real targets", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const doc = id("doc", 1);
    const ver = id("ver", 1);
    const body = textContent("a plan without links");
    // agent 자격의 기록(자기 run 묶음·다른 assignment 거절)은 apps/core/testing/
    // lophn-agent-conversation_test.ts가 platform의 run 판정과 함께 본다.
    const record = (
      message: string,
      links: unknown[],
      ctx: AuthenticatedContext = machineCred,
      target: string | null = run,
    ) =>
      h.command(
        ctx,
        envelope("RecordMessage", {
          id: message,
          session,
          run: target,
          content: body,
          links,
        }),
      );
    // 계획만 있는 답에는 생성 링크가 없다. 아직 없는 문서·version은 링크가 될 수 없다.
    const plan = output<Snapshot>(await record(id("msg", 2), []));
    assertEquals(plan.message["links"], []);
    code(
      await record(id("msg", 3), [{ kind: "document", document: doc }]),
      "invalid_input",
    );
    code(
      await record(
        id("msg", 3),
        [{ kind: "version", document: doc, version: ver }],
      ),
      "invalid_input",
    );
    // 실제 문서가 생기고 version이 저장된 뒤에는 그 링크를 남긴다.
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "DocumentCreated",
          subject: doc,
          payload: { version: ver },
        }),
      ),
    );
    const linked = output<Snapshot>(
      await record(id("msg", 3), [
        { kind: "document", document: doc },
        { kind: "version", document: doc, version: ver },
      ]),
    );
    assertEquals((linked.message["links"] as unknown[]).length, 2);
    // 다른 문서의 version은 이 문서의 링크가 아니다.
    code(
      await record(
        id("msg", 4),
        [{ kind: "version", document: id("doc", 2), version: ver }],
      ),
      "invalid_input",
    );
    // 같은 id의 같은 기록은 이전 결과이고 다른 링크는 충돌이다.
    value(
      await record(id("msg", 3), [
        { kind: "document", document: doc },
        { kind: "version", document: doc, version: ver },
      ]),
    );
    code(
      await record(id("msg", 3), [{ kind: "document", document: doc }]),
      "conflict",
    );
    assertEquals(await count(h, "messages"), 3);
    // 발언자: 사람과 machine 확인 사실이 구분된다.
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
      }),
    ) as { messages: Snapshot[] };
    assertEquals(
      listed.messages.map((
        entry,
      ) => [
        entry.message["id"],
        entry.message["actor"],
        entry.message["mode"],
      ]),
      [
        [id("msg", 1), "user", "request"],
        [id("msg", 2), "machine", null],
        [id("msg", 3), "machine", null],
      ],
    );
    // 각 발언에 시각 대신 쓰는 생성 순번이 있고 순서가 곧 발언 순서다.
    const seqs = listed.messages.map((entry) => BigInt(entry.created_seq));
    assertEquals([...seqs].sort((a, b) => (a < b ? -1 : 1)), seqs);
    // 사람은 기록 command를 쓰지 못한다.
    code(await record(id("msg", 6), [], userCred), "forbidden");
    // 다른 세션의 run에는 붙이지 못한다.
    const other = await openLophn(h, id("ses", 2));
    value(
      await receive(h, {
        message: id("msg", 7),
        session: other,
        mode: "request",
      }),
    );
    code(
      await record(id("msg", 8), [], machineCred, await runOf(h, id("msg", 7))),
      "invalid_input",
    );
    assertEquals(await count(h, "messages"), 4);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R4 [ctx-I58j]: a context link needs a context that was created", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const ctx = id("ctx", 1);
    const record = (message: string, links: unknown[]) =>
      h.command(
        machineCred,
        envelope("RecordMessage", {
          id: message,
          session,
          run,
          content: textContent("a context to look at"),
          links,
        }),
      );
    // 아직 없는 context는 링크가 될 수 없다.
    code(
      await record(id("msg", 2), [{ kind: "context", context: ctx }]),
      "invalid_input",
    );
    value(
      await h.command(
        machineCred,
        envelope("SeedTargetFixture", {
          type: "ContextCreated",
          subject: ctx,
          payload: {},
        }),
      ),
    );
    const linked = output<Snapshot>(
      await record(id("msg", 2), [{ kind: "context", context: ctx }]),
    );
    assertEquals(linked.message["links"], [{ kind: "context", context: ctx }]);
    // 다른 context의 링크는 이 context의 것이 아니다.
    code(
      await record(id("msg", 3), [{ kind: "context", context: id("ctx", 2) }]),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R5: corrections keep their receipt order and a correction differs from a next request", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    value(
      await receive(h, {
        message: id("msg", 3),
        session,
        mode: "correction",
        run,
      }),
    );
    // 수정은 새 run을 만들지 않고 같은 run에 접수 순서로 남는다.
    assertEquals(await count(h, "runs"), 1);
    const listed = value(
      await h.read({ resource: "messages", method: "list" }, userCred, {
        session,
        run,
      }),
    ) as { messages: Snapshot[] };
    assertEquals(
      listed.messages.map((
        entry,
      ) => [entry.message["id"], entry.message["mode"]]),
      [
        [id("msg", 1), "request"],
        [id("msg", 2), "correction"],
        [id("msg", 3), "correction"],
      ],
    );
    // 다음 일은 따로 보존하는 다음 요청이고 현재 run의 수정이 아니다.
    const next = output<Snapshot>(
      await receive(h, { message: id("msg", 4), session, mode: "request" }),
    );
    assert(next.message["run"] !== run);
    assertEquals(await count(h, "runs"), 2);
    // 수정은 수정할 run이 필요하고 다음 일은 대상 run을 받지 않는다.
    code(
      await receive(h, { message: id("msg", 5), session, mode: "correction" }),
      "invalid_input",
    );
    code(
      await receive(h, {
        message: id("msg", 5),
        session,
        mode: "request",
        run,
      }),
      "invalid_input",
    );
    // 다른 세션·없는 run은 없는 run과 같다.
    const other = await openLophn(h, id("ses", 2));
    code(
      await receive(h, {
        message: id("msg", 5),
        session: other,
        mode: "correction",
        run,
      }),
      "not_found",
    );
    // 미반영 수정이 둘 있는 동안 정상 종료는 막히고, 모두 반영한 뒤에 끝난다.
    value(await startCall(h, id("mcl", 1), run, session));
    value(await startCall(h, id("mcl", 2), run, session, 2));
    value(await applyMessages(h, [id("msg", 2)], id("mcl", 1)));
    code(await finishRun(h, run, DONE), "conflict");
    value(await applyMessages(h, [id("msg", 3)], id("mcl", 2)));
    value(await finishRun(h, run, DONE));
    // 다음 일 요청은 정상 종료를 막지 않았다(그 run의 자기 요청은 반영 대상이 아니다).
    assertEquals(
      String(
        (await sql(h, "select outcome_kind from runs where id = ?", [run]))[0]![
          "outcome_kind"
        ],
      ),
      "completed",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R6: follow-up requests keep their order, each gets its own run and a failed or stopped run starts none by itself", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const first = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    value(
      await receive(h, { message: id("msg", 3), session, mode: "request" }),
    );
    const second = await runOf(h, id("msg", 2));
    const third = await runOf(h, id("msg", 3));
    // 접수 순서대로 선행 run이 이어지고 현재 일과 분리해 보존한다.
    const chain = await sql(
      h,
      "select id, start_after, source_message from runs order by accepted_seq",
    );
    assertEquals(
      chain.map((
        row,
      ) => [row["id"], row["start_after"], row["source_message"]]),
      [
        [first, null, id("msg", 1)],
        [second, first, id("msg", 2)],
        [third, second, id("msg", 3)],
      ],
    );
    // 현재 일이 끝나기 전에는 다음 일이 시작하지 못한다.
    code(await startRun(h, second, ASG_LOPHN), "conflict");
    // 실패한 일 뒤에는 사람이 확인하기 전까지 다음 일이 자동으로 시작하지 않는다.
    value(await finishRun(h, first, FAILED));
    code(await startRun(h, second, ASG_LOPHN), "conflict");
    value(
      await h.command(
        userCred,
        envelope("ConfirmNextRun", { run: second, predecessor: first }, {
          accepted_seq: String(
            (await sql(
              h,
              "select cast(accepted_seq as text) as s from runs where id = ?",
              [second],
            ))[0]!["s"],
          ),
          predecessor_state_seq: await runStateSeq(h, first),
        }),
      ),
    );
    value(await startRun(h, second, ASG_LOPHN));
    // 정상 종료 뒤에는 다음 접수가 확인 없이 시작한다.
    value(await finishRun(h, second, DONE));
    value(await startRun(h, third, ASG_LOPHN));
    assertEquals(await count(h, "runs", "state = 'running'"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R6: a stopped run leaves the next request waiting", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const first = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    const second = await runOf(h, id("msg", 2));
    value(
      await h.command(
        userCred,
        envelope("StopRun", {
          run: first,
          request_key: "stop-1",
          reason: "user_stopped",
        }, {
          state_seq: await runStateSeq(h, first),
        }),
      ),
    );
    code(await startRun(h, second, ASG_LOPHN), "conflict");
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [second]))[0]![
          "state"
        ],
      ),
      "accepted",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R7: a correction that arrives before the end joins the running run and blocks a normal end until applied", async () => {
  const h = await open();
  try {
    await seed(h);
    await seedProvider(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    // 끝나기 직전에 도착한 수정이 있으면 정상 종료는 거절이다(FinishRun).
    value(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    code(await finishRun(h, run, DONE), "conflict");
    assertEquals(
      String(
        (await sql(h, "select state from runs where id = ?", [run]))[0]![
          "state"
        ],
      ),
      "running",
    );
    // 반영 뒤에는 정상 종료가 확정된다. 수정은 그 run 하나에만 남았다.
    value(await startCall(h, id("mcl", 1), run, session));
    value(await applyMessages(h, [id("msg", 2)], id("mcl", 1)));
    value(await finishRun(h, run, DONE));
    assertEquals(await count(h, "runs"), 1);
    assertEquals(String((await messageRow(h, id("msg", 2)))!["run"]), run);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R7: a correction that arrives after the end gets exactly one new run and the finished run is not reopened", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    value(await finishRun(h, run, DONE));
    const before =
      (await sql(h, "select state, state_seq, result from runs where id = ?", [
        run,
      ]))[0]!;
    const late = output<Snapshot>(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    const fresh = String(late.message["run"]);
    assert(fresh !== run);
    // 새 담당 run은 그 수정 메시지가 출처이고 끝난 run 뒤에 이어진다.
    const created = (await sql(
      h,
      "select source_message, start_after, state from runs where id = ?",
      [fresh],
    ))[0]!;
    assertEquals(String(created["source_message"]), id("msg", 2));
    assertEquals(String(created["start_after"]), run);
    assertEquals(String(created["state"]), "accepted");
    // 끝난 run은 그대로다.
    const after =
      (await sql(h, "select state, state_seq, result from runs where id = ?", [
        run,
      ]))[0]!;
    assertEquals(after, before);
    // 같은 수정의 재전송은 담당을 하나 더 만들지 않는다.
    const again = output<Snapshot>(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run,
      }),
    );
    assertEquals(again.message["run"], fresh);
    assertEquals(await count(h, "runs"), 2);
    // 정상 종료한 선행 run 뒤라 새 담당 run은 곧바로 시작할 수 있다.
    value(await startRun(h, fresh, ASG_LOPHN));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R7: a correction left on a run that ended unsuccessfully moves to exactly one new run", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const first = await runningRun(h, session, id("msg", 1));
    value(
      await receive(h, {
        message: id("msg", 2),
        session,
        mode: "correction",
        run: first,
      }),
    );
    // 정상 종료만 미반영 수정에 막힌다. 실패 종료는 그대로 확정된다.
    value(await finishRun(h, first, FAILED));
    value(
      await receive(h, { message: id("msg", 3), session, mode: "request" }),
    );
    const next = await runOf(h, id("msg", 3));
    const state = String((await messageRow(h, id("msg", 2)))!["run"]);
    assertEquals(state, first);
    const stateSeq = String(
      (await sql(
        h,
        "select cast(state_seq as text) as s from messages where id = ?",
        [id("msg", 2)],
      ))[0]!["s"],
    );
    const assign = (previous: string, run: string, seq = stateSeq) =>
      h.command(
        machineCred,
        envelope("AssignMessage", { message: id("msg", 2), run }, {
          previous_run: previous,
          message_state_seq: seq,
          applied_at_call: null,
        }),
      );
    // 사람은 보존한 담당을 옮기지 못하고 machine만 옮긴다.
    code(
      await h.command(
        userCred,
        envelope("AssignMessage", { message: id("msg", 2), run: next }, {
          previous_run: first,
          message_state_seq: stateSeq,
          applied_at_call: null,
        }),
      ),
      "forbidden",
    );
    // 이전 담당이 다르면 충돌이다. 같은 run으로의 이동은 입력 오류다.
    code(await assign(next, next), "invalid_input");
    code(await assign(first, next, "999999"), "conflict");
    const moved = output<Snapshot>(await assign(first, next));
    assertEquals(moved.message["run"], next);
    assertEquals(
      (await eventsOf(h, "MessageAssigned", id("msg", 2))).length,
      1,
    );
    // 같은 이동의 재전송은 이전 결과이고 담당은 하나다.
    value(await assign(first, next));
    assertEquals(
      (await eventsOf(h, "MessageAssigned", id("msg", 2))).length,
      1,
    );
    // 이미 끝난 run으로는 옮기지 못한다. 그 run의 다른 말은 다른 담당에 남지 않는다.
    const freshSeq = String(
      (await sql(
        h,
        "select cast(state_seq as text) as s from messages where id = ?",
        [id("msg", 2)],
      ))[0]!["s"],
    );
    code(await assign(next, first, freshSeq), "conflict");
    assertEquals(String((await messageRow(h, id("msg", 2)))!["run"]), next);
    // 요청은 수정처럼 옮기지 못한다.
    code(
      await h.command(
        machineCred,
        envelope("AssignMessage", { message: id("msg", 3), run: next }, {
          previous_run: next,
          message_state_seq: "1",
          applied_at_call: null,
        }),
      ),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R8 [agent-I12]: a paused assignment keeps the session open and readable but takes no new input, and nobody closes it by hand", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    await setAssignmentState(h, ASG_LOPHN, "paused");
    // 일시 멈춤은 닫지 않는다. 원문은 계속 읽고 세션은 열려 있다.
    const read = () =>
      h.read({ resource: "messages", method: "list" }, userCred, { session });
    assertEquals(
      (value(await read()) as { messages: unknown[] }).messages.length,
      1,
    );
    assertEquals(
      String(
        (await sql(h, "select state from sessions where id = ?", [session]))[
          0
        ]!["state"],
      ),
      "open",
    );
    // 새 입력은 받지 않는다. 원문을 run 없이 남겨 두지도 않는다.
    code(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
      "forbidden",
    );
    code(
      await receive(h, {
        message: id("msg", 3),
        session,
        mode: "correction",
        run,
      }),
      "forbidden",
    );
    assertEquals(await count(h, "messages"), 1);
    assertEquals(await count(h, "runs"), 1);
    // 재개하면 같은 세션이 다시 입력을 받는다.
    await setAssignmentState(h, ASG_LOPHN, "enabled");
    value(
      await receive(h, { message: id("msg", 2), session, mode: "request" }),
    );
    assertEquals(await count(h, "messages"), 2);
    // 사람이 세션을 닫는 길은 없다: CloseSession은 machine만, 회수된 assignment일 때만 쓴다.
    const close = async (ctx = userCred, reason = "assignment_withdrawn") =>
      h.command(
        ctx,
        envelope("CloseSession", { session, reason }, {
          state_seq: await sessionSeq(h, session),
          state: "open",
        }),
      );
    code(await close(userCred), "forbidden");
    code(await close(machineCred), "forbidden");
    code(await close(machineCred, "user_closed"), "invalid_input");
    assertEquals((await eventsOf(h, "SessionClosed")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R8 [agent-I12]: a withdrawn assignment rejects new input and its session closes only after the runs are cleaned up, then reads but never reopens", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = id("ses", 1);
    value(await openSession(h, session, ASG_OP, PLACES.project));
    const run = await runningRun(h, session, id("msg", 1), ASG_OP);
    value(
      await h.command(
        userCred,
        envelope("WithdrawAssignment", { assignment: ASG_OP }, {
          revision: 1,
          state: "enabled",
        }),
      ),
    );
    // 세션이 아직 열려 있어도 회수된 assignment는 새 입력을 거절한다.
    code(
      await h.command(
        userCred,
        envelope("ReceiveMessage", {
          id: id("msg", 2),
          session,
          content: textContent("after withdrawn"),
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: await sessionSeq(h, session),
          assignment_revision: 2,
          assignment_state: "enabled",
        }),
      ),
      "forbidden",
    );
    const close = async (seq?: string) =>
      h.command(
        machineCred,
        envelope("CloseSession", { session, reason: "assignment_withdrawn" }, {
          state_seq: seq ?? await sessionSeq(h, session),
          state: "open",
        }),
      );
    // 미종료 run이 남아 있는 동안은 닫지 않는다.
    code(await close(), "conflict");
    value(
      await h.command(
        machineCred,
        envelope("StopRun", {
          run,
          request_key: "stop-withdrawn",
          reason: "assignment_withdrawn",
        }, {
          state_seq: await runStateSeq(h, run),
        }),
      ),
    );
    // 낡은 CAS는 충돌이고, 사람은 닫지 못한다.
    code(await close("999999"), "conflict");
    code(
      await h.command(
        userCred,
        envelope("CloseSession", { session, reason: "assignment_withdrawn" }, {
          state_seq: await sessionSeq(h, session),
          state: "open",
        }),
      ),
      "forbidden",
    );
    const closed = output<{ state: string; reason: string }>(await close());
    assertEquals(closed.state, "closed");
    assertEquals(closed.reason, "assignment_withdrawn");
    assertEquals((await eventsOf(h, "SessionClosed", session)).length, 1);
    // 닫힌 세션은 새 입력과 새 기록을 거절하고 원문은 읽는다. 다시 열리지 않는다.
    code(
      await receive(h, { message: id("msg", 3), session, mode: "request" }),
      "forbidden",
    );
    code(
      await h.command(
        machineCred,
        envelope("RecordMessage", {
          id: id("msg", 4),
          session,
          run: null,
          content: textContent("late"),
          links: [],
        }),
      ),
      "forbidden",
    );
    assertEquals(await count(h, "messages"), 1);
    const read = value(
      await h.read({ resource: "sessions", method: "read" }, userCred, {
        session,
      }),
    ) as { session: Record<string, unknown> };
    assertEquals(read.session["state"], "closed");
    assertEquals(read.session["closed_reason"], "assignment_withdrawn");
    code(await close(), "conflict");
    const reopened = await h.probeWrite(
      "update sessions set state = 'open', closed_reason = null, closed_at = null where id = ?",
      [session],
    );
    assert(!reopened.ok, "a closed session must not reopen");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R8 [agent-I12]: a session of another assignment is absent for an agent and for a coding agent", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await receive(h, { message: id("msg", 1), session, mode: "request" }),
    );
    const readSession = (ctx: AuthenticatedContext) =>
      h.read({ resource: "sessions", method: "read" }, ctx, { session });
    const listMessages = (ctx: AuthenticatedContext) =>
      h.read({ resource: "messages", method: "list" }, ctx, { session });
    const listSessions = (ctx: AuthenticatedContext, assignment: string) =>
      h.read({ resource: "sessions", method: "list" }, ctx, {
        assignment,
        work_place: PLACES.project,
      });
    value(await readSession(agentOf(ASG_LOPHN)));
    value(await listMessages(agentOf(ASG_LOPHN)));
    for (
      const other of [agentOf(ASG_CE), cred(`coding_agent:${id("cac", 1)}`)]
    ) {
      code(await readSession(other), "not_found");
      if (other.actor.startsWith("agent:")) {
        code(await listMessages(other), "not_found");
      }
      // 다른 assignment의 세션을 이름으로 물어도 목록은 비어 있다.
      const list = value(await listSessions(other, ASG_LOPHN)) as {
        sessions: unknown[];
      };
      assertEquals(list.sessions, []);
    }
    const mine = value(
      await listSessions(agentOf(ASG_LOPHN), ASG_LOPHN),
    ) as { sessions: unknown[] };
    assertEquals(mine.sessions.length, 1);
    // 없는 세션과 같은 답이다.
    code(
      await h.read({ resource: "sessions", method: "read" }, userCred, {
        session: id("ses", 30),
      }),
      "not_found",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R16 [agent-I12]: the place is fixed when the session opens and no message, run or command changes it", async () => {
  const h = await open();
  try {
    await seed(h);
    value(await openSession(h, id("ses", 1), ASG_AE, PLACES.app));
    value(await openSession(h, id("ses", 2), ASG_OP, PLACES.project));
    value(await openSession(h, id("ses", 3), ASG_CE, PLACES.project));
    value(await openSession(h, id("ses", 4), ASG_LOPHN, PLACES.app));
    const place = async (session: string) => {
      const read = value(
        await h.read({ resource: "sessions", method: "read" }, userCred, {
          session,
        }),
      ) as { session: { work_place: unknown } };
      return read.session.work_place;
    };
    // 같은 세션을 다시 읽어도(탭 이동·재시작 뒤 조회) 자리는 같다.
    for (const _ of [1, 2]) {
      assertEquals(await place(id("ses", 1)), PLACES.app);
      assertEquals(await place(id("ses", 2)), PLACES.project);
      assertEquals(await place(id("ses", 3)), PLACES.project);
      assertEquals(await place(id("ses", 4)), PLACES.app);
    }
    // 사람의 메시지나 run도 자리를 바꾸지 않는다.
    await runningRun(h, id("ses", 4), id("msg", 1));
    assertEquals(await place(id("ses", 4)), PLACES.app);
    // 자리 칸과 assignment는 쓰는 길이 없다: 저장소도 바뀌는 것을 막는다.
    for (
      const update of [
        "update sessions set work_place_kind = 'project', work_place_id = ? where id = ?",
        "update sessions set assignment = ? where id = ?",
      ]
    ) {
      const param = update.includes("assignment") ? ASG_CE : PROJECT;
      const moved = await h.probeWrite(update, [param, id("ses", 4)]);
      assert(!moved.ok, "the identity of a session must not change");
    }
    assertEquals(await place(id("ses", 4)), PLACES.app);
  } finally {
    await h.close();
  }
});

async function blobRefsOf(h: LedgerHarness, message: string) {
  return await sql(
    h,
    `select owner_kind, field, hash, size_bytes from blob_refs
     where owner_key = ?`,
    [message],
  );
}

Deno.test("lophn-agent/conversation#R2: a received body is one permanent blob reference in the same transaction as the message", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const message = id("msg", 1);
    const text = "한글 본문도 그대로 남긴다";
    value(await receive(h, { message, session, mode: "request", text }));
    // ledger에는 본문 값의 blob hash만 남고 같은 hash의 영구 참조 하나가 있다.
    const hash = bodyHashOf(text);
    assertEquals((await messageRow(h, message))?.["body"], hash);
    const refs = await blobRefsOf(h, message);
    assertEquals(refs.length, 1);
    assertEquals(
      [refs[0]!["owner_kind"], refs[0]!["field"], refs[0]!["hash"]],
      ["message", "body", hash],
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify({ parts: [{ kind: "text", text }], schema_version: 1 }),
    );
    assertEquals(Number(refs[0]!["size_bytes"]), bytes.length);
    const [received] = await eventsOf(h, "MessageReceived", message);
    assertEquals(JSON.parse(String(received!["payload"]))["body"], hash);
    // 같은 값의 재전송은 참조를 더하지 않고 이전 결과다.
    value(await receive(h, { message, session, mode: "request", text }));
    assertEquals((await blobRefsOf(h, message)).length, 1);
    assertEquals(await count(h, "messages"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R2: without a live preparation nothing is stored and a retry takes the message once", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const message = id("msg", 1);
    value(
      await h.command(
        machineCred,
        envelope("SeedUnpreparedBody", { unprepared: true }),
      ),
    );
    code(
      await receive(h, { message, session, mode: "request", text: "hello" }),
      "invalid_input",
    );
    // 참조 등록이 막히면 message·event·run·참조 모두 되돌아간다.
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
    assertEquals((await blobRefsOf(h, message)).length, 0);
    assertEquals((await eventsOf(h, "MessageReceived", message)).length, 0);
    assertEquals((await eventsOf(h, "RunAccepted")).length, 0);
    value(
      await h.command(
        machineCred,
        envelope("SeedUnpreparedBody", { unprepared: false }),
      ),
    );
    value(
      await receive(h, { message, session, mode: "request", text: "hello" }),
    );
    assertEquals(await count(h, "messages"), 1);
    assertEquals(await count(h, "runs"), 1);
    assertEquals((await blobRefsOf(h, message)).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R4: a recorded machine body is text only and a different body under the same id conflicts", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, id("msg", 1));
    const record = (message: string, content: unknown) =>
      h.command(
        machineCred,
        envelope("RecordMessage", {
          id: message,
          session,
          run,
          content,
          links: [],
        }),
      );
    value(await record(id("msg", 2), textContent("checked")));
    const refs = await blobRefsOf(h, id("msg", 2));
    assertEquals(refs.length, 1);
    assertEquals(refs[0]!["hash"], bodyHashOf("checked"));
    value(await record(id("msg", 2), textContent("checked")));
    code(await record(id("msg", 2), textContent("changed")), "conflict");
    // 시각 블록은 agent의 답에만 있다. machine이 보내면 저장하지 않는다.
    code(
      await record(id("msg", 3), {
        schema_version: 1,
        parts: [{ kind: "text", text: "x" }, {
          kind: "visual",
          block: {
            key: "t",
            schema_version: 1,
            kind: "table",
            title: "t",
            description: "d",
            sources: [],
            payload: { columns: [], rows: [] },
          },
        }],
      }),
      "invalid_input",
    );
    assertEquals((await blobRefsOf(h, id("msg", 3))).length, 0);
  } finally {
    await h.close();
  }
});

function startRequestOf(h: LedgerHarness, text: string, place: Place) {
  return h.command(
    machineCred,
    envelope("StartRequestFixture", {
      role: "context_engineer",
      work_place: place,
      text,
    }),
  );
}

Deno.test("lophn-agent/conversation#R1 #R3 [ctx-I58h]: a request started for a person opens a session at the given work place, stores the user request and accepts one run in one transaction", async () => {
  const h = await open();
  try {
    await seed(h);
    const started = output<{ session: string; message: string; run: string }>(
      await startRequestOf(h, "Look at these violations.", PLACES.project),
    );
    // 세션은 Context Engineer의 새 세션이고 작업 자리는 넘겨받은 자리다.
    const session = (await sql(
      h,
      "select assignment, work_place_kind, work_place_id, state from sessions where id = ?",
      [started.session],
    ))[0]!;
    assertEquals(String(session["assignment"]), ASG_CE);
    assertEquals(String(session["work_place_kind"]), "project");
    assertEquals(String(session["work_place_id"]), PROJECT);
    assertEquals(String(session["state"]), "open");
    // message는 사람 요청이고 본문 blob 참조가 message 소유로 하나 있다.
    const message = (await sql(
      h,
      "select session, actor, mode, run, body from messages where id = ?",
      [started.message],
    ))[0]!;
    assertEquals(String(message["session"]), started.session);
    assertEquals(String(message["actor"]), "user");
    assertEquals(String(message["mode"]), "request");
    assertEquals(String(message["run"]), started.run);
    assertEquals(
      String(message["body"]),
      bodyHashOf("Look at these violations."),
    );
    assertEquals(
      await count(
        h,
        "blob_refs",
        `owner_kind = 'message' and owner_key = '${started.message}' and field = 'body'`,
      ),
      1,
    );
    // run은 이 message에서 시작한 Context Engineer의 접수된 run 하나다.
    const run = (await sql(
      h,
      "select assignment, session, source_kind, source_message, state from runs where id = ?",
      [started.run],
    ))[0]!;
    assertEquals(String(run["assignment"]), ASG_CE);
    assertEquals(String(run["session"]), started.session);
    assertEquals(String(run["source_kind"]), "message");
    assertEquals(String(run["source_message"]), started.message);
    assertEquals(String(run["state"]), "accepted");
    assertEquals(
      (await eventsOf(h, "SessionOpened", started.session)).length,
      1,
    );
    assertEquals(
      (await eventsOf(h, "MessageReceived", started.message)).length,
      1,
    );
    assertEquals((await eventsOf(h, "RunAccepted", started.run)).length, 1);
    // 두 번 보내면 각자 새 세션·message·run이다(한 번의 단추가 한 요청이다).
    const second = output<{ run: string }>(
      await startRequestOf(h, "Another.", PLACES.project),
    );
    assert(second.run !== started.run);
    assertEquals(await count(h, "runs"), 2);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R14 [ctx-I58h]: with no enabled assignment for the role the request is unavailable and leaves no session, message or run", async () => {
  const h = await open();
  try {
    await seed(h);
    await setAssignmentState(h, ASG_CE, "paused");
    code(
      await startRequestOf(h, "Look at these violations.", PLACES.project),
      "unavailable",
    );
    assertEquals(await count(h, "sessions"), 0);
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
    // 작업 자리가 실제 project가 아니면 세션을 열 때 거절되어 아무것도 남지 않는다.
    await setAssignmentState(h, ASG_CE, "enabled");
    code(
      await startRequestOf(h, "Look.", { kind: "project", id: id("prj", 9) }),
      "not_found",
    );
    assertEquals(await count(h, "sessions"), 0);
    assertEquals(await count(h, "messages"), 0);
    assertEquals(await count(h, "runs"), 0);
  } finally {
    await h.close();
  }
});
