import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../base/mod.ts";
import {
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_IMAGE_FIELD,
} from "../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext, Sql } from "../../protocol/server/mod.ts";
import {
  type MessageImageDeps,
  messageImagePathHandler,
  messageImageUploadHandler,
} from "./message-images.ts";
import { imageReferenced } from "./session/message-images.ts";
import { conversationTestSteps } from "./session/test-steps.ts";

const A = "ses_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "ses_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const SENT = "a".repeat(64);
const OTHER = "b".repeat(64);
const OLD_ATTACHMENT = "att_0ddddddddddddddddddddddddd";

const who = (actor: string, session?: string) =>
  ({
    actor,
    conditions: session === undefined ? {} : { session },
  }) as unknown as AuthenticatedContext;

// A가 보낸 이미지(SENT)를 B가 call로 받았다: 두 session의 메시지가 같은 blob을 건다. A만 가진 이미지(OTHER)도 있다.
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of conversationTestSteps) db.exec(step.sql);
  db.exec(`
    create table blob_refs (
      owner_kind text not null, owner_key text not null, field text not null,
      hash text not null, size_bytes integer not null, registered_seq integer not null,
      primary key (owner_kind, owner_key, field, hash)
    );
  `);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  for (const id of [A, B]) {
    sql.run(
      `insert into sessions (id, agent, lifecycle, created_seq, state_seq)
       values (?, 'lophn', 'open', 1, 1)`,
      [id],
    );
  }
  let seq = 0;
  const message = (id: string, session: string, blobs: string[]) => {
    seq += 1;
    sql.run(
      `insert into messages (id, session, from_kind, body, created_seq, created_at, state_seq)
       values (?, ?, 'human', ?, ?, '2026-11-04T00:00:00.000Z', ?)`,
      [id, session, "0".repeat(64), seq, seq],
    );
    for (const hash of blobs) {
      sql.run("insert into blob_refs values (?, ?, ?, ?, 0, 0)", [
        MESSAGE_BODY_OWNER_KIND,
        id,
        MESSAGE_IMAGE_FIELD,
        hash,
      ]);
    }
  };
  message("msg_a", A, [SENT, OTHER]);
  message("msg_b", B, [SENT]);

  const files = new Map<string, Uint8Array>([
    [`/data/blobs/sha256/aa/${SENT.slice(2)}`, PNG],
    [`/data/blobs/sha256/bb/${OTHER.slice(2)}`, PNG],
    [`/data/message-images/${A}/${OLD_ATTACHMENT}.png`, PNG],
  ]);
  const prepared: Uint8Array[] = [];
  const deps: MessageImageDeps = {
    root: "/data",
    files: {
      read: (path) => Promise.resolve(files.get(path) ?? null),
      exists: (path) => Promise.resolve(files.has(path)),
    },
    relay: () => ({
      live: () => false,
      prepare: (call) => {
        prepared.push(new Uint8Array());
        return Promise.resolve(
          ok({ hash: call.expectedHash ?? "", size_bytes: 0 } as never),
        );
      },
    }),
    referenced: (session, blob) => ok(imageReferenced(sql, session, blob)),
  };
  const body = (bytes: Uint8Array) => ({
    bytes: new Response(bytes.slice()).body!,
    length: bytes.length,
  });
  return { db, deps, prepared, body };
}

// 받은 이미지는 받은 session에서만 읽힌다. 틀리면 session B의 agent가 A가 보낸 다른 이미지나 A에 붙은 첨부를 읽는다.
test("session은 자기 메시지가 참조하는 이미지만 풀고 다른 session의 이미지와 첨부는 풀지 못한다", async () => {
  const { db, deps } = setup();
  try {
    const path = messageImagePathHandler(deps);
    const cases: [string, AuthenticatedContext, unknown, string][] = [
      ["own blob", who(`agent:${B}`, B), { session: B, image: SENT }, "ok"],
      [
        "blob only the other session holds",
        who(`agent:${B}`, B),
        { session: B, image: OTHER },
        "not_found",
      ],
      [
        "the other session's attachment",
        who(`agent:${B}`, B),
        { session: B, image: OLD_ATTACHMENT },
        "not_found",
      ],
      [
        "own attachment",
        who(`agent:${A}`, A),
        { session: A, image: OLD_ATTACHMENT },
        "ok",
      ],
      [
        "credential of another session",
        who(`agent:${B}`, B),
        { session: A, image: SENT },
        "forbidden",
      ],
      [
        "traversal in id",
        who(`agent:${A}`, A),
        { session: A, image: "../../x" },
        "invalid_input",
      ],
    ];
    for (const [name, ctx, input, expected] of cases) {
      const got = await path(ctx, input);
      assert.deepStrictEqual(got.ok ? "ok" : got.error.code, expected, name);
    }
  } finally {
    db.close();
  }
});

test("형식이나 길이가 선언과 다른 이미지는 blob으로 준비되지 않는다", async () => {
  const { db, deps, prepared, body } = setup();
  try {
    const upload = messageImageUploadHandler(deps);
    const text = new TextEncoder().encode("<svg/>");
    const wrongType = await upload(
      who("user"),
      { content_type: "image/png", bytes: text.length },
      body(text),
    );
    const wrongLength = await upload(
      who("user"),
      { content_type: "image/png", bytes: PNG.length + 1 },
      body(PNG),
    );
    assert.deepStrictEqual(
      [wrongType.ok, wrongLength.ok, prepared.length],
      [false, false, 0],
    );
  } finally {
    db.close();
  }
});
