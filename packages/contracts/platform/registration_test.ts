import { assertEquals } from "@std/assert";
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import type { CommandRequest } from "./envelope.ts";
import { definePort } from "./ports.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  ReadSnapshot,
  SchemaStep,
  Sql,
  Tx,
} from "./registration.ts";
import { defineCommand, defineRead } from "./route.ts";

const route = defineCommand({
  resource: "documents",
  method: "save",
  name: "Save",
  input: z.strictObject({ title: z.string() }),
  output: z.object({ saved: z.boolean() }),
  compare: z.strictObject({ seq: z.string() }),
  actors: ["user"],
  errors: ["conflict"],
});
const envelopeCompare: CommandRequest<typeof route>["compare"] = { seq: "1" };
const invalidEnvelopeCompare: CommandRequest<typeof route>["compare"] = {
  // @ts-expect-error envelope에서도 구체 compare schema를 보존한다.
  version: 1,
};
void envelopeCompare;
void invalidEnvelopeCompare;
const definition: CommandDefinition<typeof route> = {
  route,
  dispatchable: true,
  handle(tx, ctx, input, compare) {
    tx.sql.run("UPDATE documents SET title = ?", [input.title]);
    tx.emit(
      { type: "document.saved", payload: z.object({ title: z.string() }) },
      "doc-ref",
      { title: input.title },
    );
    tx.port(definePort<{ reserve(title: string): void }>("documents.reserve"))
      .reserve(input.title);
    const called = tx.call(route, input, compare);
    const run: string | undefined = ctx.run;
    void run;
    return called;
  },
};
const asyncDefinition: CommandDefinition<typeof route> = {
  route,
  // @ts-expect-error transaction handler는 Promise를 반환하지 않는다.
  handle: async () => await Promise.resolve(ok({ saved: true })),
};
const wrongOutput: CommandDefinition<typeof route> = {
  route,
  // @ts-expect-error route output과 다른 결과를 반환할 수 없다.
  handle: () => ok({ saved: "yes" }),
};
function typeChecks(tx: Tx, snapshot: ReadSnapshot) {
  // @ts-expect-error compare schema의 seq field를 보존한다.
  tx.call(route, { title: "x" }, { version: 1 });
  // @ts-expect-error input schema를 보존한다.
  tx.call(route, { missing: true }, { seq: "1" });
  // @ts-expect-error read snapshot에서 write할 수 없다.
  snapshot.sql.run("DELETE FROM documents", []);
  // 반응 cursor는 같은 transaction의 Result로 돌아온다.
  const advanced: { ok: boolean } = tx.advanceSubscriberCursor(
    "notifications",
    "41",
  );
  void advanced;
}
void typeChecks;
void asyncDefinition;
void wrongOutput;
const read = defineRead({
  resource: "documents",
  method: "get",
  name: "Get",
  input: z.strictObject({}),
  output: z.object({ title: z.string() }),
  actors: ["user"],
  errors: [],
});
const readDefinition: ReadDefinition<typeof read> = {
  route: read,
  handle: () => ok({ title: "x" }),
};
const asyncRead: ReadDefinition<typeof read> = {
  route: read,
  // @ts-expect-error read handler도 동기 함수다.
  handle: async () => await Promise.resolve(ok({ title: "x" })),
};
void asyncRead;
Deno.test("platform/ledger#R3 platform/ledger#R11: 등록 handler와 Tx call은 동기 Result를 보존한다", () => {
  assertEquals(definition.route, route);
  assertEquals(readDefinition.route, read);
  const sql: Sql = {
    run: () => ({ changes: 1n, lastInsertRowid: 2n }),
    get: () => undefined,
    all: () => [],
  };
  assertEquals(
    sql.run("INSERT", [null, 1, 2n, "s", new Uint8Array()]).changes,
    1n,
  );
});
Deno.test("platform/backup-and-migration#R1: schema step은 안정된 id와 SQL만 제공한다", () => {
  const step: SchemaStep = {
    id: "documents.create",
    sql: "CREATE TABLE documents (id TEXT)",
  };
  assertEquals(Object.keys(step), ["id", "sql"]);
});
