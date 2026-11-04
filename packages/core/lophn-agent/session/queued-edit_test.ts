import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import {
  contentOfBlocks,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_IMAGE_FIELD,
  serializeMessageContent,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../../../protocol/storage/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { conversationSchemaSteps } from "./model.ts";
import { editQueuedCommand } from "./queued-edit.ts";
import { moveQueuedCommand } from "./queued-move.ts";

const machine = {
  actor: "machine",
  principal: "machine:session-inputs",
} as RequestContext;

function store() {
  const db = new DatabaseSync(":memory:");
  for (const step of conversationSchemaSteps) db.exec(step.sql);
  db.exec(`
    create table events (seq integer primary key);
    create table erase_windows (table_name text primary key);
    insert into events (seq) values (10);
    create table blob_refs (
      owner_kind text not null,
      owner_key text not null,
      field text not null,
      hash text not null,
      size_bytes integer not null,
      registered_seq integer not null,
      primary key (owner_kind, owner_key, field, hash)
    );
    insert into sessions (id, agent, lifecycle, created_seq, state_seq)
      values ('ses_x', 'lophn', 'open', 1, 1);
  `);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const tx = {
    sql,
    registerBlobRef(reference: BlobRefRegistration) {
      if (reference.source.kind !== "prepared") throw new Error("prepared");
      const blob = reference.source.blob;
      sql.run(
        `insert into blob_refs
           (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
         values (?, ?, ?, ?, ?, ?)`,
        [
          reference.owner_kind,
          reference.owner_key,
          reference.field,
          blob.hash,
          blob.size_bytes,
          BigInt(reference.registered_seq),
        ],
      );
      const stored: PermanentBlobReference = {
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: blob.hash,
        registered_seq: reference.registered_seq,
      };
      return ok(stored);
    },
  } as unknown as Tx;
  let seq = 1;
  const message = (id: string, turn: string | null, body: string) => {
    seq += 1;
    sql.run(
      `insert into messages (id, session, from_kind, turn, body,
         created_seq, created_at, state_seq)
       values (?, 'ses_x', 'human', ?, ?, ?, '2026-10-31T00:00:00.000Z', ?)`,
      [id, turn, body, seq, seq],
    );
  };
  return { db, sql, tx, message };
}

const content = [{ type: "text" as const, text: "edited text" }];

test("큐의 글을 고치면 저장된 본문과 blob 참조가 새 글 하나로 바뀌고, 가져간 메시지는 conflict다", () => {
  const { db, sql, tx, message } = store();
  try {
    const oldHash = "0".repeat(64);
    message("msg_queued", null, oldHash);
    message("msg_taken", "trn_1", oldHash);
    const edit = editQueuedCommand();
    const expected = createHash("sha256")
      .update(serializeMessageContent(contentOfBlocks(content)))
      .digest("hex");

    const edited = edit.handle(
      tx,
      machine,
      { session: "ses_x", message: "msg_queued", content },
      {},
    );
    assert.ok(edited.ok);
    const row = sql.get("select body from messages where id = ?", [
      "msg_queued",
    ]);
    assert.equal(row?.["body"], expected);
    const refs = sql.all(
      `select hash from blob_refs
       where owner_kind = ? and owner_key = ? and field = ?`,
      [MESSAGE_BODY_OWNER_KIND, "msg_queued", MESSAGE_BODY_FIELD],
    );
    assert.deepStrictEqual(
      refs.map((ref) => ref["hash"]),
      [expected],
    );

    const taken = edit.handle(
      tx,
      machine,
      { session: "ses_x", message: "msg_taken", content },
      {},
    );
    assert.ok(!taken.ok);
    assert.equal(taken.error.code, "conflict");
    const untouched = sql.get("select body from messages where id = ?", [
      "msg_taken",
    ]);
    assert.equal(untouched?.["body"], oldHash);
  } finally {
    db.close();
  }
});

// 이미 건 이미지는 글을 고쳐도 남고, 새 이미지는 이 자격으로 올리지 않아 걸지 못한다.
test("큐의 글을 고쳐도 건 이미지 참조는 남고 새 이미지를 더하는 고침은 거절된다", () => {
  const { db, sql, tx, message } = store();
  try {
    message("msg_queued", null, "0".repeat(64));
    const image = "a".repeat(64);
    sql.run("insert into blob_refs values (?, ?, ?, ?, 0, 0)", [
      MESSAGE_BODY_OWNER_KIND,
      "msg_queued",
      MESSAGE_IMAGE_FIELD,
      image,
    ]);
    const edit = editQueuedCommand();
    const block = { type: "image" as const, mimeType: "image/png" as const };

    const kept = edit.handle(
      tx,
      machine,
      {
        session: "ses_x",
        message: "msg_queued",
        content: [...content, { ...block, blob: image }],
      },
      {},
    );
    assert.ok(kept.ok);
    const added = edit.handle(
      tx,
      machine,
      {
        session: "ses_x",
        message: "msg_queued",
        content: [...content, { ...block, blob: "b".repeat(64) }],
      },
      {},
    );
    assert.ok(!added.ok);
    assert.equal(added.error.code, "invalid_input");
    assert.deepStrictEqual(
      sql
        .all("select hash from blob_refs where field = ?", [
          MESSAGE_IMAGE_FIELD,
        ])
        .map((row) => row["hash"]),
      [image],
    );
  } finally {
    db.close();
  }
});

test("큐의 순서를 바꾸면 저장된 created_seq가 이웃과 맞바뀌고, 가져간 메시지는 옮기지 못한다", () => {
  const { db, sql, tx, message } = store();
  try {
    message("msg_a", null, "0".repeat(64));
    message("msg_b", null, "1".repeat(64));
    message("msg_taken", "trn_1", "2".repeat(64));
    const move = moveQueuedCommand();

    const moved = move.handle(
      tx,
      machine,
      { session: "ses_x", message: "msg_b", direction: "up" },
      {},
    );
    assert.ok(moved.ok);
    assert.deepStrictEqual(
      sql
        .all(
          "select id, created_seq, state_seq from messages where turn is null order by created_seq",
          [],
        )
        .map((row) => [
          row["id"],
          Number(row["created_seq"]),
          Number(row["state_seq"]),
        ]),
      [
        ["msg_b", 2, 2],
        ["msg_a", 3, 3],
      ],
    );

    const taken = move.handle(
      tx,
      machine,
      { session: "ses_x", message: "msg_taken", direction: "up" },
      {},
    );
    assert.ok(!taken.ok);
    assert.equal(taken.error.code, "conflict");
  } finally {
    db.close();
  }
});
