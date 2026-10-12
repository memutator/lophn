import { assertEquals } from "@std/assert";
import { z } from "zod";
import { ok, type Result } from "../../base/mod.ts";
import type { ApprovalAction, ApprovalUse } from "../approvals/approvals.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../storage/blob.ts";
import type { CommandRequest } from "../base/envelope.ts";
import { definePort } from "../base/ports.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  ReadSnapshot,
  SchemaStep,
  Sql,
  Tx,
} from "./registration.ts";
import { defineCommand, defineRead } from "../base/route.ts";

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
  dispatchOnly: false,
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

const blobRegistration: BlobRefRegistration = {
  owner_kind: "DocumentVersion",
  owner_key: "ver_01arz3ndektsv4rrffq69g5fav",
  field: "file",
  registered_seq: "42",
  source: {
    kind: "prepared",
    blob: {
      preparation: "worker-preparation-1",
      principal: "user",
      purpose: "document_file",
      hash: "a".repeat(64),
      size_bytes: 3,
    },
  },
};
function blobTypeChecks(tx: Tx, snapshot: ReadSnapshot) {
  const result: Result<PermanentBlobReference> = tx.registerBlobRef(
    blobRegistration,
  );
  // @ts-expect-error 등록은 비동기 파일 작업이 아니라 같은 transaction의 Result다.
  const asyncResult: Promise<Result<PermanentBlobReference>> = result;
  tx.registerBlobRef({
    ...blobRegistration,
    // @ts-expect-error hash 단독 주장은 검증된 준비·허용 기존 참조가 아니다.
    source: { kind: "hash", hash: "a".repeat(64) },
  });
  // @ts-expect-error read snapshot은 blob 참조를 등록할 수 없다.
  snapshot.registerBlobRef(blobRegistration);
  void asyncResult;
}
void blobTypeChecks;
const approvalAction: ApprovalAction = {
  concern: "documents/versions",
  command: "save",
  caller: "user",
  targets: ["doc_01arz3ndektsv4rrffq69g5fav"],
  input: { kind: "inline", value: { title: "note" } },
  input_hash: "a".repeat(64),
  comparison: { seq: "41" },
  binding_hash: "b".repeat(64),
};
const approvalUse: ApprovalUse = {
  approval: "apr_01arz3ndektsv4rrffq69g5fav",
  concern: approvalAction.concern,
  receipt: { kind: "event", seq: "43" },
  accepted_seq: "43",
};
function approvalTypeChecks(tx: Tx, snapshot: ReadSnapshot) {
  const result: Result<ApprovalUse> = tx.useApproval(
    approvalUse.approval,
    approvalAction,
    approvalUse,
  );
  // @ts-expect-error 사용 연결은 비동기 작업이 아니라 같은 transaction의 Result다.
  const asyncResult: Promise<Result<ApprovalUse>> = result;
  // @ts-expect-error read snapshot은 approval을 사용하지 않는다.
  snapshot.useApproval(approvalUse.approval, approvalAction, approvalUse);
  void asyncResult;
}
void approvalTypeChecks;
Deno.test("platform/approvals#R7 platform/backup-and-migration#R16: Tx.useApproval은 동기 Result다", () => {
  const useApproval: Tx["useApproval"] = (_approval, _action, use) => ok(use);
  const result = useApproval(
    approvalUse.approval,
    approvalAction,
    approvalUse,
  );
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.accepted_seq, "43");
});
Deno.test("platform/blob-store#R4 platform/ledger#R22: Tx blob 참조 등록은 동기 Result이고 event 없는 기반 쓰기에 한정한다", () => {
  const register: Tx["registerBlobRef"] = (reference) =>
    ok({
      owner_kind: reference.owner_kind,
      owner_key: reference.owner_key,
      field: reference.field,
      registered_seq: reference.registered_seq,
      hash: reference.source.kind === "prepared"
        ? reference.source.blob.hash
        : reference.source.reference.hash,
    });
  const result = register(blobRegistration);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.registered_seq, "42");
});
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
