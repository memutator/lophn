import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  command,
  currentContext,
  runWith,
  traceName,
} from "../../../packages/sdk/cap-schedule/mod.ts";
import { readSchedulePort } from "../../../packages/core/apps/invocations/mod.ts";
import { ensureSchedulePort } from "../../../packages/core/apps/runtime/entrypoint/schedule.ts";

const context = {
  app: "app_01h455vb4pex5v6nkc6gd5fdw1",
  release: "rel_01h455vb4pex5v6nkc6gd5fdw1",
  mode: "preview" as const,
  invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
};

Deno.test("apps/sdk#R27 apps/sdk#R28: context survives await, timer, SQLite and fetch", async () => {
  command("usage.context", () => currentContext());
  const seen = await runWith(context, async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 1));
    const db = new DatabaseSync(":memory:");
    db.exec("create table kept(n integer)");
    db.prepare("insert into kept(n) values (?)").run(1);
    db.prepare("select n from kept").get();
    db.close();
    const response = await fetch("data:text/plain,ok");
    await response.text();
    return currentContext();
  });
  assertEquals(seen, context);
  assertEquals(currentContext(), null);
  const port = readSchedulePort();
  assert(port);
  assertEquals(port, ensureSchedulePort());
  assert(
    port.handlers().some((handler) => handler.command === "usage.context"),
  );
  assertEquals(await port.current(), null);

  assertEquals(traceName("a".repeat(64)), "a".repeat(64));
  assertThrows(() => traceName("a".repeat(65)));
  assertThrows(() => traceName("inv_01h455vb4pex5v6nkc6gd5fdw1"));
  const unknown = await runWith(
    { ...context, invocation: null },
    () => currentContext(),
  );
  assertEquals(unknown?.invocation, null);
  await assertRejects(
    () => runWith(context, () => Promise.reject(new Error("handler failed"))),
    Error,
    "handler failed",
  );
  assertEquals(currentContext(), null);
});
