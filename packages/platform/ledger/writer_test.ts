import { assert, assertEquals } from "@std/assert";
import type { ReadSnapshot } from "../../contracts/platform/mod.ts";
import { commandResultRead } from "./command-results.ts";
import {
  deps,
  fileLedger,
  note,
  user,
  wideFixtureCase,
} from "./command-harness.ts";
import { formatSeq } from "../../base/mod.ts";
import { openWriter, runCommand } from "./writer.ts";
import { recordNoteCommand } from "./test-commands.ts";
import { advanceSubscriberCursorCommand } from "./commands.ts";
import { resetCredentialMirror, revokeCredential } from "./writer-fixture.ts";

const fixture = new URL("./writer-fixture.ts", import.meta.url);

Deno.test("platform/ledger#R3: writer Worker 하나가 command를 확정하고 wake한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const result = await writer.command(user(), note("a"));
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value.replayed, false);
    assertEquals(result.value.wake, true);
    assertEquals(result.value.first_seq, "1");
  }
  const again = await writer.command(user(), note("a"));
  assert(again.ok);
  if (again.ok) assertEquals(again.value.replayed, true);
  const other = await writer.command(user(), note("b"));
  assert(!other.ok);
  if (!other.ok) assertEquals(other.error.code, "conflict");
  await writer.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: writer Worker의 commands/result는 자기 principal만 본다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const wrote = await writer.command(user("a"), note("a"));
  assert(wrote.ok);
  const own = await writer.readResult(user("a"), "k1");
  const foreign = await writer.readResult(user("b"), "k1");
  assert(own.ok);
  assert(foreign.ok);
  if (own.ok) assert(own.value !== null);
  if (foreign.ok) assertEquals(foreign.value, null);
  const missing = await writer.readResult(user("a"), "missing");
  assert(missing.ok);
  if (missing.ok) assertEquals(missing.value, null);
  await writer.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R20: writer Worker는 등록 밖 command를 실행하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, fixture);
  const unknown = await writer.command(user(), {
    command: "drop table events",
    input: {},
    idempotency_key: "bad",
    compare: {},
    prepared: ["/tmp/x"],
  });
  assert(!unknown.ok);
  if (!unknown.ok) assertEquals(unknown.error.code, "invalid_input");
  await writer.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R13: commands/result read는 자기 principal과 snapshot seq를 돌려준다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cmd-" });
  const { connection } = await fileLedger(dir);
  const wrote = await runCommand(
    connection,
    deps(),
    [recordNoteCommand, advanceSubscriberCursorCommand],
    user("a"),
    note("a"),
  );
  assert(wrote.ok);
  const head = connection.sql.get("select max(seq) as head from events", []);
  const asOf = typeof head?.["head"] === "bigint"
    ? formatSeq(head["head"])
    : "0";
  const snapshot: ReadSnapshot = {
    sql: connection.sql,
    as_of_seq: asOf,
    port() {
      throw new Error("port 없음");
    },
  };
  const own = commandResultRead.handle(snapshot, user("a"), {
    idempotency_key: "k1",
  });
  assert(own.ok);
  if (own.ok) {
    assertEquals(own.value.as_of_seq, "1");
    assert(own.value.result !== null);
    if (own.value.result) assertEquals(own.value.result.principal, "a");
  }
  const foreign = commandResultRead.handle(snapshot, user("b"), {
    idempotency_key: "k1",
  });
  assert(foreign.ok);
  if (foreign.ok) assertEquals(foreign.value.result, null);
  const denied = commandResultRead.handle(
    snapshot,
    {
      ...user("a"),
      scope: { operations: ["RecordNote"], targets: {} },
    },
    { idempotency_key: "k1" },
  );
  assert(!denied.ok);
  if (!denied.ok) assertEquals(denied.error.code, "forbidden");
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// 실제 Deno Worker 경계를 지나는 z.unknown() output의 함수·symbol·bigint·순환은
// internal+rollback이고, 같은 Worker의 다음 valid command는 성공한다(실제 blocker).
Deno.test(
  "platform/ledger#R4: 실제 Worker의 z.unknown() output 함수·symbol·bigint·순환은 internal이고 다음 command는 된다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, fixture);
    for (const mode of ["function", "symbol", "bigint", "cycle"] as const) {
      const result = await writer.command(
        user(),
        wideFixtureCase("a", mode, `wide-${mode}`),
      );
      assert(!result.ok);
      if (!result.ok) assertEquals(result.error.code, "internal");
    }
    const kept = await writer.command(
      user(),
      wideFixtureCase("kept", "ok", "wide-ok"),
    );
    assert(kept.ok);
    await writer.close();
    await Deno.remove(dir, { recursive: true });
  },
);

// failure details의 함수도 실제 Worker 경계에서 conflict를 그대로 숨기지 않고 internal이다.
Deno.test(
  "platform/ledger#R4: 실제 Worker에서 failure details의 함수는 internal이고 다음 command는 된다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, fixture);
    const result = await writer.command(
      user(),
      wideFixtureCase("a", "details-function", "wide-details"),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "internal");
    const kept = await writer.command(
      user(),
      wideFixtureCase("kept", "ok", "wide-details-ok"),
    );
    assert(kept.ok);
    await writer.close();
    await Deno.remove(dir, { recursive: true });
  },
);

// 미리 .catch하지 않은 fresh rejecting Promise도 실제 Worker 안에서 internal로 관측되고
// 같은 Worker가 다음 command를 계속 처리한다(Worker crash·hang 없음).
Deno.test(
  "platform/ledger#R4: 실제 Worker 안의 fresh rejecting Promise는 internal이고 Worker는 계속 산다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, fixture);
    const result = await writer.command(
      user(),
      wideFixtureCase("a", "reject", "wide-reject"),
    );
    assert(!result.ok);
    if (!result.ok) assertEquals(result.error.code, "internal");
    const kept = await writer.command(
      user(),
      wideFixtureCase("kept", "ok", "wide-reject-ok"),
    );
    assert(kept.ok);
    await writer.close();
    await Deno.remove(dir, { recursive: true });
  },
);

// writer.readResult는 revoked credential을 current authority로 다시 거부한다(제출 ctx를 믿지 않는다, R13).
Deno.test(
  "platform/ledger#R13: writer Worker의 read-result도 회수된 credential은 unauthorized다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, fixture);
    const wrote = await writer.command(user(), note("a"));
    assert(wrote.ok);
    revokeCredential(path, "cred-1");
    const revoked = await writer.readResult(user(), "k1");
    assert(!revoked.ok);
    if (!revoked.ok) assertEquals(revoked.error.code, "unauthorized");
    await writer.close();
    resetCredentialMirror(path);
    await Deno.remove(dir, { recursive: true });
  },
);

// writer.readResult는 CommandResult scope가 없는 credential을 forbidden으로 거부한다(T3 reader
// 경로의 commandResultRead와 같은 authorize를 적용한다).
Deno.test(
  "platform/ledger#R13: writer Worker의 read-result는 CommandResult scope가 없으면 forbidden이다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, fixture);
    const wrote = await writer.command(user(), note("a"));
    assert(wrote.ok);
    const narrow = {
      ...user(),
      scope: { operations: ["RecordNote"], targets: {} },
    };
    const denied = await writer.readResult(narrow, "k1");
    assert(!denied.ok);
    if (!denied.ok) assertEquals(denied.error.code, "forbidden");
    await writer.close();
    await Deno.remove(dir, { recursive: true });
  },
);
