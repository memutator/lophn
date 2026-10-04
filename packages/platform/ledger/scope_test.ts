import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  eventsList,
  type EventVisibilityDefinition,
  type ReadSnapshot,
  type RequestContext,
  type Subject,
} from "../../contracts/platform/mod.ts";
import { commands, deps, fileLedger, note, NOW, user } from "./command-harness.ts";
import { fixtureEvent } from "./event-fixture.ts";
import { createEventVisibilityRegistry } from "./event-visibility.ts";
import { createListEventsRead, scanEvents } from "./events.ts";
import { openReaderConnection } from "./reader-connection.ts";
import { executeRead } from "./reads.ts";
import { runCommand } from "./writer.ts";

async function ledger() {
  const dir = await Deno.makeTempDir({ prefix: "scope-" });
  return { dir, ...await fileLedger(dir) };
}
function registry(
  handle: EventVisibilityDefinition["handle"] = () => ok(true),
) {
  const result = createEventVisibilityRegistry([fixtureEvent], [{
    event: fixtureEvent,
    handle,
  }]);
  assert(result.ok);
  return result.value;
}

// identity R8: 제목·존재·개수·관계를 펼치기 전에 현재 scope로 제한한다. 범위 밖 subject
// filter는 목차·개수를 남기지 않고 전체를 거절이다. 범위 안 자료만으로 batch를 만들 수
// 없으면 eventUnavailable이다.
Deno.test("platform/identity#R8: event list는 subject·type을 scope로 먼저 제한하고 범위 밖은 존재·개수를 누출하지 않는다", async () => {
  const { dir, path, connection } = await ledger();
  await runCommand(connection, deps(), commands, user(), note("one"));
  await runCommand(connection, deps(), commands, user(), note("two"));
  const reader = openReaderConnection(path);
  assert(reader.ok);
  try {
    const subjects: Subject[] = [];
    const read = createListEventsRead({
      registry: registry((snapshot, _ctx, event) =>
        ok(fixtureEvent.payload.parse(event.payload).name !== "hidden")
      ),
      current: () => ok(user()),
      subjects: (_snapshot, _ctx, list) => {
        subjects.push(...list);
        return ok(list.every((subject) => subject === "note:one"));
      },
    });
    // 범위 안 subject만 요청하면 허용 자료만 나온다.
    const allowed = executeRead(reader.value, read, new Map(), user(), {
      after_seq: "0",
      subjects: ["note:one"],
    });
    assert(allowed.ok);
    assertEquals(
      (allowed.value as { events: { subject: string }[] }).events[0].subject,
      "note:one",
    );
    // 범위 밖 subject를 섞으면 존재·개수를 남기지 않고 전체를 거절이다.
    const outside = executeRead(reader.value, read, new Map(), user(), {
      after_seq: "0",
      subjects: ["note:one", "note:outside"],
    });
    assert(!outside.ok);
    assertEquals(outside.error.code, "forbidden");
    assertEquals(JSON.stringify(outside).includes("note:outside"), false);
    // subject gate가 기한 안에 판정을 주지 못하면 전체를 제외다.
    const hanging = createListEventsRead({
      registry: registry(),
      current: () => ok(user()),
      subjects: (_snapshot, _ctx, _list) =>
        err({ code: "internal", message: "gate failure" }) as never,
    });
    const failed = executeRead(reader.value, hanging, new Map(), user(), {
      after_seq: "0",
      subjects: ["note:one"],
    });
    assert(!failed.ok);
    assertEquals(failed.error.code, "unavailable");
    assert(!JSON.stringify(failed).includes("one"));
  } finally {
    reader.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// identity R8: 구독 표면은 금지 본문을 숨기는 것만으로 끝나지 않는다. 제목(payload·subject)
// 이 보이기 전에 owner가 판정하고, 허용하지 않은 event는 목록 숫자에도 섞이지 않는다.
Deno.test("platform/identity#R8: 구독은 허용하지 않은 event를 envelope로 만들지 않고 개수에도 섞이지 않는다", async () => {
  const { dir, path, connection } = await ledger();
  // 같은 idempotency key의 재전달은 event를 다시 만들지 않는다. key를 다르게 둔다.
  await runCommand(connection, deps(), commands, user(), note("visible", "k1"));
  await runCommand(connection, deps(), commands, user(), note("hidden", "k2"));
  const reader = openReaderConnection(path);
  assert(reader.ok);
  let saw = 0;
  const read = createListEventsRead({
    registry: registry((snapshot, _ctx, event) => {
      saw++;
      return ok(fixtureEvent.payload.parse(event.payload).name !== "hidden");
    }),
    current: () => ok(user()),
  });
  const batch = executeRead(reader.value, read, new Map(), user(), {
    after_seq: "0",
  });
  assert(batch.ok);
  const value = batch.value as {
    events: { payload: { name: string } }[];
    scanned_through_seq: string;
    next_cursor: string | null;
  };
  assertEquals(value.events.length, 1);
  assertEquals(value.events[0].payload.name, "visible");
  assertEquals(saw, 2);
  assertEquals(value.scanned_through_seq, "2");
  assertEquals(value.next_cursor, null);
  // 금지 자료가 요약 컬럼에 얹히지 않는다.
  assertEquals(JSON.stringify(value).includes("hidden"), false);
  // owner가 허용 여부를 판정할 수 없으면 event 하나도 내놓지 않는다.
  const denied = scanEvents(
    {
      sql: reader.value.sql,
      as_of_seq: "2",
      port: () => {
        throw new Error("unregistered read port");
      },
    },
    user(),
    { position: "0", inclusive: true },
    {
      registry: registry(() => err({
        code: "unavailable",
        message: "owner unavailable",
      }) as never),
    },
  );
  assert(!denied.ok);
  assertEquals(denied.error.code, "unavailable");
  reader.value.close();
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// identity R8: platform read의 목차·근거 관계도 target scope로 제한한다. 범위 밖 target은
// 근거(seq)로도 읽을 수 없고, 허용 자료만으로 응답을 만들 수 없으면 전체를 거절이다.
Deno.test("platform/identity#R8: platform read는 target scope 안 근거만 펼치고 범위 밖 관계는 거절이다", async () => {
  const { dir, path, connection } = await ledger();
  await runCommand(connection, deps(), commands, user(), note("one"));
  const reader = openReaderConnection(path);
  assert(reader.ok);
  try {
    const seen: string[] = [];
    const scoped = {
      ...user(),
      scope: {
        operations: user().scope.operations,
        targets: { note: ["note:other"] },
      },
    };
    const read = createListEventsRead({
      registry: registry((snapshot, _ctx, event) => {
        seen.push(String(event.subject));
        return ok(fixtureEvent.payload.parse(event.payload).name !== "hidden");
      }),
      current: () => ok(scoped),
    });
    // target이 다른 principal의 요청은 근거(seq)를 펼치기 전에 거절이다.
    const others = executeRead(reader.value, read, new Map(), others_ctx(), {
      after_seq: "0",
    });
    assert(!others.ok);
    assertEquals(others.error.code, "unauthorized");
    assertEquals(seen.length, 0);
    reader.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  } catch {
    reader.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

function others_ctx(): RequestContext {
  return { ...user("user-2"), principal: "user-2" };
}
