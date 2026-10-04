import { assert, assertEquals } from "@std/assert";
import { fileLedger, note, user } from "./command-harness.ts";
import { narrowCredentialScope, resetScopeMirror } from "./writer-fixture.ts";
import { openWriter } from "./writer.ts";

const fixture = new URL("./writer-fixture.ts", import.meta.url);
const crashEntry = new URL("./writer-crash.ts", import.meta.url);

// 제출 ctx는 넓게 유지한다. checkCredential(current authority)이 scope를 줄이면
// 같은 key의 replay도, 새 command도 forbidden이어야 한다(submitted claim을 믿지 않는다, R3·R11).
Deno.test(
  "platform/ledger#R3: current authority가 줄인 scope는 submitted ctx가 넓어도 replay·새 command 모두 forbidden이다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, fixture);
    const wide = user();
    assert(wide.scope.operations.includes("RecordNote"));
    const first = await writer.command(wide, note("a", "narrow-replay"));
    assert(first.ok);
    narrowCredentialScope(path, ["CommandResult"]);
    try {
      const replay = await writer.command(wide, note("a", "narrow-replay"));
      assert(!replay.ok);
      if (!replay.ok) assertEquals(replay.error.code, "forbidden");
      const fresh = await writer.command(wide, note("b", "narrow-fresh"));
      assert(!fresh.ok);
      if (!fresh.ok) assertEquals(fresh.error.code, "forbidden");
    } finally {
      resetScopeMirror(path);
      await writer.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

// 실제 Worker crash가 여러 outstanding command·read-result·close에 걸쳐 있을 때도
// 전부 안전하게 unavailable/closed로 settle하고, 그 뒤 close는 반복해도 안전하다(R6).
Deno.test(
  "platform/ledger#R6: Worker crash는 여러 outstanding command·read-result·close를 모두 unavailable로 settle한다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-writer-" });
    const { path, connection } = await fileLedger(dir);
    connection.close();
    const writer = openWriter(path, crashEntry);
    const first = writer.command(user(), note("a", "one"));
    const second = writer.command(user(), note("b", "two"));
    const read = writer.readResult(user(), "one");
    const closing = writer.close();
    const [cmd1, cmd2, readResult] = await Promise.all([first, second, read]);
    await closing;
    assert(!cmd1.ok);
    if (!cmd1.ok) assertEquals(cmd1.error.code, "unavailable");
    assert(!cmd2.ok);
    if (!cmd2.ok) assertEquals(cmd2.error.code, "unavailable");
    assert(!readResult.ok);
    if (!readResult.ok) assertEquals(readResult.error.code, "unavailable");
    const after = await writer.command(user(), note("c", "three"));
    assert(!after.ok);
    if (!after.ok) assertEquals(after.error.code, "unavailable");
    await writer.close();
    await writer.close();
    await Deno.remove(dir, { recursive: true });
  },
);
