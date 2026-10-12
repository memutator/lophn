import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { LedgerHarness } from "../../../../apps/core/testing/ledger.ts";
import { envelope } from "../run-loop/testing/mod.ts";
import { bodyHashOf, cred, id } from "./testing/mod.ts";
import {
  ASG_LOPHN,
  code,
  count,
  DONE,
  eventsOf,
  finishedConversation,
  finishRun,
  machineCred,
  open,
  openLophn,
  openSession,
  output,
  PLACES,
  receive,
  runningRun,
  seed,
  seqOf,
  sessionSeq,
  setAssignmentState,
  SOURCE_ANSWER,
  SOURCE_FIRST,
  SOURCE_LAST,
  SOURCE_SECOND,
  sql,
  userCred,
  value,
} from "./world_test.ts";

// Fork(conversation#R9, R24): 같은 agent·같은 자리의 새 session에 고른 지점까지의 확정 메시지를
// 복사한다. 실제 등록 executor(harness)와 임시 ledger 파일을 쓰고 실제 provider를 부르지 않는다.

type Forked = {
  id: string;
  state: string;
  forked_from: { session: string; through_seq: string };
  copied_messages: number;
  state_seq: string;
};

type Listed = {
  messages: {
    message: Record<string, unknown>;
    created_seq: string;
    state_seq: string;
  }[];
};

function fork(
  h: LedgerHarness,
  session: string,
  source: string,
  throughSeq: string,
  ctx = userCred,
) {
  return h.command(
    ctx,
    envelope("ForkSession", { id: session, source, through_seq: throughSeq }),
  );
}

async function listMessages(h: LedgerHarness, session: string) {
  return (value(
    await h.read({ resource: "messages", method: "list" }, userCred, {
      session,
    }),
  ) as Listed).messages;
}

async function readSession(h: LedgerHarness, session: string) {
  return (value(
    await h.read({ resource: "sessions", method: "read" }, userCred, {
      session,
    }),
  ) as { session: Record<string, unknown> }).session;
}

Deno.test("lophn-agent/conversation#R9 [agent-I16]: Fork copies the confirmed messages up to the chosen point in the same order and points at the source", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const through = await seqOf(h, SOURCE_ANSWER);
    const copy = id("ses", 2);
    const forked = output<Forked>(await fork(h, copy, source, through));
    assertEquals(forked.id, copy);
    assertEquals(forked.state, "open");
    assertEquals(forked.forked_from, { session: source, through_seq: through });
    assertEquals(forked.copied_messages, 2);

    const copied = await listMessages(h, copy);
    assertEquals(copied.length, 2);
    // 복사한 메시지는 새 ID와 새 순번을 갖고 원래 메시지를 가리킨다.
    assertEquals(
      copied.map((entry) => entry.message["copied_from"]),
      [SOURCE_FIRST, SOURCE_ANSWER],
    );
    assertEquals(
      copied.map((entry) => entry.message["actor"]),
      ["user", "machine"],
    );
    assertEquals(
      copied.map((entry) => entry.message["body"]),
      [bodyHashOf("first"), bodyHashOf("answer one")],
    );
    for (const entry of copied) {
      assertNotEquals(entry.message["id"], SOURCE_FIRST);
      assertNotEquals(entry.message["id"], SOURCE_ANSWER);
      assertEquals(entry.message["session"], copy);
      // 지난 발언이라 run도 mode도 최초 반영도 없다.
      assertEquals(entry.message["run"], null);
      assertEquals(entry.message["mode"], null);
      assertEquals(entry.message["applied_at_call"], null);
      assertEquals(entry.message["links"], []);
    }
    assert(BigInt(copied[0]!.created_seq) < BigInt(copied[1]!.created_seq));
    // 고른 지점 뒤의 메시지는 복사하지 않고 출처는 그대로다.
    assertEquals(
      (await listMessages(h, copy)).some((entry) =>
        entry.message["copied_from"] === SOURCE_SECOND ||
        entry.message["copied_from"] === SOURCE_LAST
      ),
      false,
    );
    assertEquals((await listMessages(h, source)).length, 4);

    const record = await readSession(h, copy);
    assertEquals(record["assignment"], ASG_LOPHN);
    assertEquals(record["work_place"], PLACES.project);
    assertEquals(record["forked_from"], forked.forked_from);
    assertEquals(record["state"], "open");
    assertEquals(record["archived"], false);
    assertEquals(record["compaction"], null);
    assertEquals(record["state_seq"], forked.state_seq);

    const events = await eventsOf(h, "SessionForked", copy);
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      forked_from: forked.forked_from,
      copied_messages: 2,
    });
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: Fork through the last message copies the whole conversation and keeps links and every actor", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const copy = id("ses", 2);
    const forked = output<Forked>(
      await fork(h, copy, source, await seqOf(h, SOURCE_LAST)),
    );
    assertEquals(forked.copied_messages, 4);
    const copied = await listMessages(h, copy);
    assertEquals(
      copied.map((entry) => entry.message["copied_from"]),
      [SOURCE_FIRST, SOURCE_ANSWER, SOURCE_SECOND, SOURCE_LAST],
    );
    // 복사본에서 이어 Fork해도 바로 앞 메시지를 가리킨다.
    const again = id("ses", 3);
    const last = copied[copied.length - 1]!;
    value(await fork(h, again, copy, last.created_seq));
    const copiedAgain = await listMessages(h, again);
    assertEquals(
      copiedAgain.map((entry) => entry.message["copied_from"]),
      copied.map((entry) => entry.message["id"]),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: Fork copies no run, call or effect and starts no work", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const runsBefore = await count(h, "runs");
    const acceptedBefore = (await eventsOf(h, "RunAccepted")).length;
    const copy = id("ses", 2);
    value(await fork(h, copy, source, await seqOf(h, SOURCE_LAST)));
    assertEquals(await count(h, "runs", `session = '${copy}'`), 0);
    assertEquals(await count(h, "runs"), runsBefore);
    assertEquals((await eventsOf(h, "RunAccepted")).length, acceptedBefore);
    assertEquals(await count(h, "model_calls"), 0);
    // 복사본은 미반영 입력이 아니다: 처음 반영 연결이 있는 메시지가 없고 run을 가진 메시지도 없다.
    assertEquals(
      await count(
        h,
        "messages",
        `session = '${copy}' and (run is not null or applied_at_call is not null or mode is not null)`,
      ),
      0,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: each copied message registers its own body reference with the same body", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const copy = id("ses", 2);
    value(await fork(h, copy, source, await seqOf(h, SOURCE_ANSWER)));
    const copied = await listMessages(h, copy);
    for (const entry of copied) {
      const refs = await sql(
        h,
        `select owner_kind, field, hash from blob_refs where owner_key = ?`,
        [String(entry.message["id"])],
      );
      assertEquals(refs.length, 1);
      assertEquals(
        [refs[0]!["owner_kind"], refs[0]!["field"], refs[0]!["hash"]],
        ["message", "body", entry.message["body"]],
      );
    }
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: deleting the source session leaves the copy, its messages and its body references", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const copy = id("ses", 2);
    const forked = output<Forked>(
      await fork(h, copy, source, await seqOf(h, SOURCE_LAST)),
    );
    const before = await listMessages(h, copy);
    value(
      await h.command(
        userCred,
        envelope("DeleteSession", { session: source }, {
          state_seq: await sessionSeq(h, source),
        }),
      ),
    );
    assertEquals(await count(h, "sessions", `id = '${source}'`), 0);
    const after = await listMessages(h, copy);
    assertEquals(
      after.map((entry) => entry.message),
      before.map((entry) => entry.message),
    );
    const kept = await readSession(h, copy);
    assertEquals(kept["forked_from"], forked.forked_from);
    for (const entry of after) {
      assertEquals(
        await count(
          h,
          "blob_refs",
          `owner_key = '${String(entry.message["id"])}'`,
        ),
        1,
      );
    }
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: a session with an unfinished run is not forked", async () => {
  const h = await open();
  try {
    await seed(h);
    // 접수만 된 run도 끝나지 않은 run이다.
    const accepted = await openLophn(h, id("ses", 1));
    value(
      await receive(h, {
        message: SOURCE_FIRST,
        session: accepted,
        mode: "request",
      }),
    );
    code(
      await fork(h, id("ses", 9), accepted, await seqOf(h, SOURCE_FIRST)),
      "conflict",
    );
    // 시작해 진행 중인 run도 같다.
    const running = await openLophn(h, id("ses", 2));
    await runningRun(h, running, SOURCE_SECOND);
    code(
      await fork(h, id("ses", 9), running, await seqOf(h, SOURCE_SECOND)),
      "conflict",
    );
    assertEquals(await count(h, "sessions"), 2);
    assertEquals((await eventsOf(h, "SessionForked")).length, 0);
    assertEquals(await count(h, "messages"), 2);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: the chosen point must be a confirmed message of the source", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const other = await openLophn(h, id("ses", 5));
    value(
      await receive(h, {
        message: id("msg", 9),
        session: other,
        mode: "request",
      }),
    );
    // 다른 session의 메시지 순번이나 메시지가 아닌 event 순번은 고른 지점이 아니다.
    for (
      const through of [
        await seqOf(h, id("msg", 9)),
        "1",
        "999999",
      ]
    ) {
      code(await fork(h, id("ses", 2), source, through), "invalid_input");
    }
    code(
      await fork(h, id("ses", 2), id("ses", 40), await seqOf(h, SOURCE_FIRST)),
      "not_found",
    );
    assertEquals((await eventsOf(h, "SessionForked")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: only a person forks and a paused agent takes no new session", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const through = await seqOf(h, SOURCE_LAST);
    code(
      await fork(h, id("ses", 2), source, through, machineCred),
      "forbidden",
    );
    code(
      await fork(h, id("ses", 2), source, through, cred(`agent:${ASG_LOPHN}`)),
      "forbidden",
    );
    await setAssignmentState(h, ASG_LOPHN, "paused");
    code(await fork(h, id("ses", 2), source, through), "forbidden");
    assertEquals(await count(h, "sessions"), 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: the same Fork again is the same result and another input under its id conflicts", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const copy = id("ses", 2);
    const through = await seqOf(h, SOURCE_ANSWER);
    const first = output<Forked>(await fork(h, copy, source, through));
    const again = output<Forked>(await fork(h, copy, source, through));
    assertEquals(again, first);
    assertEquals(await count(h, "messages", `session = '${copy}'`), 2);
    assertEquals((await eventsOf(h, "SessionForked", copy)).length, 1);
    code(await fork(h, copy, source, await seqOf(h, SOURCE_LAST)), "conflict");
    assertEquals(await count(h, "messages", `session = '${copy}'`), 2);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: the copy keeps the title and model choice of the source and a fork of an archived session is not archived", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    value(
      await h.command(
        userCred,
        envelope("RenameSession", { session: source, title: "Weekly plan" }, {
          state_seq: await sessionSeq(h, source),
        }),
      ),
    );
    value(
      await h.command(
        userCred,
        envelope("ArchiveSession", { session: source }, {
          state_seq: await sessionSeq(h, source),
        }),
      ),
    );
    const copy = id("ses", 2);
    value(await fork(h, copy, source, await seqOf(h, SOURCE_LAST)));
    const record = await readSession(h, copy);
    assertEquals(record["title"], "Weekly plan");
    assertEquals(record["archived"], false);
    assertEquals(record["model_selection"], null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R9 [agent-I16]: a copy of an app session stays in the app", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = id("ses", 7);
    value(await openSession(h, source, ASG_LOPHN, PLACES.app));
    const first = await runningRun(h, source, SOURCE_FIRST, ASG_LOPHN);
    value(await finishRun(h, first, DONE));
    const copy = id("ses", 8);
    value(await fork(h, copy, source, await seqOf(h, SOURCE_FIRST)));
    const record = await readSession(h, copy);
    assertEquals(record["work_place"], PLACES.app);
    assertEquals(record["assignment"], ASG_LOPHN);
  } finally {
    await h.close();
  }
});
